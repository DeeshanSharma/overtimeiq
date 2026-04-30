"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
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
  const bootstrapped = useRef(false);

  const { initDB, isReady } = useDBStore();
  const { syncOnLogin } = useSyncStore();
  const { initPro } = useProStore();
  const { loadAll, saveProToken, saveGoogleRefreshToken } = useSettingsStore();
  const { loadSession } = useSessionStore();
  const { addToast, setStorageDurabilityWarning } = useUIStore();

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    bootstrap();
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

    // 3. Initialise SQLite DB
    await initDB();

    // Re-read after async initDB
    if (useDBStore.getState().error) {
      addToast({ type: "error", message: "Failed to initialise database. Please refresh." });
      return;
    }

    // 4. Load settings + jobs + holidays into store
    loadAll();

    // 5. Handle Google refresh token
    //
    //    First login: the auth callback sets a one-time cookie g_rt_once.
    //    Read it, save to SQLite (using runSilent so it doesn't arm debounce),
    //    then pass directly to syncOnLogin.
    //
    //    Returning user: read the refresh token saved in SQLite from last login
    //    and call syncOnLogin the same way.
    //
    //    In both cases syncOnLogin gets a fresh access token server-side, then
    //    does the Drive compare-and-sync.

    let googleRefreshToken: string | null = null;

    // Check for first-login cookie
    const grtCookie = document.cookie
      .split(";")
      .find(c => c.trim().startsWith("g_rt_once="));

    if (grtCookie) {
      const rt = decodeURIComponent(grtCookie.split('=').slice(1).join('=').trim());
      if (rt) {
        googleRefreshToken = rt;
        // Save to SQLite silently — doesn't trigger debounce
        saveGoogleRefreshToken(rt);
        // Expire the one-time cookie immediately
        document.cookie = "g_rt_once=; path=/; max-age=0";
      }
    }

    // Fall back to whatever is already in SQLite for returning users
    if (!googleRefreshToken) {
      const row = useDBStore.getState().getOne(
        "SELECT google_refresh_token FROM settings WHERE id = 1"
      );
      googleRefreshToken = (row?.google_refresh_token as string) ?? null;
    }

    // 6. Drive sync — always runs if we have a refresh token
    if (googleRefreshToken) {
      // Fire and forget — don't block the rest of bootstrap on sync
      syncOnLogin(googleRefreshToken).catch(err =>
        console.error("[AppLayout] syncOnLogin error:", err)
      );
    } else {
      console.warn("[AppLayout] No google_refresh_token — Drive sync skipped");
    }

    // 7. Wire the debounce trigger: every execSQL write → syncNow after 10s
    //    Must be set AFTER bootstrap so the debounce doesn't fire during init
    useDBStore.getState().setDriveDebounceTrigger(() => {
      useSyncStore.getState().syncNow();
    });

    // 8. Pro token — verify cached + fetch fresh if needed
    const cachedToken = useSettingsStore.getState().settings?.pro_token ?? null;
    await initPro(user.id, cachedToken);

    // Persist any fresh token back to SQLite
    const freshToken = useProStore.getState().token;
    if (freshToken && freshToken !== cachedToken) {
      saveProToken(freshToken);
    }

    // 9. Storage durability check
    if (navigator.storage?.persisted) {
      const persisted = await navigator.storage.persisted();
      if (!persisted) setStorageDurabilityWarning(true);
    }

    // 10. Recover any interrupted punch-in session
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
      <TopBar />
      <main style={{ flex: 1, overflow: "auto" }}>
        {children}
      </main>
      <TabBar />
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
