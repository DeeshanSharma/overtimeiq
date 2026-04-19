"use client";

// Full DashboardScreen implementation in Phase 2.

import { useDBStore } from "@/stores/useDBStore";
import { useProStore } from "@/stores/useProStore";

export default function DashboardPage() {
  const { runQuery } = useDBStore();
  const { isPro } = useProStore();

  const stats = runQuery(`
    SELECT
      COUNT(*) as total_sessions,
      ROUND(SUM(duration_hours), 1) as total_hours,
      COUNT(DISTINCT date) as ot_days
    FROM logs
    ${isPro() ? "" : "WHERE date >= date('now', '-3 months')"}
  `)[0];

  return (
    <div style={{ padding: "24px 20px", maxWidth: "600px", margin: "0 auto" }}>
      <p style={{ fontSize: "0.68rem", letterSpacing: "0.1em", color: "#6b6b5e", textTransform: "uppercase", marginBottom: "24px" }}>
        {isPro() ? "All time" : "Last 3 months"}
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1px", background: "#d1c9b8", marginBottom: "32px" }}>
        {[
          { label: "Sessions", value: stats?.total_sessions ?? 0 },
          { label: "Hours", value: stats?.total_hours ?? "0.0" },
          { label: "Days", value: stats?.ot_days ?? 0 },
        ].map(card => (
          <div key={card.label} style={{ padding: "20px", background: "#f5f0e8" }}>
            <p style={{ fontFamily: "var(--font-serif)", fontSize: "2rem", color: "#0e0e0e", margin: "0 0 4px" }}>{String(card.value)}</p>
            <p style={{ fontSize: "0.7rem", color: "#6b6b5e", margin: 0, textTransform: "uppercase", letterSpacing: "0.06em" }}>{card.label}</p>
          </div>
        ))}
      </div>

      <div style={{ padding: "24px", border: "1px solid #d1c9b8", color: "#6b6b5e", textAlign: "center" }}>
        <p style={{ fontSize: "0.82rem" }}>Full dashboard charts coming in Phase 2.</p>
      </div>
    </div>
  );
}
