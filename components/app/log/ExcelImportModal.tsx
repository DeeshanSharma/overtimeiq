"use client";

import { useState, useRef } from "react";
import { useDBStore } from "@/stores/useDBStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { calcDurationHours } from "@/lib/earnings";
import { Overlay } from "./ManualEntryModal";
import dayjs from "dayjs";

interface Props { onClose: () => void }

interface ParsedRow {
  date: string;
  start_time: string;
  end_time: string;
  location: string;
  notes: string;
  project: string;
  duration_hours: number;
  crosses_midnight: boolean;
  _rowIndex: number;
  _error?: string;
  _isDuplicate?: boolean;
}

const REQUIRED_COLS = ["date", "start_time", "end_time"];

export default function ExcelImportModal({ onClose }: Props) {
  const { execSQL, runQuery } = useDBStore();
  const { settings, jobs, loadAll } = useSettingsStore();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<"upload" | "preview" | "done">("upload");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [importCount, setImportCount] = useState(0);
  const [skipCount, setSkipCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError(null);

    try {
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: "" });

      if (raw.length === 0) {
        setError("The spreadsheet is empty or could not be read.");
        setLoading(false);
        return;
      }

      // Normalise column names — lowercase, replace spaces with underscores
      const normalised = raw.map(row => {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(row)) {
          out[k.toLowerCase().replace(/\s+/g, "_")] = String(v ?? "").trim();
        }
        return out;
      });

      const parsed: ParsedRow[] = normalised.map((row, i) => {
        const date = normaliseDate(row.date ?? "");
        const startTime = normaliseTime(row.start_time ?? row.start ?? "");
        const endTime = normaliseTime(row.end_time ?? row.end ?? "");

        if (!date || !startTime || !endTime) {
          return { date, start_time: startTime, end_time: endTime, location: "office", notes: "", project: "", duration_hours: 0, crosses_midnight: false, _rowIndex: i + 2, _error: "Missing date, start or end time" };
        }

        const { hours, crossesMidnight } = calcDurationHours(startTime, endTime);
        const location = (row.location ?? "office").toLowerCase();
        const validLocations = ["office", "home", "client"];

        return {
          date,
          start_time: startTime,
          end_time: endTime,
          location: validLocations.includes(location) ? location : "office",
          notes: row.notes ?? "",
          project: row.project ?? "",
          duration_hours: hours,
          crosses_midnight: crossesMidnight,
          _rowIndex: i + 2,
        };
      });

      // Mark duplicates
      const existingKeys = new Set(
        runQuery("SELECT date, start_time, end_time FROM logs").map(
          r => `${r.date}|${r.start_time}|${r.end_time}`
        )
      );

      parsed.forEach(r => {
        if (!r._error && existingKeys.has(`${r.date}|${r.start_time}|${r.end_time}`)) {
          r._isDuplicate = true;
        }
      });

      setRows(parsed);
      setStep("preview");
    } catch (e) {
      setError("Could not parse the file. Make sure it is a valid .xlsx or .xls file.");
    }
    setLoading(false);
  }

  function handleImport() {
    const defaultJobId = settings?.default_job_id ?? jobs[0]?.id ?? 1;
    const now = dayjs().toISOString();
    let imported = 0;
    let skipped = 0;

    for (const row of rows) {
      if (row._error || row._isDuplicate) { skipped++; continue; }
      try {
        execSQL(
          `INSERT INTO logs (job_id, date, start_time, end_time, crosses_midnight, duration_hours, location, notes, project, status, source, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'import', ?, ?)`,
          [defaultJobId, row.date, row.start_time, row.end_time, row.crosses_midnight ? 1 : 0, row.duration_hours, row.location, row.notes || null, row.project || null, now, now]
        );
        imported++;
      } catch { skipped++; }
    }

    loadAll();
    setImportCount(imported);
    setSkipCount(skipped);
    setStep("done");
  }

  const validRows = rows.filter(r => !r._error && !r._isDuplicate);
  const errorRows = rows.filter(r => !!r._error);
  const dupRows = rows.filter(r => r._isDuplicate && !r._error);

  return (
    <Overlay onClose={onClose}>
      <div style={{ padding: "28px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <p style={{ fontFamily: "var(--font-serif)", fontSize: "1.2rem", margin: 0 }}>Import from Excel</p>
          <button onClick={onClose} style={btnReset}>✕</button>
        </div>

        {step === "upload" && (
          <>
            <div style={{ padding: "16px", border: "1px solid #d1c9b8", marginBottom: "16px", fontSize: "0.78rem", color: "#6b6b5e", lineHeight: 1.7 }}>
              <p style={{ margin: "0 0 8px", color: "#0e0e0e", fontWeight: 500 }}>Expected columns:</p>
              <code style={{ fontSize: "0.72rem" }}>date, start_time, end_time</code> (required)<br />
              <code style={{ fontSize: "0.72rem" }}>location, project, notes</code> (optional)<br />
              <p style={{ margin: "8px 0 0" }}>Dates: YYYY-MM-DD or DD/MM/YYYY · Times: HH:MM (24h)</p>
            </div>

            {error && <div style={errorBox}>{error}</div>}

            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} style={{ display: "none" }} />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={loading}
              style={{ width: "100%", padding: "13px", border: "2px dashed #d1c9b8", background: "none", fontFamily: "var(--font-mono)", fontSize: "0.82rem", cursor: "pointer", color: "#6b6b5e" }}
            >
              {loading ? "Parsing…" : "Click to select file (.xlsx, .xls, .csv)"}
            </button>
          </>
        )}

        {step === "preview" && (
          <>
            <div style={{ display: "flex", gap: "12px", marginBottom: "16px" }}>
              <Pill color="#16a34a" label={`${validRows.length} to import`} />
              {dupRows.length > 0 && <Pill color="#d97706" label={`${dupRows.length} duplicates (skipped)`} />}
              {errorRows.length > 0 && <Pill color="#dc2626" label={`${errorRows.length} errors`} />}
            </div>

            <div style={{ maxHeight: "300px", overflowY: "auto", border: "1px solid #d1c9b8", marginBottom: "16px" }}>
              {rows.slice(0, 50).map((row, i) => (
                <div key={i} style={{ padding: "10px 12px", borderBottom: "1px solid #d1c9b8", fontSize: "0.75rem", background: row._error ? "#fef2f2" : row._isDuplicate ? "#fffbeb" : "white" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#0e0e0e" }}>{row.date} · {row.start_time}–{row.end_time} · {row.duration_hours}h</span>
                    <span style={{ color: row._error ? "#dc2626" : row._isDuplicate ? "#d97706" : "#16a34a" }}>
                      {row._error ? "error" : row._isDuplicate ? "duplicate" : "ok"}
                    </span>
                  </div>
                  {row._error && <p style={{ margin: "2px 0 0", color: "#dc2626" }}>{row._error}</p>}
                </div>
              ))}
              {rows.length > 50 && <p style={{ padding: "8px 12px", fontSize: "0.72rem", color: "#6b6b5e" }}>…and {rows.length - 50} more rows</p>}
            </div>

            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={handleImport}
                disabled={validRows.length === 0}
                style={{ flex: 1, padding: "13px", background: validRows.length === 0 ? "#6b6b5e" : "#0e0e0e", color: "#f5f0e8", border: "none", fontFamily: "var(--font-mono)", fontSize: "0.82rem", cursor: validRows.length === 0 ? "not-allowed" : "pointer" }}
              >
                Import {validRows.length} {validRows.length === 1 ? "entry" : "entries"}
              </button>
              <button onClick={() => setStep("upload")} style={{ padding: "13px 16px", border: "1px solid #d1c9b8", background: "none", fontFamily: "var(--font-mono)", fontSize: "0.82rem", cursor: "pointer", color: "#6b6b5e" }}>
                Back
              </button>
            </div>
          </>
        )}

        {step === "done" && (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <p style={{ fontFamily: "var(--font-serif)", fontSize: "1.4rem", marginBottom: "8px" }}>Import complete</p>
            <p style={{ fontSize: "0.82rem", color: "#6b6b5e" }}>
              {importCount} imported · {skipCount} skipped
            </p>
            <button
              onClick={onClose}
              style={{ marginTop: "24px", padding: "12px 28px", background: "#0e0e0e", color: "#f5f0e8", border: "none", fontFamily: "var(--font-mono)", fontSize: "0.82rem", cursor: "pointer" }}
            >
              Done
            </button>
          </div>
        )}
      </div>
    </Overlay>
  );
}

function Pill({ color, label }: { color: string; label: string }) {
  return <span style={{ fontSize: "0.72rem", padding: "3px 10px", background: color + "15", color, border: `1px solid ${color}40` }}>{label}</span>;
}

function normaliseDate(raw: string): string {
  if (!raw) return "";
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  // DD/MM/YYYY or DD-MM-YYYY
  const m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  // Try dayjs
  const d = dayjs(raw);
  return d.isValid() ? d.format("YYYY-MM-DD") : "";
}

function normaliseTime(raw: string): string {
  if (!raw) return "";
  // HH:MM already
  if (/^\d{2}:\d{2}$/.test(raw)) return raw;
  // H:MM
  if (/^\d{1}:\d{2}$/.test(raw)) return raw.padStart(5, "0");
  // HHMM
  if (/^\d{4}$/.test(raw)) return `${raw.slice(0, 2)}:${raw.slice(2)}`;
  return "";
}

const btnReset: React.CSSProperties = { background: "none", border: "none", cursor: "pointer", fontSize: "1rem", color: "#6b6b5e", padding: "4px" };
const errorBox: React.CSSProperties = { padding: "10px 14px", background: "#fef2f2", border: "1px solid #dc2626", marginBottom: "12px", fontSize: "0.78rem", color: "#dc2626" };
