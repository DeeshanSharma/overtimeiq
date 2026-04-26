/**
 * stores/useSyncStore.ts
 *
 * All settings writes use runSilent (not execSQL) to prevent the recursive
 * PATCH loop: execSQL → debounce → uploadToDrive → execSQL → ...
 *
 * Sync is triggered in two ways:
 *  1. On login (syncOnLogin) — after auth bootstrap completes
 *  2. On user data writes — via the 10s debounce in execSQL
 *  3. Manually — via the "Sync now" button calling syncNow()
 */

'use client';

import { create } from 'zustand';
// Token refresh is server-side via /api/google-token (GOOGLE_CLIENT_SECRET not available in browser)
import { useDBStore } from './useDBStore';

const DRIVE_API = 'https://www.googleapis.com/drive';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive';
const DB_FILENAME = 'overtimeiq.db';
const SYNC_SKEW_SECONDS = 30;

// Guard: prevent concurrent uploads
let uploadInProgress = false;

type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error' | 'offline';

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
  syncStatus: 'idle',
  lastSyncedAt: null,
  driveFileId: null,
  hasPendingUpload: false,

  setAccessToken: (token) => {
    set({ accessToken: token });
    scheduleTokenRefresh();
  },

  setDriveFileId: (id) => set({ driveFileId: id }),

  // ── Token refresh (server-side to keep client_secret off the browser) ──────
  refreshToken: async (): Promise<boolean> => {
    const { getOne } = useDBStore.getState();
    const row = getOne('SELECT google_refresh_token FROM settings WHERE id = 1');
    const rt = row?.google_refresh_token as string | null;

    if (!rt) {
      console.warn('[useSyncStore] No google_refresh_token in SQLite');
      return false;
    }

    try {
      // Server-side route — client_secret lives on the server, not in the browser bundle
      const res = await fetch('/api/google-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ refresh_token: rt }),
      });

      if (!res.ok) {
        console.warn('[useSyncStore] Token refresh failed:', await res.text());
        return false;
      }

      const { access_token } = await res.json();
      set({ accessToken: access_token });
      scheduleTokenRefresh();
      return true;
    } catch (err) {
      console.warn('[useSyncStore] Token refresh failed:', err);
      return false;
    }
  },

  // ── Called once after login bootstrap ────────────────────────────────────
  syncOnLogin: async (googleRefreshToken: string) => {
    set({ syncStatus: 'syncing' });

    // Get an access token — use the just-received refresh token directly
    // (SQLite may not have saved it yet at this point in bootstrap)
    let token: string;
    try {
      const res = await fetch('/api/google-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ refresh_token: googleRefreshToken }),
      });
      if (!res.ok) throw new Error(`Token fetch failed: ${await res.text()}`);
      const data = await res.json();
      token = data.access_token;
      set({ accessToken: token });
      scheduleTokenRefresh();
    } catch (err) {
      console.error('[useSyncStore] syncOnLogin — could not get access token:', err);
      set({ syncStatus: 'error' });
      return;
    }

    // Now do the actual Drive sync
    await performSync(token, set, get);
  },

  // ── Manual / debounce-triggered upload ───────────────────────────────────
  syncNow: async () => {
    if (uploadInProgress) return; // already running

    let { accessToken } = get();

    if (!accessToken) {
      const ok = await get().refreshToken();
      if (!ok) {
        set({ syncStatus: 'offline' });
        return;
      }
      accessToken = get().accessToken;
    }

    if (!accessToken) {
      set({ syncStatus: 'offline' });
      return;
    }

    await get().uploadToDrive();
  },

  // ── Core upload ───────────────────────────────────────────────────────────
  uploadToDrive: async () => {
    if (uploadInProgress) return;

    let { accessToken, driveFileId } = get();

    if (!accessToken) {
      const ok = await get().refreshToken();
      if (!ok) {
        set({ hasPendingUpload: true, syncStatus: 'offline' });
        return;
      }
      accessToken = get().accessToken!;
    }

    uploadInProgress = true;
    set({ syncStatus: 'syncing' });

    // runSilent — does NOT arm the debounce
    const { saveDB, runSilent } = useDBStore.getState();
    const buf = saveDB();

    if (!buf) {
      uploadInProgress = false;
      set({ syncStatus: 'error' });
      return;
    }

    try {
      if (driveFileId) {
        await uploadUpdate(driveFileId, buf, accessToken);
      } else {
        // No cached file ID — search Drive first
        const searchRes = await driveGet(
          `${DRIVE_API}/v3/files?q=name%3D'${DB_FILENAME}'%20and%20trashed%3Dfalse&fields=files(id)`,
          accessToken,
        );
        const files = (searchRes.files ?? []) as { id: string }[];

        if (files.length > 0) {
          driveFileId = files[0].id;
          set({ driveFileId });
          runSilent('UPDATE settings SET drive_file_id = ? WHERE id = 1', [driveFileId]);
          await uploadUpdate(driveFileId, buf, accessToken);
        } else {
          const newId = await uploadNewFile(buf, accessToken);
          set({ driveFileId: newId });
          runSilent('UPDATE settings SET drive_file_id = ? WHERE id = 1', [newId]);
        }
      }

      const now = new Date().toISOString();
      // runSilent — does NOT re-arm the debounce
      runSilent('UPDATE settings SET last_synced_at = ? WHERE id = 1', [now]);
      set({ syncStatus: 'synced', lastSyncedAt: now, hasPendingUpload: false });
      console.log('[useSyncStore] Drive sync complete');
    } catch (err) {
      console.error('[useSyncStore] uploadToDrive failed:', err);
      set({ syncStatus: 'error', hasPendingUpload: true });
    } finally {
      uploadInProgress = false;
    }
  },
}));

