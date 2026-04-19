/**
 * stores/useSessionStore.ts
 * Active punch-in state, live timer tick, auto-timeout scheduler.
 */

"use client";

import { create } from "zustand";
import { useDBStore } from "./useDBStore";
import dayjs from "dayjs";

const AUTO_TIMEOUT_HOURS = 6;
const AUTO_TIMEOUT_DURATION = 4.0;

interface ActiveSession {
  job_id: number;
  punch_in_time: string;
  location: string;
  project: string | null;
  auto_timeout_at: string;
}

interface SessionState {
  activeSession: ActiveSession | null;
  elapsed: number; // seconds since punch-in
  isLoaded: boolean;

  loadSession: () => void;
  punchIn: (jobId: number, location: string, project?: string) => void;
  punchOut: () => { duration: number; crossesMidnight: boolean } | null;
  clearSession: () => void;
  tickElapsed: () => void;
}

let tickInterval: ReturnType<typeof setInterval> | null = null;
let autoTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

export const useSessionStore = create<SessionState>((set, get) => ({
  activeSession: null,
  elapsed: 0,
  isLoaded: false,

  loadSession: () => {
    const { getOne } = useDBStore.getState();
    const row = getOne("SELECT * FROM active_session WHERE id = 1");
    if (row) {
      const session = row as unknown as ActiveSession;
      const elapsed = Math.floor(
        (Date.now() - new Date(session.punch_in_time).getTime()) / 1000
      );
      set({ activeSession: session, elapsed, isLoaded: true });
      startTick(set, get);
      scheduleAutoTimeout(session, get);
    } else {
      set({ isLoaded: true });
    }
  },

  punchIn: (jobId, location, project: string | null = null) => {
    const { execSQL } = useDBStore.getState();
    const now = new Date().toISOString();
    const autoTimeoutAt = dayjs().add(AUTO_TIMEOUT_HOURS, "hour").toISOString();

    execSQL("DELETE FROM active_session");
    execSQL(
      `INSERT INTO active_session (id, job_id, punch_in_time, location, project, auto_timeout_at)
       VALUES (1, ?, ?, ?, ?, ?)`,
      [jobId, now, location, project, autoTimeoutAt]
    );

    const session: ActiveSession = { job_id: jobId, punch_in_time: now, location, project, auto_timeout_at: autoTimeoutAt };
    set({ activeSession: session, elapsed: 0 });
    startTick(set, get);
    scheduleAutoTimeout(session, get);
  },

  punchOut: () => {
    const { activeSession } = get();
    if (!activeSession) return null;

    const punchIn = dayjs(activeSession.punch_in_time);
    const punchOut = dayjs();
    const durationMinutes = punchOut.diff(punchIn, "minute");
    const durationHours = Math.round((durationMinutes / 60) * 100) / 100;
    const crossesMidnight = punchIn.date() !== punchOut.date();

    const { execSQL } = useDBStore.getState();
    execSQL("DELETE FROM active_session");

    get().clearSession();
    return { duration: durationHours, crossesMidnight };
  },

  clearSession: () => {
    if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
    if (autoTimeoutTimer) { clearTimeout(autoTimeoutTimer); autoTimeoutTimer = null; }
    set({ activeSession: null, elapsed: 0 });
  },

  tickElapsed: () => set((s) => ({ elapsed: s.elapsed + 1 })),
}));

// @ts-ignore
function startTick(set: ReturnType<typeof create<SessionState>>["setState"] extends never ? never : typeof import("zustand").create<SessionState> extends (f: (set: infer S) => unknown) => unknown ? S : never, get: () => SessionState) {
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = setInterval(() => {
    get().tickElapsed();
  }, 1000);
}

function scheduleAutoTimeout(session: ActiveSession, get: () => SessionState) {
  if (autoTimeoutTimer) clearTimeout(autoTimeoutTimer);
  const msUntilTimeout = new Date(session.auto_timeout_at).getTime() - Date.now();
  if (msUntilTimeout <= 0) {
    triggerAutoTimeout(get);
    return;
  }
  autoTimeoutTimer = setTimeout(() => triggerAutoTimeout(get), msUntilTimeout);
}

function triggerAutoTimeout(get: () => SessionState) {
  const { activeSession } = get();
  if (!activeSession) return;

  const { execSQL } = useDBStore.getState();
  const now = new Date().toISOString();
  const punchInDate = activeSession.punch_in_time.split("T")[0];
  const punchInTime = activeSession.punch_in_time.split("T")[1].substring(0, 5);

  execSQL(
    `INSERT INTO logs (job_id, date, start_time, end_time, crosses_midnight, duration_hours,
      location, project, status, is_auto_punched_out, source, created_at, updated_at)
     VALUES (?, ?, ?, '00:00', 0, ?, ?, ?, 'draft', 1, 'punch', ?, ?)`,
    [activeSession.job_id, punchInDate, punchInTime,
     AUTO_TIMEOUT_DURATION, activeSession.location, activeSession.project, now, now]
  );

  execSQL("DELETE FROM active_session");
  get().clearSession();
  console.warn("[useSessionStore] Auto-timeout triggered — session logged as 4h");
}
