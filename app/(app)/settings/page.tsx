'use client';

import JobEditModal from '@/components/app/settings/JobEditModal';
import { clearPersistedWorkData, DB_STORAGE_KEY } from '@/lib/localWorkData';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/stores/useAuthStore';
import { useDBStore } from '@/stores/useDBStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useSyncStore } from '@/stores/useSyncStore';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

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
  const { syncStatus, lastSyncedAt, syncNow, uploadToDrive, syncIssue, clearSyncIssue } = useSyncStore();
  const { execSQL, resetAfterLogout, runSilent } = useDBStore();
  const { user } = useAuthStore();
  const router = useRouter();

  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [addingJob, setAddingJob] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectError, setReconnectError] = useState<string | null>(null);
  const [currency, setCurrency] = useState(settings?.currency_symbol ?? '₹');
  const [burnout, setBurnout] = useState(String(settings?.burnout_threshold_hours ?? '15'));

  // Fetch user profile on mount if not loaded
  useEffect(() => {
    if (!user) {
      loadUserProfile();
    }
  }, []);

  // Handle reconnect result from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get('error');
    const reconnect = params.get('reconnect');
    const expected = params.get('expected');
    const got = params.get('got');

    if (error === 'wrong_account') {
      setReconnectError(
        `Wrong account selected. You picked ${got}, but your data belongs to ${expected}. Please try again with the correct account.`,
      );
      // Clear URL params
      window.history.replaceState({}, '', window.location.pathname);
    } else if (reconnect === 'success') {
      // Clear URL params and show success
      window.history.replaceState({}, '', window.location.pathname);
      // Trigger sync
      syncNow();
    }
  }, [syncNow]);

  async function loadUserProfile() {
    const supabase = getSupabaseBrowserClient();
    const {
      data: { user: u },
    } = await supabase.auth.getUser();
    if (u) {
      useAuthStore.getState().setUser({
        id: u.id,
        email: u.email ?? '',
        name: u.user_metadata?.name ?? u.user_metadata?.full_name ?? u.email?.split('@')[0] ?? 'User',
        avatar_url: u.user_metadata?.avatar_url ?? u.user_metadata?.picture ?? null,
      });
    }
  }

  async function handleManualSync() {
    setSyncing(true);
    try {
      await uploadToDrive();
    } catch {}
    setSyncing(false);
  }

  // Download SQLite file from localStorage as emergency backup
  function handleDownloadDB() {
    try {
      const stored = localStorage.getItem(DB_STORAGE_KEY);
      if (!stored) {
        alert('No local database found. Your data may be lost.');
        return;
      }
      const blob = new Blob([new Uint8Array(JSON.parse(stored))], { type: 'application/x-sqlite3' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `overtimeiq_backup_${new Date().toISOString().split('T')[0]}.db`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download DB:', err);
      alert('Failed to download database. Check console for details.');
    }
  }

  // Reconnect Google Drive without logout - opens PKCE popup
  async function handleReconnectDrive() {
    setReconnecting(true);
    setReconnectError(null);
    try {
      const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
      if (!GOOGLE_CLIENT_ID) throw new Error('Google Client ID not configured');

      // PKCE verifier/challenge
      const verifier = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const encoder = new TextEncoder();
      const data = encoder.encode(verifier);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const challenge = btoa(hashArray.map((b) => String.fromCharCode(b)).join(''))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      sessionStorage.setItem('pkce_verifier', verifier);

      console.log({ email: user?.email });

      const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: `${window.location.origin}/auth/callback`,
        response_type: 'code',
        scope: 'openid email profile https://www.googleapis.com/auth/drive.file',
        state: JSON.stringify({ reconnect: true }),
        code_challenge: challenge,
        code_challenge_method: 'S256',
        access_type: 'offline', // Required to get refresh token
        prompt: 'consent select_account', // Force consent + account picker to ensure refresh token
        login_hint: user?.email || '',
      });

      window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to reconnect';
      setReconnectError(msg);
      setReconnecting(false);
    }
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
      {/* ── User Profile ───────────────── */}
      {user && (
        <section style={{ marginBottom: '36px', display: 'flex', alignItems: 'center', gap: '16px' }}>
          {user.avatar_url ? (
            <img
              src={user.avatar_url}
              alt={user.name}
              crossOrigin="anonymous"
              style={{ width: '56px', height: '56px', borderRadius: '50%', objectFit: 'cover' }}
            />
          ) : (
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                background: '#d1c9b8',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.5rem',
                color: '#6b6b5e',
              }}>
              {user.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <p style={{ margin: '0 0 4px', fontSize: '1rem', fontWeight: 500, color: '#0e0e0e' }}>{user.name}</p>
            <p style={{ margin: 0, fontSize: '0.75rem', color: '#6b6b5e' }}>{user.email}</p>
          </div>
        </section>
      )}

      {/* ── Jobs ─────────────────────────── */}
      <section style={{ marginBottom: '36px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <p style={sectionLabel}>Jobs</p>
          <button data-onboarding="add-job" onClick={() => setAddingJob(true)} style={outlineBtn}>
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

        {(syncStatus === 'error' || syncStatus === 'offline' || syncIssue) && (
          <div style={{ marginTop: '12px', padding: '12px', background: '#fef2f2', border: '1px solid #dc2626' }}>
            <p style={{ fontSize: '0.72rem', color: '#dc2626', margin: '0 0 8px' }}>
              {syncIssue === 'refresh_token_missing' &&
                'Google Drive connection lost. Please reconnect to backup your data.'}
              {syncIssue === 'drive_permission' && 'Google Drive permission missing. Reconnect to restore backup sync.'}
              {syncIssue === 'drive_quota' && 'Google Drive is full. Free up space, then try again.'}
              {syncIssue === 'wrong_account' &&
                'Wrong Google account selected. Your data belongs to a different account.'}
              {!syncIssue && syncStatus === 'error' && 'Sync failed. Check your internet connection and try again.'}
              {!syncIssue &&
                syncStatus === 'offline' &&
                'Google Drive not connected. Please reconnect to backup your data.'}
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={handleReconnectDrive}
                disabled={reconnecting}
                style={{ ...outlineBtn, fontSize: '0.7rem', padding: '6px 12px' }}>
                {reconnecting ? 'Connecting…' : 'Reconnect Google Drive'}
              </button>
              <button
                onClick={handleDownloadDB}
                style={{
                  ...outlineBtn,
                  fontSize: '0.7rem',
                  padding: '6px 12px',
                  borderColor: '#6b6b5e',
                  color: '#6b6b5e',
                }}>
                Download backup
              </button>
            </div>
            {reconnectError && (
              <p style={{ fontSize: '0.7rem', color: '#dc2626', margin: '8px 0 0' }}>{reconnectError}</p>
            )}
          </div>
        )}

        {syncStatus === 'idle' && !syncIssue && (
          <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
            <button
              onClick={handleReconnectDrive}
              disabled={reconnecting}
              style={{
                ...outlineBtn,
                fontSize: '0.7rem',
                padding: '6px 12px',
                borderColor: '#6b6b5e',
                color: '#6b6b5e',
              }}>
              {reconnecting ? 'Connecting…' : 'Reconnect Google Drive'}
            </button>
          </div>
        )}

        {/* Always show Download backup option */}
        <div style={{ marginTop: syncStatus === 'idle' && !syncIssue ? '8px' : '12px' }}>
          <button
            onClick={handleDownloadDB}
            style={{
              ...outlineBtn,
              fontSize: '0.7rem',
              padding: '6px 12px',
              borderColor: '#6b6b5e',
              color: '#6b6b5e',
            }}>
            Download backup
          </button>
        </div>
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
