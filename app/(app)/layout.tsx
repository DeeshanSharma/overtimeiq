'use client';

import TabBar from '@/components/app/shared/TabBar';
import TopBar from '@/components/app/shared/TopBar';
import { GOOGLE_REFRESH_LS_KEY, peekGoogleRefreshTokenFromLocalDb } from '@/lib/localWorkData';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { useAuthStore } from '@/stores/useAuthStore';
import { useDBStore } from '@/stores/useDBStore';
import { useProStore } from '@/stores/useProStore';
import { useSessionStore } from '@/stores/useSessionStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useSyncStore } from '@/stores/useSyncStore';
import { useUIStore } from '@/stores/useUIStore';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const bootstrapped = useRef(false);

  const { initDB, isReady, runSilent, getOne } = useDBStore();
  const { syncOnLogin, prefetchDriveIntoLocalStorage, syncIssue, clearSyncIssue } = useSyncStore();
  const { initPro } = useProStore();
  const { loadAll, saveProToken, saveGoogleRefreshToken } = useSettingsStore();
  const { loadSession } = useSessionStore();
  const { addToast, setStorageDurabilityWarning } = useUIStore();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);

  // Mark onboarding complete in both localStorage and SQLite
  const markOnboardingComplete = () => {
    try {
      localStorage.setItem('otiq_onboarding_done', '1');
    } catch {
      // ignore
    }
    // Save to SQLite so it syncs across devices via Drive
    runSilent('UPDATE settings SET onboarding_done = 1 WHERE id = 1');
  };

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Check onboarding state from SQLite after DB init
  useEffect(() => {
    if (!isReady) return;
    try {
      // Check localStorage first (fast)
      const lsDone = localStorage.getItem('otiq_onboarding_done');
      if (lsDone) return;
      // Check SQLite (syncs across devices)
      const row = getOne('SELECT onboarding_done FROM settings WHERE id = 1');
      if (row && (row as { onboarding_done: number }).onboarding_done === 1) {
        // Sync to localStorage so we don't check SQLite again
        localStorage.setItem('otiq_onboarding_done', '1');
      } else {
        setShowOnboarding(true);
      }
    } catch {
      setShowOnboarding(true);
    }
  }, [isReady, getOne]);

  async function bootstrap() {
    const supabase = getSupabaseBrowserClient();

    // 1. Verify Supabase session
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      router.replace('/login');
      return;
    }

    // Store user profile in auth store
    useAuthStore.getState().setUser({
      id: user.id,
      email: user.email ?? '',
      name: user.user_metadata?.name ?? user.user_metadata?.full_name ?? user.email?.split('@')[0] ?? 'User',
      avatar_url: user.user_metadata?.avatar_url ?? user.user_metadata?.picture ?? null,
    });

    // 2. Check user access status
    const { data: userData } = await supabase.from('users').select('status').eq('id', user.id).single();

    if (!userData || userData.status === 'waitlist') {
      router.replace('/waitlist');
      return;
    }

    const grtCookie = document.cookie.split(';').find((c) => c.trim().startsWith('g_rt_once='));
    const rtFromCookie = grtCookie ? decodeURIComponent(grtCookie.split('=').slice(1).join('=').trim()) || null : null;

    let googleRefreshToken: string | null = rtFromCookie;

    if (!googleRefreshToken) {
      try {
        googleRefreshToken = localStorage.getItem(GOOGLE_REFRESH_LS_KEY);
      } catch {
        googleRefreshToken = null;
      }
    }

    if (!googleRefreshToken) {
      googleRefreshToken = await peekGoogleRefreshTokenFromLocalDb();
    }

    await initDB();

    if (useDBStore.getState().error) {
      addToast({
        type: 'error',
        message: 'Failed to initialise database. Please refresh.',
      });
      return;
    }

    loadAll();

    // Save cookie token to SQLite only if we don't already have a valid token in DB
    // (avoids overwriting a cleared invalid token with the same invalid token from cookie)
    if (rtFromCookie) {
      const existingToken = useDBStore.getState().getOne('SELECT google_refresh_token FROM settings WHERE id = 1')
        ?.google_refresh_token as string | undefined;
      if (!existingToken) {
        saveGoogleRefreshToken(rtFromCookie);
      }
      document.cookie = 'g_rt_once=; path=/; max-age=0';
    }

    // Probe Drive + optional download into localStorage (now that DB is ready for cleanup on invalid_grant)
    if (googleRefreshToken) {
      await prefetchDriveIntoLocalStorage(googleRefreshToken);
    }

    // Re-read from DB — prefetch may have cleared the token due to invalid_grant
    const row = useDBStore.getState().getOne('SELECT google_refresh_token FROM settings WHERE id = 1');
    googleRefreshToken = (row?.google_refresh_token as string) ?? null;

    // Drive sync — reconcile timestamps / upload if needed
    if (googleRefreshToken) {
      // Fire and forget — don't block the rest of bootstrap on sync
      syncOnLogin(googleRefreshToken).catch((err) => console.error('[AppLayout] syncOnLogin error:', err));
    } else {
      console.warn('[AppLayout] No google_refresh_token — Drive sync skipped');
      // Set sync state to indicate reconnection needed
      useSyncStore.getState().clearSyncIssue();
      useSyncStore.setState({ syncStatus: 'offline', syncIssue: 'refresh_token_missing' });
    }

    // Wire the debounce trigger: every execSQL write → syncNow after 10s
    //    Must be set AFTER bootstrap so the debounce doesn't fire during init
    useDBStore.getState().setDriveDebounceTrigger(() => {
      useSyncStore.getState().syncNow();
    });

    // Pro token — verify cached + fetch fresh if needed
    const cachedToken = useSettingsStore.getState().settings?.pro_token ?? null;
    await initPro(user.id, cachedToken);

    // Persist any fresh token back to SQLite
    const freshToken = useProStore.getState().token;
    if (freshToken && freshToken !== cachedToken) {
      saveProToken(freshToken);
    }

    // Storage durability check
    if (navigator.storage?.persisted) {
      let persisted = await navigator.storage.persisted();
      if (!persisted && navigator.storage?.persist) {
        persisted = await navigator.storage.persist();
      }
      setStorageDurabilityWarning(!persisted);
    }

    // Recover any interrupted punch-in session
    loadSession();
  }

  if (!isReady) return <AppSkeleton />;

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#f5f0e8',
        fontFamily: 'var(--font-mono)',
        display: 'flex',
        flexDirection: 'column',
      }}>
      <StorageDurabilityBanner />
      <SyncIssueBanner syncIssue={syncIssue} onDismiss={clearSyncIssue} />
      <TopBar />
      <main style={{ flex: 1, overflow: 'auto' }}>{children}</main>
      <TabBar />
      <OnboardingWalkthrough
        pathname={pathname}
        open={showOnboarding}
        step={onboardingStep}
        onNext={() => {
          const currentStep = onboardingStep;
          const currentRoute = ONBOARDING_STEPS[currentStep].route;
          // First ensure we're on the correct route for current step
          if (pathname !== currentRoute) {
            router.push(currentRoute);
            return;
          }
          // Now on correct route - advance to next step
          if (currentStep >= ONBOARDING_STEPS.length - 1) {
            markOnboardingComplete();
            setShowOnboarding(false);
            return;
          }
          const nextStep = currentStep + 1;
          setOnboardingStep(nextStep);
          // Navigate if next step is on different route
          const nextRoute = ONBOARDING_STEPS[nextStep].route;
          if (pathname !== nextRoute) {
            router.push(nextRoute);
          }
        }}
        onPrev={() => {
          const currentStep = onboardingStep;
          if (currentStep === 0) return;
          const currentRoute = ONBOARDING_STEPS[currentStep].route;
          // First ensure we're on the correct route for current step
          if (pathname !== currentRoute) {
            router.push(currentRoute);
            return;
          }
          // Now on correct route - go to prev step
          const prevStep = currentStep - 1;
          const prevRoute = ONBOARDING_STEPS[prevStep].route;
          setOnboardingStep(prevStep);
          // Navigate if prev step is on different route
          if (pathname !== prevRoute) {
            router.push(prevRoute);
          }
        }}
        onSkip={() => {
          markOnboardingComplete();
          setShowOnboarding(false);
        }}
        onSkipStep={() => {
          const currentStep = onboardingStep;
          const currentRoute = ONBOARDING_STEPS[currentStep].route;
          // First ensure we're on the correct route for current step
          if (pathname !== currentRoute) {
            router.push(currentRoute);
            return;
          }
          // Now on correct route - skip to next step
          if (currentStep >= ONBOARDING_STEPS.length - 1) {
            markOnboardingComplete();
            setShowOnboarding(false);
            return;
          }
          const nextStep = currentStep + 1;
          setOnboardingStep(nextStep);
          // Navigate if next step is on different route
          const nextRoute = ONBOARDING_STEPS[nextStep].route;
          if (pathname !== nextRoute) {
            router.push(nextRoute);
          }
        }}
      />
    </div>
  );
}

