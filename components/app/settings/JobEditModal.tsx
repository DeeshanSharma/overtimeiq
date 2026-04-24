"use client";

import { useState } from "react";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { Overlay } from "../log/ManualEntryModal";

interface Job {
  id?: number;
  name: string;
  hourly_rate: number;
  weekend_multiplier: number;
  holiday_multiplier: number;
  work_start: string;
  work_end: string;
  color: string;
  is_default?: number;
}

interface Props {
  job?: Job | null;
  onClose: () => void;
}

const COLORS = ["#3B8BD4", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#db2777"];

export default function JobEditModal({ job, onClose }: Props) {
  const { upsertJob, setDefaultJob } = useSettingsStore();

  const [name, setName] = useState(job?.name ?? "");
  const [rate, setRate] = useState(String(job?.hourly_rate ?? ""));
  const [weekendMult, setWeekendMult] = useState(String(job?.weekend_multiplier ?? "1.5"));
  const [holidayMult, setHolidayMult] = useState(String(job?.holiday_multiplier ?? "2.0"));
  const [workStart, setWorkStart] = useState(job?.work_start ?? "09:00");
  const [workEnd, setWorkEnd] = useState(job?.work_end ?? "18:00");
  const [color, setColor] = useState(job?.color ?? COLORS[0]);
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    if (!name.trim()) { setError("Job name is required."); return; }
    if (!rate || isNaN(Number(rate)) || Number(rate) <= 0) { setError("Enter a valid hourly rate."); return; }

    upsertJob({
      ...(job?.id ? { id: job.id } : {}),
      name: name.trim(),
      hourly_rate: Number(rate),
      weekend_multiplier: Number(weekendMult) || 1.5,
      holiday_multiplier: Number(holidayMult) || 2.0,
      work_start: workStart,
      work_end: workEnd,
      color,
    });
    onClose();
  }

  return (
    <Overlay onClose={onClose}>
      <div style={{ padding: "28px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
          <p style={{ fontFamily: "var(--font-serif)", fontSize: "1.2rem", margin: 0 }}>
            {job?.id ? "Edit job" : "Add job"}
          </p>
          <button onClick={onClose} style={btnReset}>✕</button>
        </div>

        {error && <div style={errorBox}>{error}</div>}

        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <Field label="Job name">
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Acme Corp" style={input} />
          </Field>

          <Field label={`Hourly rate (${useSettingsStore.getState().settings?.currency_symbol ?? "₹"})`}>
            <input type="number" value={rate} onChange={e => setRate(e.target.value)}
              placeholder="500" min="0" style={input} />
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <Field label="Weekend multiplier">
              <input type="number" value={weekendMult} onChange={e => setWeekendMult(e.target.value)}
                step="0.1" min="1" style={input} />
            </Field>
            <Field label="Holiday multiplier">
              <input type="number" value={holidayMult} onChange={e => setHolidayMult(e.target.value)}
                step="0.1" min="1" style={input} />
            </Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <Field label="Work start">
              <input type="time" value={workStart} onChange={e => setWorkStart(e.target.value)} style={input} />
            </Field>
            <Field label="Work end">
              <input type="time" value={workEnd} onChange={e => setWorkEnd(e.target.value)} style={input} />
            </Field>
          </div>

          <Field label="Color">
            <div style={{ display: "flex", gap: "10px" }}>
              {COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  style={{
                    width: "28px", height: "28px", borderRadius: "50%",
                    background: c, border: color === c ? "3px solid #0e0e0e" : "2px solid transparent",
                    cursor: "pointer", padding: 0,
                  }}
                />
              ))}
              <input type="color" value={color} onChange={e => setColor(e.target.value)}
                style={{ width: "28px", height: "28px", border: "1px solid #d1c9b8", padding: 0, cursor: "pointer", background: "none" }} />
            </div>
          </Field>
        </div>

        <div style={{ display: "flex", gap: "10px", marginTop: "24px" }}>
          <button
            onClick={handleSave}
            style={{ flex: 1, padding: "13px", background: "#0e0e0e", color: "#f5f0e8", border: "none", fontFamily: "var(--font-mono)", fontSize: "0.82rem", cursor: "pointer" }}
          >
            {job?.id ? "Save changes" : "Add job"}
          </button>
          <button onClick={onClose} style={{ padding: "13px 20px", border: "1px solid #d1c9b8", background: "none", fontFamily: "var(--font-mono)", fontSize: "0.82rem", cursor: "pointer", color: "#6b6b5e" }}>
            Cancel
          </button>
        </div>
      </div>
    </Overlay>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p style={{ fontSize: "0.68rem", letterSpacing: "0.08em", color: "#6b6b5e", textTransform: "uppercase", margin: "0 0 6px" }}>{label}</p>
      {children}
    </div>
  );
}

const input: React.CSSProperties = { width: "100%", padding: "10px 12px", border: "1px solid #d1c9b8", fontFamily: "var(--font-mono)", fontSize: "0.82rem", background: "white", color: "#0e0e0e", outline: "none", boxSizing: "border-box" };
const btnReset: React.CSSProperties = { background: "none", border: "none", cursor: "pointer", fontSize: "1rem", color: "#6b6b5e", padding: "4px" };
const errorBox: React.CSSProperties = { padding: "10px 14px", background: "#fef2f2", border: "1px solid #dc2626", marginBottom: "16px", fontSize: "0.78rem", color: "#dc2626" };
