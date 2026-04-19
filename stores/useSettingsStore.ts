/**
 * stores/useSettingsStore.ts
 * Reads and writes to the SQLite settings, jobs, and holidays tables.
 */

"use client";

import { create } from "zustand";
import { useDBStore } from "./useDBStore";

interface Job {
  id: number;
  name: string;
  hourly_rate: number;
  weekend_multiplier: number;
  holiday_multiplier: number;
  work_start: string;
  work_end: string;
  color: string;
  is_default: number;
}

interface Holiday {
  id: number;
  date: string;
  name: string;
  type: string;
  is_active: number;
  year: number;
}

interface Settings {
  default_job_id: number | null;
  currency_symbol: string;
  burnout_threshold_hours: number;
  last_synced_at: string | null;
  drive_file_id: string | null;
  holiday_auto_detect: number;
  google_refresh_token: string | null;
  pro_token: string | null;
  pro_plan: string | null;
}

interface SettingsState {
  settings: Settings | null;
  jobs: Job[];
  holidays: Holiday[];
  isLoaded: boolean;

  loadAll: () => void;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  upsertJob: (job: Partial<Job> & { name: string; hourly_rate: number }) => void;
  deleteJob: (id: number) => void;
  setDefaultJob: (id: number) => void;
  upsertHoliday: (holiday: Omit<Holiday, "id">) => void;
  deleteHoliday: (id: number) => void;
  toggleHoliday: (id: number, active: boolean) => void;
  saveProToken: (token: string | null) => void;
  saveGoogleRefreshToken: (token: string) => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  jobs: [],
  holidays: [],
  isLoaded: false,

  loadAll: () => {
    const { runQuery, getOne } = useDBStore.getState();
    const settingsRow = getOne("SELECT * FROM settings WHERE id = 1");
    const jobs = runQuery("SELECT * FROM jobs ORDER BY is_default DESC, name ASC");
    const year = new Date().getFullYear();
    const holidays = runQuery(
      "SELECT * FROM holidays WHERE year = ? ORDER BY date ASC",
      [year]
    );
    set({
      settings: settingsRow as unknown as Settings,
      jobs: jobs as unknown as Job[],
      holidays: holidays as unknown as Holiday[],
      isLoaded: true,
    });
  },

  updateSetting: (key, value) => {
    const { execSQL } = useDBStore.getState();
    execSQL(`UPDATE settings SET ${key} = ? WHERE id = 1`, [value as string | number | null]);
    set((s) => ({
      settings: s.settings ? { ...s.settings, [key]: value } : s.settings,
    }));
  },

  saveProToken: (token) => {
    const { execSQL } = useDBStore.getState();
    execSQL("UPDATE settings SET pro_token = ? WHERE id = 1", [token]);
    set((s) => ({
      settings: s.settings ? { ...s.settings, pro_token: token } : s.settings,
    }));
  },

  saveGoogleRefreshToken: (token) => {
    const { execSQL } = useDBStore.getState();
    execSQL("UPDATE settings SET google_refresh_token = ? WHERE id = 1", [token]);
    set((s) => ({
      settings: s.settings ? { ...s.settings, google_refresh_token: token } : s.settings,
    }));
  },

  upsertJob: (job) => {
    const { execSQL } = useDBStore.getState();
    const now = new Date().toISOString();
    if (job.id) {
      execSQL(
        `UPDATE jobs SET name=?, hourly_rate=?, weekend_multiplier=?, holiday_multiplier=?,
         work_start=?, work_end=?, color=? WHERE id=?`,
        [job.name, job.hourly_rate, job.weekend_multiplier ?? 1.5,
         job.holiday_multiplier ?? 2.0, job.work_start ?? "09:00",
         job.work_end ?? "18:00", job.color ?? "#3B8BD4", job.id]
      );
    } else {
      execSQL(
        `INSERT INTO jobs (name, hourly_rate, weekend_multiplier, holiday_multiplier,
          work_start, work_end, color, is_default, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        [job.name, job.hourly_rate, job.weekend_multiplier ?? 1.5,
         job.holiday_multiplier ?? 2.0, job.work_start ?? "09:00",
         job.work_end ?? "18:00", job.color ?? "#3B8BD4", now]
      );
    }
    get().loadAll();
  },

  deleteJob: (id) => {
    const { execSQL } = useDBStore.getState();
    execSQL("DELETE FROM jobs WHERE id = ? AND is_default = 0", [id]);
    get().loadAll();
  },

  setDefaultJob: (id) => {
    const { execSQL } = useDBStore.getState();
    execSQL("UPDATE jobs SET is_default = 0");
    execSQL("UPDATE jobs SET is_default = 1 WHERE id = ?", [id]);
    execSQL("UPDATE settings SET default_job_id = ? WHERE id = 1", [id]);
    get().loadAll();
  },

  upsertHoliday: (holiday) => {
    const { execSQL } = useDBStore.getState();
    execSQL(
      `INSERT INTO holidays (date, name, type, is_active, year)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET name=excluded.name, type=excluded.type,
         is_active=excluded.is_active`,
      [holiday.date, holiday.name, holiday.type, holiday.is_active ? 1 : 0, holiday.year]
    );
    get().loadAll();
  },

  deleteHoliday: (id) => {
    const { execSQL } = useDBStore.getState();
    execSQL("DELETE FROM holidays WHERE id = ? AND type != 'central'", [id]);
    get().loadAll();
  },

  toggleHoliday: (id, active) => {
    const { execSQL } = useDBStore.getState();
    execSQL("UPDATE holidays SET is_active = ? WHERE id = ?", [active ? 1 : 0, id]);
    get().loadAll();
  },
}));
