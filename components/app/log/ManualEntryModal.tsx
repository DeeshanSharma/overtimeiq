"use client";

import { useState, useEffect } from "react";
import { useDBStore } from "@/stores/useDBStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { calcDurationHours } from "@/lib/earnings";
import dayjs from "dayjs";

interface EditableLog {
  id?: number;
  date?: string;
  start_time?: string;
  end_time?: string;
  location?: string;
  job_id?: number;
  notes?: string | null;
  project?: string | null;
  status?: string;
}

interface Props {
  onClose: () => void;
  editLog?: EditableLog | null;
}

const LOCATIONS = ["office", "home", "client"] as const;

export default function ManualEntryModal({ onClose, editLog }: Props) {
  const { execSQL } = useDBStore();
  const { jobs, settings, loadAll } = useSettingsStore();

  const today = dayjs().format("YYYY-MM-DD");

  const [date, setDate] = useState((editLog?.date) ?? today);
  const [startTime, setStartTime] = useState((editLog?.start_time) ?? "18:00");
  const [endTime, setEndTime] = useState((editLog?.end_time) ?? "20:00");
  const [location, setLocation] = useState<string>((editLog?.location) ?? "office");
  const [jobId, setJobId] = useState<number>(
    (editLog?.job_id) ?? (settings?.default_job_id ?? jobs[0]?.id ?? 1)
  );
  const [notes, setNotes] = useState((editLog?.notes) ?? "");
  const [project, setProject] = useState((editLog?.project) ?? "");
  const [status, setStatus] = useState((editLog?.status) ?? "draft");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { hours, crossesMidnight } = calcDurationHours(startTime, endTime);

  function handleSave() {
    if (!date || !startTime || !endTime) {
      setError("Date, start time and end time are required.");
      return;
    }
    if (hours <= 0) {
      setError("End time must be after start time (or crosses midnight).");
      return;
    }
    setSaving(true);
    const now = dayjs().toISOString();
    try {
      if (editLog?.id) {
        execSQL(
          `UPDATE logs SET date=?, start_time=?, end_time=?, crosses_midnight=?,
           duration_hours=?, location=?, job_id=?, notes=?, project=?, status=?, updated_at=?
           WHERE id=?`,
          [date, startTime, endTime, crossesMidnight ? 1 : 0, hours,
           location, jobId, notes || null, project || null, status, now, editLog.id]
        );
      } else {
        execSQL(
          `INSERT INTO logs (job_id, date, start_time, end_time, crosses_midnight,
           duration_hours, location, notes, project, status, source, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)`,
          [jobId, date, startTime, endTime, crossesMidnight ? 1 : 0, hours,
           location, notes || null, project || null, status, now, now]
        );
      }
      loadAll();
      onClose();
    } catch (e) {
      setError("Failed to save entry. Please try again.");
      setSaving(false);
    }
  }

  return (
    <Overlay onClose={onClose}>
      <div style={{ padding: "28px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
          <p style={{ fontFamily: "var(--font-serif)", fontSize: "1.2rem", margin: 0 }}>
            {editLog ? "Edit entry" : "Add entry"}
          </p>
          <button onClick={onClose} style={btnReset}>✕</button>
        </div>

        {error && <div style={errorBox}>{error}</div>}

        <div style={grid}>
          <Field label="Date">
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={input} />
          </Field>

          <Field label="Start time">
            <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} style={input} />
          </Field>

          <Field label="End time">
            <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} style={input} />
          </Field>

          <Field label="Duration">
            <div style={{ ...input, background: "#f5f0e8", color: crossesMidnight ? "#d97706" : "#0e0e0e", display: "flex", alignItems: "center" }}>
              {hours}h {crossesMidnight && <span style={{ marginLeft: "8px", fontSize: "0.7rem", color: "#d97706" }}>crosses midnight</span>}
            </div>
          </Field>

          <Field label="Job">
            <select value={jobId} onChange={e => setJobId(Number(e.target.value))} style={input}>
              {jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
            </select>
          </Field>

          <Field label="Location">
            <div style={{ display: "flex", gap: "8px" }}>
              {LOCATIONS.map(loc => (
                <button
                  key={loc}
                  onClick={() => setLocation(loc)}
                  style={{
                    flex: 1, padding: "10px 4px", fontFamily: "var(--font-mono)",
                    fontSize: "0.75rem", cursor: "pointer", border: "1px solid",
                    borderColor: location === loc ? "#0e0e0e" : "#d1c9b8",
                    background: location === loc ? "#0e0e0e" : "white",
                    color: location === loc ? "#f5f0e8" : "#6b6b5e",
                  }}
                >{loc}</button>
              ))}
            </div>
          </Field>

          <Field label="Project (optional)">
            <input type="text" value={project} onChange={e => setProject(e.target.value)}
              placeholder="e.g. Q4 audit" style={input} />
          </Field>

          <Field label="Notes (optional)">
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              rows={2} style={{ ...input, resize: "vertical" }} placeholder="Any notes…" />
          </Field>

          <Field label="Status">
            <select value={status} onChange={e => setStatus(e.target.value)} style={input}>
              <option value="draft">Draft</option>
              <option value="submitted">Submitted</option>
              <option value="approved">Approved</option>
            </select>
          </Field>
        </div>

        <div style={{ display: "flex", gap: "10px", marginTop: "24px" }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{ flex: 1, padding: "13px", background: "#0e0e0e", color: "#f5f0e8", border: "none", fontFamily: "var(--font-mono)", fontSize: "0.82rem", cursor: "pointer" }}
          >
            {saving ? "Saving…" : editLog ? "Save changes" : "Add entry"}
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

export function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(14,14,14,0.5)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: "#f5f0e8", width: "100%", maxWidth: "560px", maxHeight: "90vh", overflowY: "auto", borderTop: "2px solid #0e0e0e" }}
      >
        {children}
      </div>
    </div>
  );
}

const input: React.CSSProperties = {
  width: "100%", padding: "10px 12px", border: "1px solid #d1c9b8",
  fontFamily: "var(--font-mono)", fontSize: "0.82rem", background: "white",
  color: "#0e0e0e", outline: "none", boxSizing: "border-box",
};
const grid: React.CSSProperties = { display: "flex", flexDirection: "column", gap: "16px" };
const btnReset: React.CSSProperties = { background: "none", border: "none", cursor: "pointer", fontSize: "1rem", color: "#6b6b5e", padding: "4px" };
const errorBox: React.CSSProperties = { padding: "10px 14px", background: "#fef2f2", border: "1px solid #dc2626", marginBottom: "16px", fontSize: "0.78rem", color: "#dc2626" };
