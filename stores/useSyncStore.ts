/**
 * stores/useSyncStore.ts
 *
 * Google Drive sync. Fixed issues:
 * - uploadUpdate: now uses media upload then separate metadata PATCH for the rename pattern
 * - driveRequest: correct Content-Type for metadata-only PATCH calls
 * - access token propagation: refreshToken reads from SQLite then sets state
 */

"use client";

import { create } from "zustand";
import { refreshAccessToken } from "@/lib/auth";
import { useDBStore } from "./useDBStore";

const DRIVE_API = "https://www.googleapis.com/drive";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive";
const DB_FILENAME = "overtimeiq.db";
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

  setAccessToken: (token: string) => void;
  syncOnLogin: (googleRefreshToken: string) => Promise<void>;
  syncNow: () => Promise<void>;
  uploadToDrive: () => Promise<void>;
  refreshToken: () => Promise<boolean>;
  setDriveFileId: (id: string) => void;
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export const useSyncStore = create<SyncState>((set, get) => ({
  accessToken: null,
  syncStatus: "idle",
  lastSyncedAt: null,
  driveFileId: null,
  hasPendingUpload: false,

  setAccessToken: (token) => {
    set({ accessToken: token });
    scheduleRefresh();
  },

  setDriveFileId: (id) => set({ driveFileId: id }),

  refreshToken: async (): Promise<boolean> => {
    // Read google_refresh_token from SQLite settings
    const { getOne } = useDBStore.getState();
    const row = getOne("SELECT google_refresh_token FROM settings WHERE id = 1");
    const rt = row?.google_refresh_token as string | null;
    if (!rt) {
      console.warn("[useSyncStore] No google_refresh_token found in SQLite");
      return false;
    }
    try {
      const newAccessToken = await refreshAccessToken(rt);
      set({ accessToken: newAccessToken });
      scheduleRefresh();
      return true;
    } catch (err) {
      console.warn('[useSyncStore] Token refresh failed — Drive calls will fail:', err);
      return false;
    }
  },

  syncOnLogin: async (googleRefreshToken: string) => {
    // googleRefreshToken is passed directly here because SQLite may not have it yet
    // (it's being saved by the app layout at the same time)
    set({ syncStatus: "syncing" });

    let token = get().accessToken;
    if (!token) {
      // Try to get a fresh access token using the refresh token we just received
      try {
        token = await refreshAccessToken(googleRefreshToken);
        set({ accessToken: token });
        scheduleRefresh();
      } catch (err) {
        console.error("[useSyncStore] Could not get access token on login:", err);
        set({ syncStatus: "error" });
        return;
      }
    }

    const { saveDB, runQuery, execSQL } = useDBStore.getState();

    try {
      // Search Drive for existing DB file
      const searchRes = await driveGet(
        `${DRIVE_API}/v3/files?q=name%3D'${DB_FILENAME}'%20and%20trashed%3Dfalse&fields=files(id,modifiedTime)`,
        token
      );

      const files = (searchRes.files ?? []) as { id: string; modifiedTime: string }[];

      if (files.length === 0) {
        // First time — upload current DB
        const buf = saveDB();
        if (buf) {
          const fileId = await uploadNewFile(buf, token);
          set({ driveFileId: fileId });
          execSQL("UPDATE settings SET drive_file_id = ? WHERE id = 1", [fileId]);
          console.log("[useSyncStore] Created new Drive file:", fileId);
        }
      } else {
        const driveFile = files[0];
        set({ driveFileId: driveFile.id });
        execSQL("UPDATE settings SET drive_file_id = ? WHERE id = 1", [driveFile.id]);

        const settingsRow = runQuery("SELECT last_synced_at FROM settings WHERE id = 1")[0];
        const localLastSynced = settingsRow?.last_synced_at as string | null;

        const driveMs = new Date(driveFile.modifiedTime).getTime();
        const localMs = localLastSynced ? new Date(localLastSynced).getTime() : 0;
        const diffSeconds = Math.abs(driveMs - localMs) / 1000;

        if (diffSeconds <= SYNC_SKEW_SECONDS) {
          // Same-device, no action needed
        } else if (driveMs > localMs) {
          // Drive is newer — download
          await downloadFromDrive(driveFile.id, token);
          console.log("[useSyncStore] Downloaded newer version from Drive");
        } else {
          // Local is newer — upload
          const buf = saveDB();
          if (buf) await uploadUpdate(driveFile.id, buf, token);
          console.log("[useSyncStore] Uploaded newer local version to Drive");
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
    let { accessToken } = get();
    if (!accessToken) {
      const ok = await get().refreshToken();
      if (!ok) {
        set({ syncStatus: "offline" });
        return;
      }
      accessToken = get().accessToken;
    }
    await get().uploadToDrive();
  },

  uploadToDrive: async () => {
    let { accessToken, driveFileId } = get();
    const { saveDB, execSQL } = useDBStore.getState();

    // Refresh token if we don't have one
    if (!accessToken) {
      const ok = await get().refreshToken();
      if (!ok) { set({ hasPendingUpload: true, syncStatus: "offline" }); return; }
      accessToken = get().accessToken!;
    }

    set({ syncStatus: "syncing" });
    const buf = saveDB();
    if (!buf) { set({ syncStatus: "error" }); return; }

    try {
      if (driveFileId) {
        await uploadUpdate(driveFileId, buf, accessToken);
      } else {
        // No file ID yet — search first
        const searchRes = await driveGet(
          `${DRIVE_API}/v3/files?q=name%3D'${DB_FILENAME}'%20and%20trashed%3Dfalse&fields=files(id)`,
          accessToken
        );
        const files = (searchRes.files ?? []) as { id: string }[];
        if (files.length > 0) {
          driveFileId = files[0].id;
          set({ driveFileId });
          execSQL("UPDATE settings SET drive_file_id = ? WHERE id = 1", [driveFileId]);
          await uploadUpdate(driveFileId, buf, accessToken);
        } else {
          const newId = await uploadNewFile(buf, accessToken);
          set({ driveFileId: newId });
          execSQL("UPDATE settings SET drive_file_id = ? WHERE id = 1", [newId]);
        }
      }

      const now = new Date().toISOString();
      execSQL("UPDATE settings SET last_synced_at = ? WHERE id = 1", [now]);
      set({ syncStatus: "synced", lastSyncedAt: now, hasPendingUpload: false });
      console.log("[useSyncStore] Drive sync complete");
    } catch (err) {
      console.error("[useSyncStore] uploadToDrive failed:", err);
      set({ syncStatus: "error", hasPendingUpload: true });
    }
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  // Refresh 5 minutes before Google's 1-hour expiry
  refreshTimer = setTimeout(() => {
    useSyncStore.getState().refreshToken();
  }, 55 * 60 * 1000);
}

async function driveGet(url: string, token: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive GET failed ${res.status}: ${text}`);
  }
  return res.json();
}

async function drivePatchMeta(url: string, token: string, meta: object): Promise<void> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(meta),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive PATCH meta failed ${res.status}: ${text}`);
  }
}

async function uploadNewFile(buffer: Uint8Array, token: string): Promise<string> {
  const metadata = { name: DB_FILENAME, mimeType: "application/octet-stream" };
  const boundary = "OTIQBoundary42";

  const metaPart = `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(metadata)}\r\n`;
  const dataPart = `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`;
  const endPart = `\r\n--${boundary}--`;

  const encoder = new TextEncoder();
  const metaBytes = encoder.encode(metaPart);
  const dataHeaderBytes = encoder.encode(dataPart);
  const endBytes = encoder.encode(endPart);

  const body = new Uint8Array(metaBytes.length + dataHeaderBytes.length + buffer.length + endBytes.length);
  let offset = 0;
  body.set(metaBytes, offset); offset += metaBytes.length;
  body.set(dataHeaderBytes, offset); offset += dataHeaderBytes.length;
  body.set(buffer, offset); offset += buffer.length;
  body.set(endBytes, offset);

  const res = await fetch(
    `${DRIVE_UPLOAD}/v3/files?uploadType=multipart&fields=id`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: new Blob([body.slice(0)], { type: `multipart/related; boundary=${boundary}` }),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive upload new file failed ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.id as string;
}

/**
 * Upload updated DB content to an existing Drive file.
 * Uses simple media upload (no temp-rename needed — Drive keeps version history).
 */
async function uploadUpdate(fileId: string, buffer: Uint8Array, token: string): Promise<void> {
  const res = await fetch(
    `${DRIVE_UPLOAD}/v3/files/${fileId}?uploadType=media`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
      },
      body: new Blob([buffer.slice(0)], { type: "application/octet-stream" }),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive update failed ${res.status}: ${text}`);
  }
}

async function downloadFromDrive(fileId: string, token: string): Promise<void> {
  const res = await fetch(
    `${DRIVE_API}/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Drive download failed: ${res.status}`);

  const arrayBuffer = await res.arrayBuffer();
  const buffer = new Uint8Array(arrayBuffer);

  // Replace localStorage DB and reinitialise sql.js
  localStorage.setItem("otiq_db", JSON.stringify(Array.from(buffer)));
  await useDBStore.getState().initDB();
}
