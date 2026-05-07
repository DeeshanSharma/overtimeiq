/**
 * stores/useDBStore.ts
 *
 * Two write methods:
 *  - execSQL   → writes SQLite + localStorage + arms Drive debounce (user data)
 *  - runSilent → writes SQLite + localStorage only, NO debounce (sync metadata)
 *
 * All writes inside useSyncStore must use runSilent to avoid the recursive
 * PATCH loop: execSQL → debounce → uploadToDrive → execSQL → ...
 */

'use client';

import { MIGRATION_V2_SQL, SCHEMA_SQL, SEED_SETTINGS_SQL, buildDefaultJobSQL, buildHolidaySeedSQL } from '@/lib/db';
import { DB_STORAGE_KEY } from '@/lib/localWorkData';
import { create } from 'zustand';
const SCHEMA_VERSION = 1;

// Dynamically imported to avoid SSR issues with WASM
type SqlJs = typeof import('sql.js');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Database = any;

interface Row {
  [key: string]: string | number | null | Uint8Array;
}

interface DBState {
  db: Database | null;
  isReady: boolean;
  isLoading: boolean;
  error: string | null;

  // Core query methods
  runQuery: (sql: string, params?: (string | number | null)[]) => Row[];
  execSQL: (sql: string, params?: (string | number | null)[]) => void;
  runSilent: (sql: string, params?: (string | number | null)[]) => void;
  getOne: (sql: string, params?: (string | number | null)[]) => Row | null;
  saveDB: () => Uint8Array | null;

  // Lifecycle — pass { force: true } after replacing localStorage blob (e.g. Drive download)
  initDB: (opts?: { force?: boolean }) => Promise<void>;
  /** Close sql.js + clear flags (call with clearPersistedWorkData on sign-out) */
  resetAfterLogout: () => void;

  _driveDebounceTrigger: (() => void) | null;
  setDriveDebounceTrigger: (fn: () => void) => void;
}

// Drive upload debounce timer handle
let driveDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export const useDBStore = create<DBState>((set, get) => ({
  db: null,
  isReady: false,
  isLoading: false,
  error: null,
  _driveDebounceTrigger: null,

  setDriveDebounceTrigger: (fn) => set({ _driveDebounceTrigger: fn }),

  resetAfterLogout: () => {
    const { db } = get();
    if (db) {
      try {
        db.close();
      } catch {
        /* ignore */
      }
    }
    set({ db: null, isReady: false, isLoading: false, error: null });
  },

  runQuery: (sql, params = []) => {
    const { db } = get();
    if (!db) return [];
    try {
      const stmt = db.prepare(sql);
      stmt.bind(params);
      const rows: Row[] = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as Row);
      }
      stmt.free();
      return rows;
    } catch (err) {
      console.error('[useDBStore] runQuery error:', err, sql);
      return [];
    }
  },

  // User-data writes — arms the Drive debounce
  execSQL: (sql, params = []) => {
    const { db, saveDB, _driveDebounceTrigger } = get();
    if (!db) return;
    try {
      db.run(sql, params);
      // Persist to localStorage immediately
      saveDB();
      // Debounce Drive upload — fires 10s after last write
      if (driveDebounceTimer) clearTimeout(driveDebounceTimer);
      driveDebounceTimer = setTimeout(() => {
        _driveDebounceTrigger?.();
      }, 10_000);
    } catch (err) {
      console.error('[useDBStore] execSQL error:', err, sql);
      throw err;
    }
  },

  // Sync-metadata writes — NO debounce trigger
  // Use this inside useSyncStore for last_synced_at, drive_file_id,
  // google_refresh_token, pro_token — anything the sync process itself writes.
  runSilent: (sql, params = []) => {
    const { db, saveDB } = get();
    if (!db) return;
    try {
      db.run(sql, params);
      saveDB();
    } catch (err) {
      console.error('[useDBStore] runSilent error:', err, sql);
      throw err;
    }
  },

  getOne: (sql, params = []) => {
    const rows = get().runQuery(sql, params);
    return rows[0] ?? null;
  },

  saveDB: () => {
    const { db } = get();
    if (!db) return null;
    try {
      const data = db.export();
      const buffer = new Uint8Array(data);
      localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(Array.from(buffer)));
      return buffer;
    } catch (err) {
      console.error('[useDBStore] saveDB error:', err);
      return null;
    }
  },

  initDB: async (opts) => {
    if (opts?.force) {
      const { db } = get();
      if (db) {
        try {
          db.close();
        } catch {
          /* ignore */
        }
      }
      set({ db: null, isReady: false, isLoading: false, error: null });
    } else if (get().isReady || get().isLoading) {
      return;
    }

    set({ isLoading: true, error: null });

    try {
      // Dynamic import to avoid SSR — WASM only works in the browser
      const initSqlJs = (await import('sql.js')).default;
      const SQL = await initSqlJs({
        // sql.js WASM file — served from node_modules via Next.js public
        locateFile: (file: string) => `/sql-wasm/${file}`,
      });

      let db: Database;

      // Try to restore from localStorage
      const stored = localStorage.getItem(DB_STORAGE_KEY);
      if (stored) {
        const buffer = new Uint8Array(JSON.parse(stored));
        db = new SQL.Database(buffer);
      } else {
        db = new SQL.Database();
      }

      // Run schema migrations
      db.run(SCHEMA_SQL);

      // Run data migrations (v1 → v2: add onboarding_done column)
      // Wrapped in try/catch - safe to fail if column already exists
      try {
        db.run(MIGRATION_V2_SQL);
      } catch {
        // Column likely already exists - this is fine
      }

      // Check and update schema version
      const versionRow = db.exec('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1');
      const currentVersion = versionRow[0]?.values[0]?.[0] as number | undefined;

      if (!currentVersion || currentVersion < SCHEMA_VERSION) {
        db.run(`INSERT OR REPLACE INTO schema_version (version) VALUES (${SCHEMA_VERSION})`);
      }

      // Seed defaults if first-time
      db.run(SEED_SETTINGS_SQL);
      db.run(buildDefaultJobSQL());

      const year = new Date().getFullYear();
      const holidaySql = buildHolidaySeedSQL(year);
      if (holidaySql) db.run(holidaySql);

      set({ db, isReady: true, isLoading: false });

      // Request durable storage to protect against browser eviction
      if (navigator.storage?.persist) {
        const persisted = await navigator.storage.persist();
        if (!persisted) {
          console.warn('[useDBStore] Durable storage denied — data may be cleared by browser');
          // useUIStore will pick this up and show the warning banner
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[useDBStore] initDB failed:', err);
      set({ error: msg, isLoading: false });
    }
  },
}));
