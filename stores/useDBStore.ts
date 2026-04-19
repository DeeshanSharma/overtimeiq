/**
 * stores/useDBStore.ts
 *
 * Central sql.js database store.
 * Manages the SQLite instance, exposes query helpers, and handles
 * localStorage persistence + Drive upload triggering.
 *
 * All DB access in the app goes through this store's methods —
 * never import sql.js directly in components.
 */

"use client";

import { create } from "zustand";
import {
  SCHEMA_SQL,
  SEED_SETTINGS_SQL,
  buildDefaultJobSQL,
  buildHolidaySeedSQL,
} from "@/lib/db";

const DB_STORAGE_KEY = "otiq_db";
const SCHEMA_VERSION = 1;

// Dynamically imported to avoid SSR issues with WASM
type SqlJs = typeof import("sql.js");
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
  getOne: (sql: string, params?: (string | number | null)[]) => Row | null;
  saveDB: () => Uint8Array | null;

  // Lifecycle
  initDB: () => Promise<void>;
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
      console.error("[useDBStore] runQuery error:", err, sql);
      return [];
    }
  },

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
      console.error("[useDBStore] execSQL error:", err, sql);
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
      // Write to localStorage
      const serialised = JSON.stringify(Array.from(buffer));
      localStorage.setItem(DB_STORAGE_KEY, serialised);
      return buffer;
    } catch (err) {
      console.error("[useDBStore] saveDB error:", err);
      return null;
    }
  },

  initDB: async () => {
    if (get().isReady || get().isLoading) return;
    set({ isLoading: true, error: null });

    try {
      // Dynamic import to avoid SSR — WASM only works in the browser
      const initSqlJs = (await import("sql.js")).default;
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

      // Check and update schema version
      const versionRow = db.exec(
        "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1"
      );
      const currentVersion = versionRow[0]?.values[0]?.[0] as number | undefined;

      if (!currentVersion || currentVersion < SCHEMA_VERSION) {
        db.run(
          `INSERT OR REPLACE INTO schema_version (version) VALUES (${SCHEMA_VERSION})`
        );
      }

      // Seed defaults if first-time
      db.run(SEED_SETTINGS_SQL);

      const now = new Date().toISOString();
      db.run(buildDefaultJobSQL(now));

      // Seed current year holidays
      const year = new Date().getFullYear();
      const holidaySql = buildHolidaySeedSQL(year);
      if (holidaySql) db.run(holidaySql);

      set({ db, isReady: true, isLoading: false });

      // Request durable storage to protect against browser eviction
      if (navigator.storage?.persist) {
        const persisted = await navigator.storage.persist();
        if (!persisted) {
          console.warn(
            "[useDBStore] Durable storage denied — data may be cleared by browser"
          );
          // useUIStore will pick this up and show the warning banner
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[useDBStore] initDB failed:", err);
      set({ error: msg, isLoading: false });
    }
  },
}));
