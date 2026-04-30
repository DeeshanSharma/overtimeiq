/**
 * lib/referral.ts
 *
 * Tracks where a user came from before they sign up.
 *
 * Flow:
 *  1. User lands on any page with ?ref=linkedin (or ?ref=devto, ?ref=producthunt, etc.)
 *  2. captureReferral() reads the param and saves it to localStorage immediately
 *  3. If the user removes the param and reloads, the value is still in localStorage
 *  4. When the user submits the waitlist form or clicks Google sign-in,
 *     getReferralSource() reads the stored value to pass as `source` to Supabase
 *  5. clearReferral() is called after the form submit / auth redirect — one-time use
 *
 * Referral sources (matches Supabase waitlist.source CHECK constraint):
 *   landing     — direct visit, no ref param
 *   linkedin    — ?ref=linkedin
 *   devto       — ?ref=devto
 *   producthunt — ?ref=producthunt
 *   referral    — ?ref=referral or any unknown ref value (generic referral link)
 *
 * To generate share links:
 *   https://yourapp.com?ref=linkedin
 *   https://yourapp.com?ref=devto
 *   https://yourapp.com?ref=producthunt
 *   https://yourapp.com/join/TOKEN?ref=referral  (for personal referral links)
 */

const STORAGE_KEY = "otiq_ref_source";
const STORAGE_CODE_KEY = "otiq_ref_code"; // for personalised referral codes

// Map of known ?ref values → Supabase source enum values
const REF_MAP: Record<string, string> = {
  linkedin:     "linkedin",
  devto:        "devto",
  "dev.to":     "devto",
  producthunt:  "producthunt",
  ph:           "producthunt",
  referral:     "referral",
  twitter:      "twitter",
  x:            "twitter",
};

/**
 * Call this on every page load (in a useEffect on the landing page and login page).
 * Reads ?ref and ?code from the URL and saves them to localStorage.
 * Does nothing if no ref param is present — preserves any existing stored value.
 */
export function captureReferral(): void {
  if (typeof window === "undefined") return;

  const params = new URLSearchParams(window.location.search);
  const ref = params.get("ref");
  const refCode = params.get("ref_code");

  if (ref) {
    const source = REF_MAP[ref.toLowerCase()] ?? "referral";
    // Only update if not already set — first touch wins
    if (!localStorage.getItem(STORAGE_KEY)) {
      localStorage.setItem(STORAGE_KEY, source);
    }
  }

  if (refCode && !localStorage.getItem(STORAGE_CODE_KEY)) {
    localStorage.setItem(STORAGE_CODE_KEY, refCode);
  }
}

/**
 * Returns the tracked referral source, or "landing" if none was captured.
 */
export function getReferralSource(): string {
  if (typeof window === "undefined") return "landing";
  return localStorage.getItem(STORAGE_KEY) ?? "landing";
}

/**
 * Returns the tracked referral code (for personal referral links), or null.
 */
export function getReferralCode(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_CODE_KEY);
}

/**
 * Clears referral data from localStorage.
 * Call this after the waitlist form submits successfully or after Google sign-in redirect.
 */
export function clearReferral(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(STORAGE_CODE_KEY);
}
