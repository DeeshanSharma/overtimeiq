"use client";

import { useRouter } from "next/navigation";
import { useSyncStore } from "@/stores/useSyncStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useProStore } from "@/stores/useProStore";

export default function TopBar() {
  const { syncStatus, syncNow } = useSyncStore();
  const { jobs } = useSettingsStore();
  const { isPro, currentPlan } = useProStore();
  const router = useRouter();

  const defaultJob = jobs.find(j => j.is_default === 1) ?? jobs[0];

  const syncIcon = {
    idle: "○",
    syncing: "◌",
    synced: "●",
    error: "◉",
    offline: "◎",
  }[syncStatus] ?? "○";

  const syncColor = {
    idle: "#6b6b5e",
    syncing: "#d97706",
    synced: "#16a34a",
    error: "#dc2626",
    offline: "#6b6b5e",
  }[syncStatus] ?? "#6b6b5e";

  return (
    <header style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "12px 20px",
      borderBottom: "1px solid #d1c9b8",
      background: "#f5f0e8",
      position: "sticky",
      top: 0,
      zIndex: 10,
    }}>
      {/* Left: wordmark */}
      <span style={{ fontFamily: "var(--font-serif)", fontSize: "1rem", letterSpacing: "-0.02em", color: "#0e0e0e" }}>
        OvertimeIQ
      </span>

      {/* Center: active job badge */}
      {defaultJob && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{
            width: "8px", height: "8px", borderRadius: "50%",
            background: defaultJob.color ?? "#3B8BD4",
            display: "inline-block",
          }} />
          <span style={{ fontSize: "0.75rem", color: "#6b6b5e" }}>{defaultJob.name}</span>
          {isPro() && (
            <span style={{ fontSize: "0.6rem", padding: "2px 6px", background: "#d97706", color: "white", letterSpacing: "0.06em" }}>
              PRO
            </span>
          )}
        </div>
      )}

      {/* Right: sync + settings */}
      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        <button
          onClick={() => syncNow()}
          title={`Drive sync: ${syncStatus}`}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.75rem", color: syncColor, display: "flex", alignItems: "center", gap: "5px", padding: 0 }}
        >
          <span style={{ fontSize: "0.6rem" }}>{syncIcon}</span>
          <span style={{ display: syncStatus === "syncing" ? "inline" : "none" }}>syncing</span>
        </button>
        <button
          onClick={() => router.push("/settings")}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1rem", color: "#6b6b5e", padding: 0, lineHeight: 1 }}
          title="Settings"
        >
          ⚙
        </button>
      </div>
    </header>
  );
}
