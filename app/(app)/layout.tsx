"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { GOOGLE_REFRESH_LS_KEY, peekGoogleRefreshTokenFromLocalDb } from "@/lib/localWorkData";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useDBStore } from "@/stores/useDBStore";
import { useSyncStore } from "@/stores/useSyncStore";
import { useProStore } from "@/stores/useProStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useSessionStore } from "@/stores/useSessionStore";
import { useUIStore } from "@/stores/useUIStore";
import TopBar from "@/components/app/shared/TopBar";
import TabBar from "@/components/app/shared/TabBar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const bootstrapped = useRef(false);

  const { initDB, isReady } = useDBStore();
  const { syncOnLogin, prefetchDriveIntoLocalStorage, syncIssue, clearSyncIssue } = useSyncStore();
  const { initPro } = useProStore();
  const { loadAll, saveProToken, saveGoogleRefreshToken } = useSettingsStore();
  const { loadSession } = useSessionStore();
  const { addToast, setStorageDurabilityWarning } = useUIStore();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    bootstrap();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      const done = localStorage.getItem("otiq_onboarding_done");
      if (!done) setShowOnboarding(true);
    } catch {
      // ignore
    }
  }, []);

  async function bootstrap() {
    const supabase = getSupabaseBrowserClient();

    // 1. Verify Supabase session
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      router.replace("/login");
      return;
    }

    // 2. Check user access status
    const { data: userData } = await supabase
      .from("users")
      .select("status")
      .eq("id", user.id)
      .single();

    if (!userData || userData.status === "waitlist") {
      router.replace("/waitlist");
      return;
    }

    const grtCookie = document.cookie
      .split(";")
      .find(c => c.trim().startsWith("g_rt_once="));
    const rtFromCookie = grtCookie
      ? decodeURIComponent(grtCookie.split("=").slice(1).join("=").trim()) || null
      : null;

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

    // Probe Drive + optional download into localStorage before sql.js opens (stops empty local overwriting Drive)
    if (googleRefreshToken) {
      await prefetchDriveIntoLocalStorage(googleRefreshToken);
    }

    await initDB();

    if (useDBStore.getState().error) {
      addToast({ type: "error", message: "Failed to initialise database. Please refresh." });
      return;
    }

    loadAll();

    if (rtFromCookie) {
      saveGoogleRefreshToken(rtFromCookie);
      document.cookie = "g_rt_once=; path=/; max-age=0";
    }

    if (!googleRefreshToken) {
      const row = useDBStore.getState().getOne(
        "SELECT google_refresh_token FROM settings WHERE id = 1"
      );
      googleRefreshToken = (row?.google_refresh_token as string) ?? null;
    }

    // Drive sync — reconcile timestamps / upload if needed
    if (googleRefreshToken) {
      // Fire and forget — don't block the rest of bootstrap on sync
      syncOnLogin(googleRefreshToken).catch(err =>
        console.error("[AppLayout] syncOnLogin error:", err)
      );
    } else {
      console.warn("[AppLayout] No google_refresh_token — Drive sync skipped");
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
    <div style={{
      minHeight: "100vh",
      background: "#f5f0e8",
      fontFamily: "var(--font-mono)",
      display: "flex",
      flexDirection: "column",
    }}>
      <StorageDurabilityBanner />
      <SyncIssueBanner syncIssue={syncIssue} onDismiss={clearSyncIssue} />
      <TopBar />
      <main style={{ flex: 1, overflow: "auto" }}>
        {children}
      </main>
      <TabBar />
      <OnboardingWalkthrough
        pathname={pathname}
        open={showOnboarding}
        step={onboardingStep}
        onNext={() => {
          const currentRoute = ONBOARDING_STEPS[onboardingStep].route;
          if (pathname !== currentRoute) {
            router.push(currentRoute);
            return;
          }
          if (onboardingStep >= ONBOARDING_STEPS.length - 1) {
            try {
              localStorage.setItem("otiq_onboarding_done", "1");
            } catch {
              // ignore
            }
            setShowOnboarding(false);
            return;
          }
          const nextStep = onboardingStep + 1;
          setOnboardingStep(nextStep);
          router.push(ONBOARDING_STEPS[nextStep].route);
        }}
        onSkip={() => {
          try {
            localStorage.setItem("otiq_onboarding_done", "1");
          } catch {
            // ignore
          }
          setShowOnboarding(false);
        }}
      />
    </div>
  );
}