function AppSkeleton() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#f5f0e8',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-mono)',
      }}>
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            width: '32px',
            height: '32px',
            border: '2px solid #d1c9b8',
            borderTopColor: '#0e0e0e',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
            margin: '0 auto 16px',
          }}
        />
        <p style={{ fontSize: '0.78rem', color: '#6b6b5e' }}>Loading database…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}

function StorageDurabilityBanner() {
  const { storageDurabilityWarning } = useUIStore();
  if (!storageDurabilityWarning) return null;
  return (
    <div
      style={{
        padding: '10px 20px',
        background: '#fef3c7',
        borderBottom: '1px solid #d97706',
        fontSize: '0.75rem',
        color: '#92400e',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}>
      <span>⚠</span>
      <span>Your local data may be cleared by the browser. Drive sync is your backup — keep it active.</span>
    </div>
  );
}

function SyncIssueBanner({
  syncIssue,
  onDismiss,
}: {
  syncIssue: 'drive_permission' | 'drive_quota' | 'wrong_account' | 'refresh_token_missing' | null;
  onDismiss: () => void;
}) {
  if (!syncIssue) return null;

  const messages: Record<typeof syncIssue, string> = {
    drive_permission: 'Google Drive permission missing. Reconnect to restore backup sync.',
    drive_quota: 'Google Drive is full. Free up space, then run Sync now.',
    wrong_account: 'Wrong Google account selected. Your data belongs to a different account.',
    refresh_token_missing: 'Google Drive connection lost. Please reconnect to backup your data.',
  };

  const router = useRouter();

  return (
    <div
      style={{
        padding: '10px 20px',
        background: syncIssue === 'wrong_account' ? '#fef2f2' : '#fff7ed',
        borderBottom: `1px solid ${syncIssue === 'wrong_account' ? '#dc2626' : '#d97706'}`,
        fontSize: '0.75rem',
        color: syncIssue === 'wrong_account' ? '#dc2626' : '#92400e',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        flexWrap: 'wrap',
      }}>
      <span>{messages[syncIssue]}</span>
      <div style={{ display: 'flex', gap: '8px' }}>
        {(syncIssue === 'drive_permission' ||
          syncIssue === 'wrong_account' ||
          syncIssue === 'refresh_token_missing') && (
          <button
            onClick={() => router.push('/settings')}
            style={{
              border: `1px solid ${syncIssue === 'wrong_account' ? '#dc2626' : '#d97706'}`,
              background: 'none',
              color: syncIssue === 'wrong_account' ? '#dc2626' : '#92400e',
              fontSize: '0.68rem',
              fontFamily: 'var(--font-mono)',
              padding: '2px 8px',
              cursor: 'pointer',
            }}>
            Fix in Settings
          </button>
        )}
        <button
          onClick={onDismiss}
          style={{
            border: '1px solid #d97706',
            background: 'none',
            color: '#92400e',
            fontSize: '0.68rem',
            fontFamily: 'var(--font-mono)',
            padding: '2px 8px',
            cursor: 'pointer',
          }}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

const ONBOARDING_STEPS: {
  title: string;
  body: string;
  route: '/log' | '/dashboard' | '/settings';
  targetSelector: string;
  targetLabel: string;
  autoTrigger?: boolean;
}[] = [
  {
    title: 'Track your overtime',
    body: 'Click the Punch in button to start a live timer for your shift.',
    route: '/log',
    targetSelector: '[data-onboarding="punch-in"]',
    targetLabel: 'Punch in',
  },
  {
    title: 'Add past entries',
    body: 'Use Manual entry to log shifts after they happened. Great for catching up.',
    route: '/log',
    targetSelector: '[data-onboarding="manual-entry"]',
    targetLabel: 'Manual entry',
    autoTrigger: true,
  },
  {
    title: 'Import from Excel',
    body: 'Already tracking in a spreadsheet? Import it directly with the Import button.',
    route: '/log',
    targetSelector: '[data-onboarding="import"]',
    targetLabel: 'Import',
  },
  {
    title: 'Review your trends',
    body: 'Switch between timeframes to see your hours and earnings over different periods.',
    route: '/dashboard',
    targetSelector: '[data-onboarding="timeframe-tabs"]',
    targetLabel: 'Timeframe tabs',
  },
  {
    title: 'Add your jobs',
    body: 'Set up jobs with hourly rates. You can add multiple jobs and switch between them.',
    route: '/settings',
    targetSelector: '[data-onboarding="add-job"]',
    targetLabel: 'Add job',
    autoTrigger: true,
  },
  {
    title: 'Keep your data safe',
    body: 'Click Sync now to back up your work data to Google Drive.',
    route: '/settings',
    targetSelector: '[data-onboarding="sync-now"]',
    targetLabel: 'Sync now',
  },
];

function OnboardingWalkthrough({
  pathname,
  open,
  step,
  onNext,
  onPrev,
  onSkip,
  onSkipStep,
}: {
  pathname: string;
  open: boolean;
  step: number;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
  onSkipStep: () => void;
}) {
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const current = ONBOARDING_STEPS[step] ?? ONBOARDING_STEPS[0];
  const onTargetRoute = pathname === current.route;
  const isLast = step === ONBOARDING_STEPS.length - 1;

  useEffect(() => {
    if (!open || !onTargetRoute) {
      setTargetRect(null);
      return;
    }

    const updateTarget = () => {
      const el = document.querySelector(current.targetSelector);
      if (el) {
        setTargetRect(el.getBoundingClientRect());
      }
    };

    updateTarget();
    window.addEventListener('resize', updateTarget);
    window.addEventListener('scroll', updateTarget, true);

    const interval = setInterval(updateTarget, 100);

    // Auto-trigger: click the target element to open modal and advance
    if (current.autoTrigger && onTargetRoute) {
      const el = document.querySelector(current.targetSelector);
      if (el) {
        const handleClick = () => {
          setTimeout(() => onNext(), 300);
        };
        el.addEventListener('click', handleClick);
        return () => {
          window.removeEventListener('resize', updateTarget);
          window.removeEventListener('scroll', updateTarget, true);
          clearInterval(interval);
          el.removeEventListener('click', handleClick);
        };
      }
    }

    return () => {
      window.removeEventListener('resize', updateTarget);
      window.removeEventListener('scroll', updateTarget, true);
      clearInterval(interval);
    };
  }, [open, onTargetRoute, current.targetSelector, current.autoTrigger, step, onNext]);

  if (!open) return null;

  return (
    <>
      {/* Dark overlay with cutout */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 50,
          pointerEvents: targetRect ? 'none' : 'auto',
        }}>
        {/* Top */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: targetRect ? targetRect.top : 0,
            background: 'rgba(14,14,14,0.75)',
            pointerEvents: 'auto',
          }}
        />
        {/* Bottom */}
        {targetRect && (
          <div
            style={{
              position: 'absolute',
              top: targetRect.bottom,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(14,14,14,0.75)',
              pointerEvents: 'auto',
            }}
          />
        )}
        {/* Left */}
        {targetRect && (
          <div
            style={{
              position: 'absolute',
              top: targetRect.top,
              left: 0,
              width: targetRect.left,
              height: targetRect.height,
              background: 'rgba(14,14,14,0.75)',
              pointerEvents: 'auto',
            }}
          />
        )}
        {/* Right */}
        {targetRect && (
          <div
            style={{
              position: 'absolute',
              top: targetRect.top,
              left: targetRect.right,
              right: 0,
              height: targetRect.height,
              background: 'rgba(14,14,14,0.75)',
              pointerEvents: 'auto',
            }}
          />
        )}
      </div>

      {/* Highlight border around target */}
      {targetRect && (
        <div
          style={{
            position: 'fixed',
            top: targetRect.top - 4,
            left: targetRect.left - 4,
            width: targetRect.width + 8,
            height: targetRect.height + 8,
            border: '2px solid #d97706',
            borderRadius: '4px',
            zIndex: 51,
            pointerEvents: 'none',
            boxShadow: '0 0 0 4px rgba(217, 119, 6, 0.2), 0 0 20px rgba(217, 119, 6, 0.3)',
          }}
        />
      )}

      {/* Tooltip card */}
      <div
        style={{
          position: 'fixed',
          zIndex: 52,
          ...(targetRect
            ? {
                top: targetRect.bottom + 16,
                left: Math.min(
                  targetRect.left,
                  typeof window !== 'undefined' ? window.innerWidth - 360 : targetRect.left,
                ),
              }
            : {
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
              }),
          minWidth: '340px',
          maxWidth: 'calc(100vw - 40px)',
          background: '#f5f0e8',
          border: '1px solid #d1c9b8',
          fontFamily: 'var(--font-mono)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        }}>
        {/* Header with close button */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 20px',
            borderBottom: '1px solid #d1c9b8',
            background: '#f0ebe3',
          }}>
          <span
            style={{
              fontSize: '0.65rem',
              letterSpacing: '0.1em',
              color: '#6b6b5e',
              textTransform: 'uppercase',
            }}>
            Quick walkthrough · Step {step + 1} of {ONBOARDING_STEPS.length}
          </span>
          <button
            onClick={onSkip}
            title="Close walkthrough"
            style={{
              border: 'none',
              background: 'none',
              color: '#6b6b5e',
              fontSize: '1.1rem',
              lineHeight: 1,
              cursor: 'pointer',
              padding: '2px 6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            ×
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '20px' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              marginBottom: '12px',
              padding: '2px 8px',
              background: '#d97706',
              color: 'white',
              fontSize: '0.65rem',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}>
            <span>★</span>
            <span>{current.targetLabel}</span>
          </div>
          <p
            style={{
              margin: '0 0 8px',
              fontFamily: 'var(--font-serif)',
              fontSize: '1.35rem',
              color: '#0e0e0e',
              lineHeight: 1.2,
            }}>
            {current.title}
          </p>
          <p
            style={{
              margin: '0 0 16px',
              fontSize: '0.8rem',
              color: '#6b6b5e',
              lineHeight: 1.5,
            }}>
            {current.body}
          </p>
          {!onTargetRoute && (
            <p
              style={{
                margin: '0 0 12px',
                fontSize: '0.72rem',
                color: '#d97706',
              }}>
              Moving you to {current.route} for this step.
            </p>
          )}

          {/* Navigation buttons */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '8px',
            }}>
            <button
              onClick={onPrev}
              disabled={step === 0}
              style={{
                border: '1px solid #d1c9b8',
                background: 'none',
                color: step === 0 ? '#b8b0a0' : '#6b6b5e',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.75rem',
                padding: '8px 12px',
                cursor: step === 0 ? 'not-allowed' : 'pointer',
                opacity: step === 0 ? 0.6 : 1,
              }}>
              ← Prev
            </button>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={onSkipStep}
                style={{
                  border: 'none',
                  background: 'none',
                  color: '#6b6b5e',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.7rem',
                  padding: '8px 10px',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}>
                Skip this
              </button>
              <button
                onClick={onNext}
                style={{
                  border: 'none',
                  background: '#0e0e0e',
                  color: '#f5f0e8',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.75rem',
                  padding: '8px 14px',
                  cursor: 'pointer',
                }}>
                {isLast ? 'Finish' : 'Next →'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
