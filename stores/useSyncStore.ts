/**
 * stores/useSyncStore.ts
 *
 * Google Drive sync state and operations.
 * Manages the in-memory access token (refreshed every ~55 min via refresh_token),
 * Drive file operations, and conflict resolution.
 */

"use client";

import { create } from "zustand";
import { refreshAccessToken } from "@/lib/auth";
import { useDBStore } from "./useDBStore";

const DRIVE_API = "https://www.googleapis.com/drive";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive";
const DB_FILENAME = "overtimeiq.db";
const TMP_FILENAME = "overtimeiq_tmp.db";
const SYNC_SKEW_SECONDS = 30;

type SyncStatus = "idle" | "syncing" | "synced" | "error" | "offline";

interface SyncState {
  /** Short-lived access token — stored in memory only, never persisted */
  accessToken: string | null;
  syncStatus: SyncStatus;
  lastSyncedAt: string | null;
  driveFileId: string | null;
  /** Whether we're waiting to flush offline-queued uploads */
  hasPendingUpload: boolean;

  // Actions
  setAccessToken: (token: string) => void;
  syncOnLogin: (refreshToken: string) => Promise<void>;
  syncNow: () => Promise<void>;
  uploadToDrive: () => Promise<void>;
  refreshToken: () => Promise<boolean>;
  setDriveFileId: (id: string) => void;
}