function AppSkeleton() {
  return (
    <div style={{
      minHeight: "100vh",
      background: "#f5f0e8",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "var(--font-mono)",
    }}>
      <div style={{ textAlign: "center" }}>
        <div style={{
          width: "32px", height: "32px",
          border: "2px solid #d1c9b8", borderTopColor: "#0e0e0e",
          borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
          margin: "0 auto 16px",
        }} />
        <p style={{ fontSize: "0.78rem", color: "#6b6b5e" }}>Loading database…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}

function StorageDurabilityBanner() {
  const { storageDurabilityWarning } = useUIStore();
  if (!storageDurabilityWarning) return null;
  return (
    <div style={{
      padding: "10px 20px",
      background: "#fef3c7",
      borderBottom: "1px solid #d97706",
      fontSize: "0.75rem",
      color: "#92400e",
      display: "flex",
      alignItems: "center",
      gap: "8px",
    }}>
      <span>⚠</span>
      <span>
        Your local data may be cleared by the browser. Drive sync is your backup — keep it active.
      </span>
    </div>
  );
}

function SyncIssueBanner({
  syncIssue,
  onDismiss,
}: {
  syncIssue: "drive_permission" | "drive_quota" | null;
  onDismiss: () => void;
}) {
  if (!syncIssue) return null;

  const message =
    syncIssue === "drive_permission"
      ? "Google Drive permission missing. Re-login and allow Drive access to keep backup sync working."
      : "Google Drive is full. Free up space, then run Sync now in top bar.";

  async function handleReconnectGoogle() {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <div style={{
      padding: "10px 20px",
      background: "#fff7ed",
      borderBottom: "1px solid #d97706",
      fontSize: "0.75rem",
      color: "#92400e",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "12px",
      flexWrap: "wrap",
    }}>
      <span>{message}</span>
      <div style={{ display: "flex", gap: "8px" }}>
        {syncIssue === "drive_permission" && (
          <button
            onClick={handleReconnectGoogle}
            style={{
              border: "1px solid #d97706",
              background: "none",
              color: "#92400e",
              fontSize: "0.68rem",
              fontFamily: "var(--font-mono)",
              padding: "2px 8px",
              cursor: "pointer",
            }}
          >
            Reconnect
          </button>
        )}
        <button
          onClick={onDismiss}
          style={{
            border: "1px solid #d97706",
            background: "none",
            color: "#92400e",
            fontSize: "0.68rem",
            fontFamily: "var(--font-mono)",
            padding: "2px 8px",
            cursor: "pointer",
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

const ONBOARDING_STEPS: { title: string; body: string; route: "/log" | "/dashboard" | "/settings" }[] = [
  {
    title: "Track from Log tab",
    body: "Start with Punch in for live timer, or use Manual entry for past shifts.",
    route: "/log",
  },
  {
    title: "Read trends in Dashboard",
    body: "Switch timeframe, review hours and earnings, and compare status and location.",
    route: "/dashboard",
  },
  {
    title: "Set up in Settings",
    body: "Add jobs, tune rates and currency, then use Sync now to back up to Drive.",
    route: "/settings",
  },
];

function OnboardingWalkthrough({
  pathname,
  open,
  step,
  onNext,
  onSkip,
}: {
  pathname: string;
  open: boolean;
  step: number;
  onNext: () => void;
  onSkip: () => void;
}) {
  if (!open) return null;
  const current = ONBOARDING_STEPS[step] ?? ONBOARDING_STEPS[0];
  const onTargetRoute = pathname === current.route;
  const isLast = step === ONBOARDING_STEPS.length - 1;

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      background: "rgba(14,14,14,0.45)",
      zIndex: 50,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "20px",
    }}>
      <div style={{
        width: "100%",
        maxWidth: "460px",
        background: "#f5f0e8",
        border: "1px solid #d1c9b8",
        padding: "20px",
        fontFamily: "var(--font-mono)",
      }}>
        <p style={{ margin: "0 0 8px", fontSize: "0.68rem", letterSpacing: "0.1em", color: "#6b6b5e", textTransform: "uppercase" }}>
          Quick walkthrough · {step + 1}/{ONBOARDING_STEPS.length}
        </p>
        <p style={{ margin: "0 0 8px", fontFamily: "var(--font-serif)", fontSize: "1.45rem", color: "#0e0e0e", lineHeight: 1.2 }}>
          {current.title}
        </p>
        <p style={{ margin: "0 0 16px", fontSize: "0.8rem", color: "#6b6b5e", lineHeight: 1.6 }}>
          {current.body}
        </p>
        {!onTargetRoute && (
          <p style={{ margin: "0 0 12px", fontSize: "0.72rem", color: "#d97706" }}>
            Moving you to {current.route} for this step.
          </p>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
          <button
            onClick={onSkip}
            style={{ border: "1px solid #d1c9b8", background: "none", color: "#6b6b5e", fontFamily: "var(--font-mono)", fontSize: "0.75rem", padding: "8px 12px", cursor: "pointer" }}
          >
            Skip
          </button>
          <button
            onClick={onNext}
            style={{ border: "none", background: "#0e0e0e", color: "#f5f0e8", fontFamily: "var(--font-mono)", fontSize: "0.75rem", padding: "8px 12px", cursor: "pointer" }}
          >
            {isLast ? "Finish" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
