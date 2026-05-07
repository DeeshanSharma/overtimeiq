/**
 * lib/db.ts
 *
 * SQLite schema migrations and seed data.
 * All work data lives here. None of this is ever sent to Supabase.
 *
 * The DB is a single Uint8Array stored in localStorage under "otiq_db"
 * and mirrored to Google Drive as overtimeiq.db.
 */

// ─── Schema migrations ────────────────────────────────────────────────────────

/** Run on every boot. Creates tables if they don't exist. Idempotent. */
export const SCHEMA_SQL = `
-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);

-- Jobs / employer profiles
CREATE TABLE IF NOT EXISTS jobs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT    NOT NULL,
  hourly_rate         REAL    NOT NULL,
  weekend_multiplier  REAL    NOT NULL DEFAULT 1.5,
  holiday_multiplier  REAL    NOT NULL DEFAULT 2.0,
  work_start          TEXT    NOT NULL DEFAULT '09:00',
  work_end            TEXT    NOT NULL DEFAULT '18:00',
  color               TEXT    NOT NULL DEFAULT '#3B8BD4',
  is_default          INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Overtime session logs
CREATE TABLE IF NOT EXISTS logs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id              INTEGER REFERENCES jobs(id),
  date                TEXT    NOT NULL,
  start_time          TEXT    NOT NULL,
  end_time            TEXT    NOT NULL,
  crosses_midnight    INTEGER NOT NULL DEFAULT 0,
  duration_hours      REAL    NOT NULL,
  location            TEXT    NOT NULL DEFAULT 'office',
  project             TEXT    DEFAULT NULL,
  notes               TEXT    DEFAULT NULL,
  status              TEXT    NOT NULL DEFAULT 'draft',
  is_auto_punched_out INTEGER NOT NULL DEFAULT 0,
  source              TEXT    NOT NULL DEFAULT 'manual',
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL
);

-- Holiday calendar (per year)
CREATE TABLE IF NOT EXISTS holidays (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  date      TEXT    NOT NULL UNIQUE,
  name      TEXT    NOT NULL,
  type      TEXT    NOT NULL DEFAULT 'central',
  is_active INTEGER NOT NULL DEFAULT 1,
  year      INTEGER NOT NULL
);

-- In-progress punch-in state (singleton, id always = 1)
CREATE TABLE IF NOT EXISTS active_session (
  id              INTEGER PRIMARY KEY,
  job_id          INTEGER REFERENCES jobs(id),
  punch_in_time   TEXT    NOT NULL,
  location        TEXT    NOT NULL DEFAULT 'office',
  project         TEXT    DEFAULT NULL,
  auto_timeout_at TEXT    NOT NULL
);

-- User preferences (singleton, id always = 1)
CREATE TABLE IF NOT EXISTS settings (
  id                      INTEGER PRIMARY KEY,
  default_job_id          INTEGER REFERENCES jobs(id),
  currency_symbol         TEXT    NOT NULL DEFAULT '₹',
  burnout_threshold_hours REAL    NOT NULL DEFAULT 15.0,
  import_column_map       TEXT    DEFAULT NULL,
  last_synced_at          TEXT    DEFAULT NULL,
  drive_file_id           TEXT    DEFAULT NULL,
  holiday_auto_detect     INTEGER NOT NULL DEFAULT 1,
  google_refresh_token    TEXT    DEFAULT NULL,
  pro_token               TEXT    DEFAULT NULL,
  pro_plan                TEXT    DEFAULT NULL,
  onboarding_done         INTEGER NOT NULL DEFAULT 0
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_logs_date     ON logs(date);
CREATE INDEX IF NOT EXISTS idx_logs_job_id   ON logs(job_id);
CREATE INDEX IF NOT EXISTS idx_logs_status   ON logs(status);
CREATE INDEX IF NOT EXISTS idx_hols_date     ON holidays(date);
CREATE INDEX IF NOT EXISTS idx_hols_year     ON holidays(year);
`;

// ─── Default settings seed ────────────────────────────────────────────────────

export const SEED_SETTINGS_SQL = `
INSERT OR IGNORE INTO settings (id, currency_symbol, burnout_threshold_hours, onboarding_done)
VALUES (1, '₹', 15.0, 0);
`;

// ─── Migration SQL (v1 → v2) ────────────────────────────────────────────────
// Add onboarding_done column to existing databases. Safe to run multiple times.
// Wrapped in try/catch by caller - SQLite will error if column exists.

export const MIGRATION_V2_SQL = `
ALTER TABLE settings ADD COLUMN onboarding_done INTEGER NOT NULL DEFAULT 0;
`;

// ─── Default job seed ─────────────────────────────────────────────────────────

export function buildDefaultJobSQL(): string {
  return `
INSERT INTO jobs (name, hourly_rate, weekend_multiplier, holiday_multiplier,
  work_start, work_end, color, is_default)
SELECT 'My Job', 500, 1.5, 2.0, '09:00', '18:00', '#3B8BD4', 1
WHERE NOT EXISTS (SELECT 1 FROM jobs LIMIT 1);

UPDATE settings SET default_job_id = (SELECT id FROM jobs WHERE is_default = 1 LIMIT 1)
WHERE id = 1 AND default_job_id IS NULL;
`;
}

// ─── Central Gazetted Holidays 2025 ──────────────────────────────────────────
// Source: Ministry of Personnel, Public Grievances and Pensions

export const CENTRAL_HOLIDAYS_2025 = [
  { date: '2025-01-26', name: 'Republic Day' },
  { date: '2025-03-30', name: 'Holi' },
  { date: '2025-04-10', name: 'Id-ul-Fitr (Eid)' },
  { date: '2025-04-14', name: 'Dr. Ambedkar Jayanti' },
  { date: '2025-04-18', name: 'Good Friday' },
  { date: '2025-05-12', name: 'Buddha Purnima' },
  { date: '2025-06-07', name: 'Id-ul-Zuha (Bakrid)' },
  { date: '2025-07-06', name: 'Muharram' },
  { date: '2025-08-15', name: 'Independence Day' },
  { date: '2025-09-05', name: 'Janmashtami' },
  { date: '2025-10-02', name: 'Gandhi Jayanti' },
  { date: '2025-10-02', name: 'Mahatma Gandhi Jayanti' },
  { date: '2025-10-20', name: 'Dussehra' },
  { date: '2025-11-05', name: 'Milad-un-Nabi' },
  { date: '2025-11-20', name: 'Guru Nanak Jayanti' },
  { date: '2025-10-23', name: 'Diwali (Deepawali)' },
  { date: '2025-12-25', name: 'Christmas Day' },
];

export function buildHolidaySeedSQL(year: number): string {
  const holidays = year === 2025 ? CENTRAL_HOLIDAYS_2025 : [];
  if (holidays.length === 0) return '';

  const rows = holidays
    .filter((h, i, arr) => arr.findIndex((x) => x.date === h.date) === i) // dedupe
    .map((h) => `('${h.date}', '${h.name.replace(/'/g, "''")}', 'central', 1, ${year})`)
    .join(',\n  ');

  return `INSERT OR IGNORE INTO holidays (date, name, type, is_active, year)
VALUES
  ${rows};`;
}
