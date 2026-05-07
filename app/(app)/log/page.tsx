'use client';

import ExcelImportModal from '@/components/app/log/ExcelImportModal';
import ManualEntryModal from '@/components/app/log/ManualEntryModal';
import PunchInModal from '@/components/app/log/PunchInModal';
import { useDBStore } from '@/stores/useDBStore';
import { useSessionStore } from '@/stores/useSessionStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import dayjs from 'dayjs';
import { useState } from 'react';

type Modal = 'punchIn' | 'manual' | 'import' | 'edit' | null;

export default function LogPage() {
  const { activeSession, elapsed, punchOut } = useSessionStore();
  const { runQuery, execSQL } = useDBStore();
  const { settings, loadAll } = useSettingsStore();
  const [modal, setModal] = useState<Modal>(null);
  const [editLog, setEditLog] = useState<LogEntry | null>(null);

  const logs = runQuery(
    `SELECT l.*, j.name as job_name, j.color as job_color
     FROM logs l LEFT JOIN jobs j ON l.job_id = j.id
     ORDER BY l.date DESC, l.start_time DESC LIMIT 50`,
  ) as unknown as LogEntry[];

  function handlePunchOut() {
    const result = punchOut();
    if (!result) return;
    const session = useSessionStore.getState();
    // The punchOut already cleared the session — open manual modal to review/confirm entry
    const activeSnap = activeSession;
    if (!activeSnap) return;
    const now = dayjs();
    const punchInDay = dayjs(activeSnap.punch_in_time);
    const startTime = punchInDay.format('HH:mm');
    const endTime = now.format('HH:mm');
    const date = punchInDay.format('YYYY-MM-DD');
    const { execSQL: exec, runQuery: rq } = useDBStore.getState();
    const nowIso = now.toISOString();
    exec(
      `INSERT INTO logs (job_id, date, start_time, end_time, crosses_midnight, duration_hours,
       location, project, status, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'punch', ?, ?)`,
      [
        activeSnap.job_id,
        date,
        startTime,
        endTime,
        result.crossesMidnight ? 1 : 0,
        result.duration,
        activeSnap.location,
        activeSnap.project || null,
        nowIso,
        nowIso,
      ],
    );
    loadAll();
  }

  function handleDelete(id: number) {
    if (!confirm('Delete this entry?')) return;
    execSQL('DELETE FROM logs WHERE id = ?', [id]);
    loadAll();
  }

  function handleEdit(log: LogEntry) {
    setEditLog(log);
    setModal('edit');
  }

  const fmtElapsed = (s: number) => {
    const h = Math.floor(s / 3600)
      .toString()
      .padStart(2, '0');
    const m = Math.floor((s % 3600) / 60)
      .toString()
      .padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${h}:${m}:${sec}`;
  };

  const currency = settings?.currency_symbol ?? '₹';

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', padding: '0 0 80px' }}>
      {/* Active session */}
      {activeSession ? (
        <div style={{ margin: '16px 20px', padding: '20px', border: '1px solid #16a34a', background: '#f0fdf4' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p
                style={{
                  fontSize: '0.68rem',
                  letterSpacing: '0.1em',
                  color: '#16a34a',
                  textTransform: 'uppercase',
                  margin: '0 0 4px',
                }}>
                Live session
              </p>
              <p
                style={{
                  fontFamily: 'var(--font-serif)',
                  fontSize: '2rem',
                  color: '#0e0e0e',
                  margin: '0 0 4px',
                  letterSpacing: '-0.02em',
                }}>
                {fmtElapsed(elapsed)}
              </p>
              <p style={{ fontSize: '0.75rem', color: '#6b6b5e', margin: 0 }}>
                {activeSession.location}
                {activeSession.project && ` · ${activeSession.project}`}
              </p>
            </div>
            <button
              onClick={handlePunchOut}
              style={{
                padding: '12px 20px',
                background: '#dc2626',
                color: 'white',
                border: 'none',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.82rem',
                fontWeight: 500,
                cursor: 'pointer',
              }}>
              Punch out
            </button>
          </div>
        </div>
      ) : null}

      {/* Action bar */}
      <div style={{ display: 'flex', gap: '8px', padding: '16px 20px', borderBottom: '1px solid #d1c9b8' }}>
        {!activeSession ? (
          <div data-onboarding="punch-in">
            <ActionBtn onClick={() => setModal('punchIn')} primary>
              ● Punch in
            </ActionBtn>
          </div>
        ) : null}
        <ActionBtn onClick={() => setModal('manual')}>+ Manual entry</ActionBtn>
        <ActionBtn onClick={() => setModal('import')}>↑ Import</ActionBtn>
      </div>

      {/* Log list */}
      {logs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '64px 20px', color: '#6b6b5e' }}>
          <p style={{ fontFamily: 'var(--font-serif)', fontSize: '1.3rem', color: '#0e0e0e', marginBottom: '8px' }}>
            No entries yet.
          </p>
          <p style={{ fontSize: '0.82rem' }}>Punch in or add an entry manually to get started.</p>
        </div>
      ) : (
        <div>
          {logs.map((log) => (
            <LogRow
              key={log.id as number}
              log={log}
              currency={currency}
              onEdit={() => handleEdit(log)}
              onDelete={() => handleDelete(log.id as number)}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {modal === 'punchIn' && <PunchInModal onClose={() => setModal(null)} />}
      {modal === 'manual' && <ManualEntryModal onClose={() => setModal(null)} />}
      {modal === 'edit' && editLog && (
        <ManualEntryModal
          onClose={() => {
            setModal(null);
            setEditLog(null);
          }}
          editLog={editLog}
        />
      )}
      {modal === 'import' && <ExcelImportModal onClose={() => setModal(null)} />}
    </div>
  );
}

interface LogEntry {
  id: number;
  date: string;
  start_time: string;
  end_time: string;
  crosses_midnight: number;
  duration_hours: number;
  location: string;
  status: string;
  project: string | null;
  notes: string | null;
  job_name: string | null;
  job_color: string | null;
}

function LogRow({
  log,
  currency,
  onEdit,
  onDelete,
}: {
  log: LogEntry;
  currency: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);

  const statusColor: Record<string, string> = {
    draft: '#6b6b5e',
    submitted: '#d97706',
    approved: '#16a34a',
  };

  return (
    <div style={{ borderBottom: '1px solid #d1c9b8' }}>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{
          padding: '14px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          userSelect: 'none',
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: log.job_color ?? '#3B8BD4',
              flexShrink: 0,
            }}
          />
          <div>
            <p style={{ fontSize: '0.82rem', margin: '0 0 2px', fontWeight: 500 }}>{log.date}</p>
            <p style={{ fontSize: '0.72rem', color: '#6b6b5e', margin: 0 }}>
              {log.start_time} – {log.end_time}
              {log.crosses_midnight ? ' ↗' : ''}
              {' · '}
              {log.duration_hours}h{' · '}
              {log.location}
            </p>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p
            style={{
              fontSize: '0.72rem',
              color: statusColor[log.status] ?? '#6b6b5e',
              margin: '0 0 2px',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}>
            {log.status}
          </p>
          <p style={{ fontSize: '0.72rem', color: '#6b6b5e', margin: 0 }}>{log.job_name}</p>
        </div>
      </div>

      {open && (
        <div style={{ padding: '0 20px 14px 40px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {log.project ? (
            <span style={{ fontSize: '0.7rem', padding: '2px 8px', border: '1px solid #d1c9b8', color: '#6b6b5e' }}>
              {log.project}
            </span>
          ) : null}
          {log.notes ? <span style={{ fontSize: '0.72rem', color: '#6b6b5e', flex: 1 }}>{log.notes}</span> : null}
          <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              style={actionBtn}>
              Edit
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              style={{ ...actionBtn, color: '#dc2626', borderColor: '#dc2626' }}>
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionBtn({
  children,
  onClick,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '9px 14px',
        fontFamily: 'var(--font-mono)',
        fontSize: '0.78rem',
        cursor: 'pointer',
        border: primary ? 'none' : '1px solid #d1c9b8',
        background: primary ? '#0e0e0e' : 'none',
        color: primary ? '#f5f0e8' : '#0e0e0e',
        whiteSpace: 'nowrap',
      }}>
      {children}
    </button>
  );
}

const actionBtn: React.CSSProperties = {
  padding: '4px 12px',
  fontSize: '0.72rem',
  fontFamily: 'var(--font-mono)',
  border: '1px solid #d1c9b8',
  background: 'none',
  cursor: 'pointer',
  color: '#6b6b5e',
};
