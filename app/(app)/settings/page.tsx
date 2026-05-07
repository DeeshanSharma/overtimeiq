'use client';

import JobEditModal from '@/components/app/settings/JobEditModal';
import { clearPersistedWorkData } from '@/lib/localWorkData';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { useDBStore } from '@/stores/useDBStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useSyncStore } from '@/stores/useSyncStore';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Job {
  id: number;
  name: string;
  hourly_rate: number;
  weekend_multiplier: number;
  holiday_multiplier: number;
  work_start: string;
  work_end: string;
  color: string;
  is_default: number;
}

export default function SettingsPage() {
  const { jobs, settings, deleteJob, setDefaultJob, updateSetting, loadAll } = useSettingsStore();
  const { syncStatus, lastSyncedAt, syncNow, uploadToDrive } = useSyncStore();
  const { execSQL, resetAfterLogout } = useDBStore();
  const router = useRouter();

  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [addingJob, setAddingJob] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [currency, setCurrency] = useState(settings?.currency_symbol ?? '₹');
  const [burnout, setBurnout] = useState(String(settings?.burnout_threshold_hours ?? '15'));

  async function handleManualSync() {
    setSyncing(true);
    try {
      await uploadToDrive();
    } catch {}
    setSyncing(false);
  }

  function handleSaveGeneral() {
    updateSetting('currency_symbol', currency);
    updateSetting('burnout_threshold_hours', Number(burnout) || 15);
  }

  async function handleSignOut() {
    clearPersistedWorkData();
    resetAfterLogout();
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.replace('/login');
  }

  function handleDeleteJob(id: number, isDefault: boolean) {
    if (isDefault) {
      alert('Cannot delete the default job. Set another job as default first.');
      return;
    }
    if (!confirm("Delete this job? All logs linked to it will remain but won't have a job.")) return;
    deleteJob(id);
  }

  const syncStatusColor: Record<string, string> = {
    idle: '#6b6b5e',
    syncing: '#d97706',
    synced: '#16a34a',
    error: '#dc2626',
    offline: '#6b6b5e',
  };

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', padding: '24px 20px 80px' }}>
      {/* ── Jobs ─────────────────────────── */}
      <section style={{ marginBottom: '36px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <p style={sectionLabel}>Jobs</p>
          <button onClick={() => setAddingJob(true)} style={outlineBtn}>
            + Add job
          </button>
        </div>

        {jobs.map((job) => (
          <div key={job.id} style={{ padding: '14px 0', borderBottom: '1px solid #d1c9b8' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span
                style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  background: job.color,
                  display: 'inline-block',
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <p style={{ fontSize: '0.85rem', margin: 0, fontWeight: 500 }}>{job.name}</p>
                  {job.is_default === 1 && (
                    <span
                      style={{
                        fontSize: '0.6rem',
                        padding: '1px 6px',
                        border: '1px solid #d1c9b8',
                        color: '#6b6b5e',
                        letterSpacing: '0.06em',
                      }}>
                      DEFAULT
                    </span>
                  )}
                </div>
                <p style={{ fontSize: '0.72rem', color: '#6b6b5e', margin: '3px 0 0' }}>
                  {settings?.currency_symbol ?? '₹'}
                  {job.hourly_rate}/hr · {job.weekend_multiplier}× weekends · {job.holiday_multiplier}× holidays ·{' '}
                  {job.work_start}–{job.work_end}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button onClick={() => setEditingJob(job)} style={ghostBtn}>
                  Edit
                </button>
                {job.is_default !== 1 && (
                  <>
                    <button onClick={() => setDefaultJob(job.id)} style={ghostBtn}>
                      Set default
                    </button>
                    <button
                      onClick={() => handleDeleteJob(job.id, job.is_default === 1)}
                      style={{ ...ghostBtn, color: '#dc2626', borderColor: '#dc2626' }}>
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* ── General ──────────────────────── */}
      <section style={{ marginBottom: '36px' }}>
        <p style={{ ...sectionLabel, marginBottom: '16px' }}>General</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <p style={fieldLabel}>Currency symbol</p>
            <input
              type="text"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              maxLength={4}
              style={{ ...input, width: '80px' }}
            />
          </div>
          <div>
            <p style={fieldLabel}>Burnout threshold (hours/week)</p>
            <input
              type="number"
              value={burnout}
              onChange={(e) => setBurnout(e.target.value)}
              min="1"
              max="80"
              style={{ ...input, width: '100px' }}
            />
          </div>
          <button onClick={handleSaveGeneral} style={{ ...outlineBtn, alignSelf: 'flex-start' }}>
            Save
          </button>
        </div>
      </section>

      {/* ── Drive Sync ───────────────────── */}
      <section style={{ marginBottom: '36px', padding: '20px', border: '1px solid #d1c9b8' }}>
        <div
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
          <p style={{ ...sectionLabel, margin: 0 }}>Drive sync</p>
          <button
            data-onboarding="sync-now"
            onClick={handleManualSync}
            disabled={syncing || syncStatus === 'syncing'}
            style={{
              padding: '7px 14px',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.75rem',
              cursor: 'pointer',
              border: '1px solid #0e0e0e',
              background: 'none',
              opacity: syncing || syncStatus === 'syncing' ? 0.5 : 1,
            }}>
            {syncing || syncStatus === 'syncing' ? 'Syncing…' : '↑ Sync now'}
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <span
            style={{
              width: '7px',
              height: '7px',
              borderRadius: '50%',
              background: syncStatusColor[syncStatus] ?? '#6b6b5e',
              display: 'inline-block',
            }}
          />
          <p
            style={{
              fontSize: '0.78rem',
              margin: 0,
              color: syncStatusColor[syncStatus] ?? '#6b6b5e',
              textTransform: 'capitalize',
            }}>
            {syncStatus}
          </p>
        </div>

        {lastSyncedAt && (
          <p style={{ fontSize: '0.72rem', color: '#6b6b5e', margin: 0 }}>
            Last synced: {new Date(lastSyncedAt).toLocaleString()}
          </p>
        )}

        {syncStatus === 'error' && (
          <p style={{ fontSize: '0.72rem', color: '#dc2626', margin: '8px 0 0' }}>
            Sync failed. Check your internet connection and try again.
          </p>
        )}
      </section>

      {/* ── Account ──────────────────────── */}
      <section>
        <p style={{ ...sectionLabel, marginBottom: '16px' }}>Account</p>
        <button onClick={handleSignOut} style={{ ...outlineBtn, color: '#dc2626', borderColor: '#dc2626' }}>
          Sign out
        </button>
      </section>

      {/* Modals */}
      {(editingJob || addingJob) && (
        <JobEditModal
          job={editingJob}
          onClose={() => {
            setEditingJob(null);
            setAddingJob(false);
          }}
        />
      )}
    </div>
  );
}

const sectionLabel: React.CSSProperties = {
  fontSize: '0.68rem',
  letterSpacing: '0.1em',
  color: '#6b6b5e',
  textTransform: 'uppercase',
  margin: 0,
};
const fieldLabel: React.CSSProperties = {
  fontSize: '0.68rem',
  letterSpacing: '0.08em',
  color: '#6b6b5e',
  textTransform: 'uppercase',
  margin: '0 0 6px',
};
const input: React.CSSProperties = {
  padding: '9px 12px',
  border: '1px solid #d1c9b8',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.82rem',
  background: 'white',
  color: '#0e0e0e',
  outline: 'none',
};
const outlineBtn: React.CSSProperties = {
  padding: '8px 16px',
  border: '1px solid #0e0e0e',
  background: 'none',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.78rem',
  cursor: 'pointer',
  color: '#0e0e0e',
};
const ghostBtn: React.CSSProperties = {
  padding: '4px 10px',
  border: '1px solid #d1c9b8',
  background: 'none',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.7rem',
  cursor: 'pointer',
  color: '#6b6b5e',
};
