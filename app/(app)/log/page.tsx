"use client";

// Full LogScreen implementation in Phase 1.
// Stub renders active session indicator and an empty state.

import { useSessionStore } from "@/stores/useSessionStore";
import { useDBStore } from "@/stores/useDBStore";

export default function LogPage() {
  const { activeSession, elapsed } = useSessionStore();
  const { runQuery } = useDBStore();

  const recentLogs = runQuery(
    "SELECT l.*, j.name as job_name FROM logs l LEFT JOIN jobs j ON l.job_id = j.id ORDER BY l.date DESC, l.start_time DESC LIMIT 20"
  );

  const fmt = (s: number) => {
    const h = Math.floor(s / 3600).toString().padStart(2, "0");
    const m = Math.floor((s % 3600) / 60).toString().padStart(2, "0");
    const sec = (s % 60).toString().padStart(2, "0");
    return `${h}:${m}:${sec}`;
  };

  return (
    <div style={{ padding: "24px 20px", maxWidth: "600px", margin: "0 auto" }}>

      {/* Active session banner */}
      {activeSession && (
        <div style={{ padding: "16px 20px", border: "1px solid #16a34a", background: "#f0fdf4", marginBottom: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <p style={{ fontSize: "0.7rem", letterSpacing: "0.08em", color: "#16a34a", textTransform: "uppercase", margin: "0 0 4px" }}>
                Live session
              </p>
              <p style={{ fontFamily: "var(--font-serif)", fontSize: "1.5rem", color: "#0e0e0e", margin: 0 }}>
                {fmt(elapsed)}
              </p>
            </div>
            <span style={{ fontSize: "0.75rem", color: "#6b6b5e" }}>{activeSession.location}</span>
          </div>
        </div>
      )}

      {/* Log entries */}
      {recentLogs.length === 0 ? (
        <div style={{ textAlign: "center", padding: "64px 0", color: "#6b6b5e" }}>
          <p style={{ fontFamily: "var(--font-serif)", fontSize: "1.3rem", color: "#0e0e0e", marginBottom: "8px" }}>No logs yet.</p>
          <p style={{ fontSize: "0.82rem" }}>Punch in or add an entry manually to get started.</p>
        </div>
      ) : (
        <div>
          {recentLogs.map((log) => (
            <div key={log.id as number} style={{ padding: "14px 0", borderBottom: "1px solid #d1c9b8", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <p style={{ fontSize: "0.82rem", margin: "0 0 2px" }}>{log.date as string}</p>
                <p style={{ fontSize: "0.75rem", color: "#6b6b5e", margin: 0 }}>
                  {log.start_time as string} – {log.end_time as string} · {log.duration_hours as number}h · {log.location as string}
                </p>
              </div>
              <span style={{ fontSize: "0.7rem", color: "#6b6b5e" }}>{log.job_name as string}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
