/**
 * Keys + helpers for SQLite blob + Google refresh token mirror in localStorage.
 * Refresh token mirrored so bootstrap can probe Drive before opening full DB.
 */

export const DB_STORAGE_KEY = 'otiq_db';
export const GOOGLE_REFRESH_LS_KEY = 'otiq_grefresh';

export function clearPersistedWorkData(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(DB_STORAGE_KEY);
    localStorage.removeItem(GOOGLE_REFRESH_LS_KEY);
  } catch {
    /* ignore */
  }
}

export function mirrorGoogleRefreshToLocalStorage(token: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (token) localStorage.setItem(GOOGLE_REFRESH_LS_KEY, token);
    else localStorage.removeItem(GOOGLE_REFRESH_LS_KEY);
  } catch {
    /* ignore */
  }
}

/** Read refresh token from serialized DB without full app init (bootstrap only). */
export async function peekGoogleRefreshTokenFromLocalDb(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  const stored = localStorage.getItem(DB_STORAGE_KEY);
  if (!stored) return null;
  try {
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs({
      locateFile: (file: string) => `/sql-wasm/${file}`,
    });
    const buffer = new Uint8Array(JSON.parse(stored));
    const db = new SQL.Database(buffer);
    const stmt = db.prepare('SELECT google_refresh_token FROM settings WHERE id = 1');
    if (!stmt.step()) {
      stmt.free();
      db.close();
      return null;
    }
    const row = stmt.getAsObject() as { google_refresh_token?: string | null };
    stmt.free();
    db.close();
    const t = row?.google_refresh_token;
    return typeof t === 'string' && t.length > 0 ? t : null;
  } catch {
    return null;
  }
}
