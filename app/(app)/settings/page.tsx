"use client";

// Full SettingsScreen implementation in Phase 1.

import { useSettingsStore } from "@/stores/useSettingsStore";
import { useSyncStore } from "@/stores/useSyncStore";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function SettingsPage() {
  const { jobs, settings } = useSettingsStore();
  const { syncStatus, lastSyncedAt } = useSyncStore();
  const router = useRouter();

  async function handleSignOut() {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.replace("/");
  }

  return (
    <div style={{ padding: "24px 20px", maxWidth: "600px", margin: "0 auto" }}>

      {/* Jobs */}
      <section style={{ marginBottom: "32px" }}>
        <p style={{ fontSize: "0.68rem", letterSpacing: "0.1em", color: "#6b6b5e", textTransform: "uppercase", marginBottom: "16px" }}>Jobs</p>
        {jobs.map(job => (
          <div key={job.id} style={{ padding: "14px 0", borderBottom: "1px solid #d1c9b8", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: job.color, display: "inline-block" }} />
              <div>
                <p style={{ fontSize: "0.85rem", margin: "0 0 2px" }}>{job.name}</p>
                <p style={{ fontSize: "0.72rem", color: "#6b6b5e", margin: 0 }}>₹{job.hourly_rate}/hr · {job.weekend_multiplier}× weekends · {job.holiday_multiplier}× holidays</p>
              </div>
            </div>
            {job.is_default === 1 && <span style={{ fontSize: "0.65rem", padding: "2px 6px", border: "1px solid #d1c9b8", color: "#6b6b5e" }}>default</span>}
          </div>
        ))}
      </section>

      {/* Sync */}
      <section style={{ marginBottom: "32px", padding: "20px", border: "1px solid #d1c9b8" }}>
        <p style={{ fontSize: "0.68rem", letterSpacing: "0.1em", color: "#6b6b5e", textTransform: "uppercase", marginBottom: "12px" }}>Drive Sync</p>
        <p style={{ fontSize: "0.78rem", color: "#6b6b5e", margin: "0 0 4px" }}>
          Status: <span style={{ color: "#0e0e0e" }}>{syncStatus}</span>
        </p>
        {lastSyncedAt && (
          <p style={{ fontSize: "0.72rem", color: "#6b6b5e", margin: 0 }}>
            Last synced: {new Date(lastSyncedAt).toLocaleString()}
          </p>
        )}
      </section>

      {/* Sign out */}
      <button
        onClick={handleSignOut}
        style={{
          padding: "11px 20px",
          border: "1px solid #0e0e0e",
          background: "none",
          fontFamily: "var(--font-mono)",
          fontSize: "0.78rem",
          cursor: "pointer",
          color: "#0e0e0e",
        }}
      >
        Sign out
      </button>
    </div>
  );
}