// ─── Shared sync logic ────────────────────────────────────────────────────────

async function performSync(token: string, set: (partial: Partial<SyncState>) => void, get: () => SyncState) {
  const { saveDB, runSilent, runQuery } = useDBStore.getState();

  try {
    const searchRes = await driveGet(
      `${DRIVE_API}/v3/files?q=name%3D'${DB_FILENAME}'%20and%20trashed%3Dfalse&fields=files(id,modifiedTime)`,
      token,
    );
    const files = (searchRes.files ?? []) as { id: string; modifiedTime: string }[];

    if (files.length === 0) {
      // First time — no file on Drive yet, upload current local DB
      const buf = saveDB();
      if (buf) {
        const fileId = await uploadNewFile(buf, token);
        set({ driveFileId: fileId });
        runSilent('UPDATE settings SET drive_file_id = ? WHERE id = 1', [fileId]);
        console.log('[useSyncStore] Created new Drive file:', fileId);
      }
    } else {
      const driveFile = files[0];
      set({ driveFileId: driveFile.id });
      runSilent('UPDATE settings SET drive_file_id = ? WHERE id = 1', [driveFile.id]);

      const settingsRow = runQuery('SELECT last_synced_at FROM settings WHERE id = 1')[0];
      const localLastSynced = settingsRow?.last_synced_at as string | null;

      const driveMs = new Date(driveFile.modifiedTime).getTime();
      const localMs = localLastSynced ? new Date(localLastSynced).getTime() : 0;
      const diffSeconds = Math.abs(driveMs - localMs) / 1000;

      if (diffSeconds <= SYNC_SKEW_SECONDS) {
        console.log('[useSyncStore] In sync — no action needed');
      } else if (driveMs > localMs) {
        await downloadFromDrive(driveFile.id, token);
        console.log('[useSyncStore] Downloaded newer version from Drive');
      } else {
        const buf = saveDB();
        if (buf) {
          await uploadUpdate(driveFile.id, buf, token);
          console.log('[useSyncStore] Uploaded newer local version to Drive');
        }
      }
    }

    const now = new Date().toISOString();
    runSilent('UPDATE settings SET last_synced_at = ? WHERE id = 1', [now]);
    set({ syncStatus: 'synced', lastSyncedAt: now });
  } catch (err) {
    console.error('[useSyncStore] performSync error:', err);
    set({ syncStatus: 'error' });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scheduleTokenRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(
    () => {
      useSyncStore.getState().refreshToken();
    },
    55 * 60 * 1000,
  );
}

async function driveGet(url: string, token: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive GET ${res.status}: ${await res.text()}`);
  return res.json();
}

async function uploadNewFile(buffer: Uint8Array, token: string): Promise<string> {
  const metadata = { name: DB_FILENAME, mimeType: 'application/octet-stream' };
  const boundary = 'OTIQBoundary42';
  const encoder = new TextEncoder();

  const metaPart = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(metadata)}\r\n`,
  );
  const dataHeaderPart = encoder.encode(`--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`);
  const endPart = encoder.encode(`\r\n--${boundary}--`);

  const body = new Uint8Array(metaPart.length + dataHeaderPart.length + buffer.length + endPart.length);
  let offset = 0;
  body.set(metaPart, offset);
  offset += metaPart.length;
  body.set(dataHeaderPart, offset);
  offset += dataHeaderPart.length;
  body.set(buffer, offset);
  offset += buffer.length;
  body.set(endPart, offset);

  const res = await fetch(`${DRIVE_UPLOAD}/v3/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: new Blob([body.buffer instanceof ArrayBuffer ? body : body.slice(0)]),
  });
  if (!res.ok) throw new Error(`Drive create failed ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.id as string;
}

async function uploadUpdate(fileId: string, buffer: Uint8Array, token: string): Promise<void> {
  const res = await fetch(`${DRIVE_UPLOAD}/v3/files/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
    },
    body: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
  });
  if (!res.ok) throw new Error(`Drive update failed ${res.status}: ${await res.text()}`);
}

async function downloadFromDrive(fileId: string, token: string): Promise<void> {
  const res = await fetch(`${DRIVE_API}/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive download failed: ${res.status}`);

  const buffer = new Uint8Array(await res.arrayBuffer());
  localStorage.setItem('otiq_db', JSON.stringify(Array.from(buffer)));
  // Force a full re-init so the new DB is loaded into sql.js memory
  await useDBStore.getState().initDB();
}