// Refresh timer — resets every successful refresh
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export const useSyncStore = create<SyncState>((set, get) => ({
  accessToken: null,
  syncStatus: "idle",
  lastSyncedAt: null,
  driveFileId: null,
  hasPendingUpload: false,

  setAccessToken: (token) => {
    set({ accessToken: token });
    scheduleRefresh(get);
  },

  setDriveFileId: (id) => set({ driveFileId: id }),

  refreshToken: async (): Promise<boolean> => {
    const { getOne, execSQL } = useDBStore.getState();
    const row = getOne("SELECT google_refresh_token FROM settings WHERE id = 1");
    const rt = row?.google_refresh_token as string | null;
    if (!rt) return false;

    try {
      const newAccessToken = await refreshAccessToken(rt);
      set({ accessToken: newAccessToken });
      scheduleRefresh(get);
      return true;
    } catch {
      console.warn("[useSyncStore] Token refresh failed — Drive calls will fail");
      return false;
    }
  },

  syncOnLogin: async (refreshToken: string) => {
    set({ syncStatus: "syncing" });
    const { execSQL, runQuery, saveDB } = useDBStore.getState();

    // Store the refresh token in SQLite settings
    execSQL("UPDATE settings SET google_refresh_token = ? WHERE id = 1", [
      refreshToken,
    ]);

    const { accessToken } = get();
    if (!accessToken) {
      set({ syncStatus: "error" });
      return;
    }

    try {
      // Search Drive for existing DB file
      const searchRes = await driveRequest(
        `${DRIVE_API}/v3/files?q=name%3D'${DB_FILENAME}'%20and%20trashed%3Dfalse&fields=files(id,modifiedTime)`,
        "GET",
        accessToken
      );

      const files = searchRes.files ?? [];

      if (files.length === 0) {
        // First time — upload current DB to Drive
        const dbBuffer = saveDB();
        if (dbBuffer) {
          const fileId = await uploadNewFile(dbBuffer, accessToken);
          set({ driveFileId: fileId });
          execSQL("UPDATE settings SET drive_file_id = ? WHERE id = 1", [fileId]);
        }
      } else {
        const driveFile = files[0];
        const driveFileId = driveFile.id;
        const driveModifiedTime = driveFile.modifiedTime;

        set({ driveFileId });
        execSQL("UPDATE settings SET drive_file_id = ? WHERE id = 1", [driveFileId]);

        // Compare timestamps
        const settingsRow = runQuery("SELECT last_synced_at FROM settings WHERE id = 1")[0];
        const localLastSynced = settingsRow?.last_synced_at as string | null;

        const driveMs = new Date(driveModifiedTime).getTime();
        const localMs = localLastSynced ? new Date(localLastSynced).getTime() : 0;
        const diffSeconds = Math.abs(driveMs - localMs) / 1000;

        if (diffSeconds <= SYNC_SKEW_SECONDS) {
          // Same-device multi-tab edge case — no action
        } else if (driveMs > localMs) {
          // Drive is newer — download and replace local
          await downloadFromDrive(driveFileId, accessToken);
          // Toast will be shown by the UI
        } else {
          // Local is newer — upload to Drive
          const dbBuffer = saveDB();
          if (dbBuffer) await uploadUpdate(driveFileId, dbBuffer, accessToken);
        }
      }

      const now = new Date().toISOString();
      execSQL("UPDATE settings SET last_synced_at = ? WHERE id = 1", [now]);
      set({ syncStatus: "synced", lastSyncedAt: now });
    } catch (err) {
      console.error("[useSyncStore] syncOnLogin error:", err);
      set({ syncStatus: "error" });
    }
  },

  syncNow: async () => {
    const { driveFileId, accessToken, uploadToDrive, refreshToken } = get();
    if (!accessToken) {
      const refreshed = await refreshToken();
      if (!refreshed) {
        set({ syncStatus: "offline" });
        return;
      }
    }
    await uploadToDrive();
  },

  uploadToDrive: async () => {
    const { driveFileId, accessToken } = get();
    const { saveDB } = useDBStore.getState();

    if (!accessToken) {
      set({ hasPendingUpload: true });
      return;
    }

    set({ syncStatus: "syncing" });
    const dbBuffer = saveDB();
    if (!dbBuffer) return;

    try {
      if (driveFileId) {
        await uploadUpdate(driveFileId, dbBuffer, accessToken);
      } else {
        const fileId = await uploadNewFile(dbBuffer, accessToken);
        set({ driveFileId: fileId });
        useDBStore.getState().execSQL(
          "UPDATE settings SET drive_file_id = ? WHERE id = 1",
          [fileId]
        );
      }
      const now = new Date().toISOString();
      useDBStore.getState().execSQL(
        "UPDATE settings SET last_synced_at = ? WHERE id = 1",
        [now]
      );
      set({ syncStatus: "synced", lastSyncedAt: now, hasPendingUpload: false });
    } catch (err) {
      console.error("[useSyncStore] uploadToDrive error:", err);
      set({ syncStatus: "error", hasPendingUpload: true });
    }
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scheduleRefresh(get: () => SyncState) {
  if (refreshTimer) clearTimeout(refreshTimer);
  // Refresh 5 minutes before the 1-hour Google access token expiry
  refreshTimer = setTimeout(
    () => get().refreshToken(),
    55 * 60 * 1000
  );
}

async function driveRequest(url: string, method: string, token: string, body?: BodyInit) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive API ${method} ${url} failed: ${res.status} ${text}`);
  }

  return res.json().catch(() => ({}));
}

async function uploadNewFile(buffer: Uint8Array, token: string): Promise<string> {
  const metadata = JSON.stringify({ name: DB_FILENAME, mimeType: "application/octet-stream" });
  const boundary = "----OTIQBoundary";
  const body: any = [
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
    buffer,
    `\r\n--${boundary}--`,
  ];

  const blob = new Blob(body);
  const res = await fetch(
    `${DRIVE_UPLOAD}/v3/files?uploadType=multipart&fields=id`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: blob,
    }
  );
  if (!res.ok) throw new Error(`Drive upload failed: ${res.status}`);
  const data = await res.json();
  return data.id;
}

/** Upload using temp-file-rename pattern to prevent corruption on interrupted upload. */
async function uploadUpdate(fileId: string, buffer: Uint8Array | any, token: string): Promise<void> {
  // 1. Upload to temp filename
  const tmpMetadata = JSON.stringify({ name: TMP_FILENAME });
  const res = await fetch(
    `${DRIVE_UPLOAD}/v3/files/${fileId}?uploadType=media`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
      },
      body: buffer,
    }
  );
  if (!res.ok) throw new Error(`Drive update failed: ${res.status}`);

  // 2. Rename temp → overtimeiq.db atomically
  await driveRequest(
    `${DRIVE_API}/v3/files/${fileId}`,
    "PATCH",
    token,
    JSON.stringify({ name: DB_FILENAME })
  );
}

async function downloadFromDrive(fileId: string, token: string): Promise<void> {
  const res = await fetch(
    `${DRIVE_API}/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Drive download failed: ${res.status}`);

  const arrayBuffer = await res.arrayBuffer();
  const buffer = new Uint8Array(arrayBuffer);

  // Replace localStorage DB
  localStorage.setItem("otiq_db", JSON.stringify(Array.from(buffer)));

  // Reinitialise sql.js with the new data
  await useDBStore.getState().initDB();
}
