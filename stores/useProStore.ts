/**
 * stores/useProStore.ts
 *
 * Manages pro subscription state.
 * Fetches a signed JWT from /api/pro-token, verifies it client-side
 * using WebCrypto (via lib/token.ts), and exposes isPro() and currentPlan().
 *
 * All feature gate checks in the UI should call isPro() from this store —
 * never read pro_plan directly from SQLite.
 */

import { create } from "zustand";
import { syncProToken, verifyProToken, tokenExpiresWithin, type ProPlan } from "@/lib/token";
import { isPro as isProPlan } from "@/lib/gating";

interface ProState {
  /** Verified plan from JWT payload — null means free tier. */
  plan: ProPlan;
  /** Raw JWT string — stored to SQLite by useSettingsStore. */
  token: string | null;
  /** Loading state for initial verification on app load. */
  isVerifying: boolean;
  /** Expiry timestamp (Unix seconds) from the verified JWT. */
  tokenExp: number | null;

  // Actions
  /** Called on every online app load. Fetches fresh token if needed, then verifies. */
  initPro: (supabaseUserId: string, cachedToken: string | null) => Promise<void>;
  /** Verify a token string. Call after restoring cached token from SQLite. */
  verifyToken: (token: string, supabaseUserId: string) => Promise<void>;
  /** Reset to free tier (on sign-out or verification failure). */
  clearPro: () => void;
  /** True if current plan is any Pro plan. */
  isPro: () => boolean;
  /** The current plan string. */
  currentPlan: () => ProPlan;
}

export const useProStore = create<ProState>((set, get) => ({
  plan: null,
  token: null,
  isVerifying: true,
  tokenExp: null,

  isPro: () => isProPlan(get().plan),
  currentPlan: () => get().plan,

  clearPro: () => set({ plan: null, token: null, isVerifying: false, tokenExp: null }),

  verifyToken: async (token: string, supabaseUserId: string) => {
    const result = await verifyProToken(token, supabaseUserId);
    if (result.valid) {
      set({ plan: result.plan, token, isVerifying: false, tokenExp: result.exp });
    } else {
      set({ plan: null, token: null, isVerifying: false, tokenExp: null });
    }
  },

  initPro: async (supabaseUserId: string, cachedToken: string | null) => {
    set({ isVerifying: true });

    // If we have a cached token, verify it first (works offline)
    if (cachedToken) {
      const cached = await verifyProToken(cachedToken, supabaseUserId);
      if (cached.valid) {
        set({
          plan: cached.plan,
          token: cachedToken,
          tokenExp: cached.exp,
          isVerifying: false,
        });

        // Only fetch a fresh token if current one expires within 24 hours
        if (!tokenExpiresWithin(cached.exp, 24 * 60 * 60)) {
          return; // Cached token is still fresh, no need to hit the server
        }
      }
    }

    // Fetch a fresh token from the server (requires Supabase session)
    const freshToken = await syncProToken();

    if (freshToken) {
      const result = await verifyProToken(freshToken, supabaseUserId);
      if (result.valid) {
        set({
          plan: result.plan,
          token: freshToken,
          tokenExp: result.exp,
          isVerifying: false,
        });
        // Caller (useSettingsStore) should persist this token to SQLite settings.pro_token
        return;
      }
    }

    // No valid token — free tier
    set({ plan: null, token: null, isVerifying: false, tokenExp: null });
  },
}));
