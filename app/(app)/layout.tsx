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

  const { initDB, isReady, error: dbError } = useDBStore();
  const { syncOnLogin, setAccessToken } = useSyncStore();
  const { initPro } = useProStore();
  const { loadAll, settings, saveProToken, saveGoogleRefreshToken } = useSettingsStore();
  const { loadSession } = useSessionStore();
  const { addToast, setStorageDurabilityWarning } = useUIStore();

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    bootstrap();
  }, []);

  async function bootstrap() {
    const supabase = getSupabaseBrowserClient();

    // 1. Verify Supabase session
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      router.replace("/");
      return;
    }

    // 2. Check user status
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

    if (dbError) {
      addToast({ type: "error", message: "Failed to initialise database. Please refresh." });
      return;
    }

    // 4. Load settings into store
    loadAll();

    // 5. Read and consume the one-time Google refresh token cookie (set by auth/callback)
    //    Save it to SQLite settings — it lives there permanently, never on the server.
    const grtCookie = document.cookie.split(";").find(c => c.trim().startsWith("g_rt_once="));
    if (grtCookie) {
      const refreshToken = grtCookie.split("=").slice(1).join("=").trim();
      if (refreshToken) {
        saveGoogleRefreshToken(refreshToken);
        // Expire the cookie immediately
        document.cookie = "g_rt_once=; path=/; max-age=0";

        // Get a fresh access token and start Drive sync
        const { refreshToken: refreshFn } = useSyncStore.getState();
        const refreshed = await refreshFn();
        if (refreshed) {
          const { accessToken } = useSyncStore.getState();
          if (accessToken) {
            await syncOnLogin(refreshToken);
          }
        }
      }
    } else if (useSettingsStore.getState().settings?.google_refresh_token) {
      // Returning user — refresh the access token silently
      const { refreshToken: refreshFn } = useSyncStore.getState();
      await refreshFn();
    }

    // 6. Verify pro token (online + cache)
    const cachedToken = useSettingsStore.getState().settings?.pro_token ?? null;
    await initPro(user.id, cachedToken);

    // Persist any fresh token back to SQLite
    const freshToken = useProStore.getState().token;
    if (freshToken && freshToken !== cachedToken) {
      saveProToken(freshToken);
    }

    // 7. Check storage durability
    if (navigator.storage?.persisted) {
      const persisted = await navigator.storage.persisted();
      if (!persisted) setStorageDurabilityWarning(true);
    }

    // 8. Recover any active punch-in session
    loadSession();

    // 9. Wire DB save → Drive debounce trigger
    useDBStore.getState().setDriveDebounceTrigger(() => {
      useSyncStore.getState().syncNow();
    });
  }

  if (!isReady) {
    return <AppSkeleton />;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f5f0e8", fontFamily: "var(--font-mono)", display: "flex", flexDirection: "column" }}>
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
    <div style={{ minHeight: "100vh", background: "#f5f0e8", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-mono)" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: "32px", height: "32px", border: "2px solid #d1c9b8", borderTopColor: "#0e0e0e", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 16px" }} />
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
    <div style={{ padding: "10px 20px", background: "#fef3c7", borderBottom: "1px solid #d97706", fontSize: "0.75rem", color: "#92400e", display: "flex", alignItems: "center", gap: "8px" }}>
      <span>⚠</span>
      <span>Your local data may be cleared by the browser. Ensure Drive sync is active to keep your data safe.</span>
    </div>
  );
}
