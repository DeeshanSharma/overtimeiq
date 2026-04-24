"use client";

import { useState } from "react";
import { useSessionStore } from "@/stores/useSessionStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { Overlay } from "./ManualEntryModal";

interface Props { onClose: () => void }
const LOCATIONS = ["office", "home", "client"] as const;

export default function PunchInModal({ onClose }: Props) {
  const { punchIn } = useSessionStore();
  const { jobs, settings } = useSettingsStore();

  const [jobId, setJobId] = useState<number>(settings?.default_job_id ?? jobs[0]?.id ?? 1);
  const [location, setLocation] = useState<"office" | "home" | "client">("office");
  const [project, setProject] = useState("");

  function handlePunchIn() {
    punchIn(jobId, location, project || undefined);
    onClose();
  }

  return (
    <Overlay onClose={onClose}>
      <div style={{ padding: "28px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
          <p style={{ fontFamily: "var(--font-serif)", fontSize: "1.2rem", margin: 0 }}>Punch in</p>
          <button onClick={onClose} style={btnReset}>✕</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <p style={label}>Job</p>
            <select value={jobId} onChange={e => setJobId(Number(e.target.value))} style={input}>
              {jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
            </select>
          </div>

          <div>
            <p style={label}>Location</p>
            <div style={{ display: "flex", gap: "8px" }}>
              {LOCATIONS.map(loc => (
                <button
                  key={loc}
                  onClick={() => setLocation(loc)}
                  style={{
                    flex: 1, padding: "12px 4px", fontFamily: "var(--font-mono)",
                    fontSize: "0.78rem", cursor: "pointer", border: "1px solid",
                    borderColor: location === loc ? "#0e0e0e" : "#d1c9b8",
                    background: location === loc ? "#0e0e0e" : "white",
                    color: location === loc ? "#f5f0e8" : "#6b6b5e",
                  }}
                >{loc}</button>
              ))}
            </div>
          </div>

          <div>
            <p style={label}>Project (optional)</p>
            <input
              type="text" value={project} onChange={e => setProject(e.target.value)}
              placeholder="What are you working on?" style={input}
            />
          </div>
        </div>

        <button
          onClick={handlePunchIn}
          style={{ width: "100%", marginTop: "24px", padding: "14px", background: "#16a34a", color: "white", border: "none", fontFamily: "var(--font-mono)", fontSize: "0.85rem", fontWeight: 500, cursor: "pointer" }}
        >
          Start session
        </button>
      </div>
    </Overlay>
  );
}

const input: React.CSSProperties = { width: "100%", padding: "10px 12px", border: "1px solid #d1c9b8", fontFamily: "var(--font-mono)", fontSize: "0.82rem", background: "white", color: "#0e0e0e", outline: "none", boxSizing: "border-box" };
const label: React.CSSProperties = { fontSize: "0.68rem", letterSpacing: "0.08em", color: "#6b6b5e", textTransform: "uppercase", margin: "0 0 6px" };
const btnReset: React.CSSProperties = { background: "none", border: "none", cursor: "pointer", fontSize: "1rem", color: "#6b6b5e", padding: "4px" };
