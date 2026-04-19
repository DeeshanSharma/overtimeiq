/**
 * lib/gating.ts
 *
 * Feature gate helpers.
 * All checks read from the verified pro_plan value exposed by useProStore —
 * never from raw SQLite columns. The plan value is populated only after
 * verifyProToken() passes all 7 cryptographic checks.
 */

import type { ProPlan } from "./token";

const PRO_PLANS: ProPlan[] = [
  "beta_free",
  "founding_monthly",
  "pro_monthly",
  "pro_annual",
];

export function isPro(plan: ProPlan): boolean {
  return PRO_PLANS.includes(plan);
}

/** Features and their gate status. */
export const FEATURES = {
  /** Log list and dashboard visibility: free = last 3 months, pro = all history. */
  fullHistory: (plan: ProPlan) => isPro(plan),

  /** Excel import from external files. */
  excelImport: (plan: ProPlan) => isPro(plan),

  /** Excel export of log data. Also requires an export token from the server. */
  excelExport: (plan: ProPlan) => isPro(plan),

  /** PDF export of date-range OT report. Also requires an export token. */
  pdfExport: (plan: ProPlan) => isPro(plan),

  /** Multiple job profiles (free: 1 job max). */
  multipleJobs: (plan: ProPlan) => isPro(plan),

  /** Project/task tagging on log entries. */
  projectTagging: (plan: ProPlan) => isPro(plan),

  /** Draft → Submitted → Approved submission workflow. */
  submissionStatus: (plan: ProPlan) => isPro(plan),
} as const;

export type FeatureName = keyof typeof FEATURES;

/** Get the SQL date filter for visibility-gated queries. */
export function getVisibilityFilter(plan: ProPlan): string {
  if (isPro(plan)) return "1=1"; // no filter
  return `date >= date('now', '-3 months')`;
}

/** Request a short-lived export token from the server (60s expiry).
 *  The server checks Supabase directly — this gate cannot be bypassed offline. */
export async function fetchExportToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/export-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "export" }),
      credentials: "include",
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.token ?? null;
  } catch {
    return null;
  }
}
