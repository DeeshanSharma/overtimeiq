/**
 * lib/earnings.ts
 *
 * Earnings calculation engine.
 * Implements the two-segment midnight-crossing logic from Section 6 of the spec.
 * Pure functions — no side effects, no DB calls.
 */

import dayjs from "dayjs";

export interface Job {
  hourly_rate: number;
  weekend_multiplier: number;
  holiday_multiplier: number;
}

export interface HolidaySet {
  /** Set of active holiday date strings in "YYYY-MM-DD" format. */
  activeDates: Set<string>;
}

// ─── Multiplier logic ─────────────────────────────────────────────────────────

/**
 * Returns the rate multiplier for a given date.
 * Priority: holiday > weekend > 1.0 (weekday).
 */
export function getMultiplier(
  dateStr: string, // "YYYY-MM-DD"
  job: Job,
  holidays: HolidaySet
): number {
  if (holidays.activeDates.has(dateStr)) return job.holiday_multiplier;
  const dow = dayjs(dateStr).day(); // 0 = Sunday, 6 = Saturday
  if (dow === 0 || dow === 6) return job.weekend_multiplier;
  return 1.0;
}

// ─── Standard earning (no midnight crossing) ──────────────────────────────────

export function calcStandardEarning(
  durationHours: number,
  dateStr: string,
  job: Job,
  holidays: HolidaySet
): number {
  const multiplier = getMultiplier(dateStr, job, holidays);
  return round2(durationHours * job.hourly_rate * multiplier);
}

// ─── Midnight-crossing earning ────────────────────────────────────────────────

/**
 * Split earnings across two calendar days for sessions that cross midnight.
 * Segment A: from start_time until 24:00 on punch-in date.
 * Segment B: from 00:00 until end_time on punch-in date + 1.
 *
 * This correctly handles Dec 31 → Jan 1 (holiday) without any user input.
 */
export function calcMidnightCrossingEarning(
  startTime: string, // "HH:MM" 24h
  endTime: string,   // "HH:MM" 24h (on the following calendar day)
  dateStr: string,   // punch-in date "YYYY-MM-DD"
  job: Job,
  holidays: HolidaySet
): { total: number; segmentA: number; segmentB: number } {
  const [startH, startM] = startTime.split(":").map(Number);
  const [endH, endM] = endTime.split(":").map(Number);

  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  const minutesBeforeMidnight = 24 * 60 - startMinutes; // segment A
  const minutesAfterMidnight = endMinutes;               // segment B

  const hoursA = minutesBeforeMidnight / 60;
  const hoursB = minutesAfterMidnight / 60;

  const dateNext = dayjs(dateStr).add(1, "day").format("YYYY-MM-DD");

  const multiplierA = getMultiplier(dateStr, job, holidays);
  const multiplierB = getMultiplier(dateNext, job, holidays);

  const segmentA = round2(hoursA * job.hourly_rate * multiplierA);
  const segmentB = round2(hoursB * job.hourly_rate * multiplierB);

  return { total: round2(segmentA + segmentB), segmentA, segmentB };
}

// ─── Unified entry-level earning ──────────────────────────────────────────────

export interface LogEntry {
  date: string;
  start_time: string;
  end_time: string;
  duration_hours: number;
  crosses_midnight: number; // 0 | 1 (SQLite boolean)
}

export function calcEntryEarning(
  entry: LogEntry,
  job: Job,
  holidays: HolidaySet
): number {
  if (entry.crosses_midnight === 1) {
    return calcMidnightCrossingEarning(
      entry.start_time,
      entry.end_time,
      entry.date,
      job,
      holidays
    ).total;
  }
  return calcStandardEarning(entry.duration_hours, entry.date, job, holidays);
}

// ─── Duration helpers ─────────────────────────────────────────────────────────

/**
 * Calculate duration in hours between two HH:MM times.
 * Handles midnight crossing automatically (returns positive duration).
 */
export function calcDurationHours(
  startTime: string,
  endTime: string
): { hours: number; crossesMidnight: boolean } {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);

  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;

  if (endMin > startMin) {
    return { hours: round2((endMin - startMin) / 60), crossesMidnight: false };
  } else {
    // End time is on the next day
    const totalMin = 24 * 60 - startMin + endMin;
    return { hours: round2(totalMin / 60), crossesMidnight: true };
  }
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
