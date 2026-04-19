/**
 * lib/auth.ts
 *
 * Google OAuth 2.0 PKCE flow.
 * No client secret. Runs entirely in the browser for the redirect leg.
 * Server-side code exchange happens in /auth/callback/route.ts.
 *
 * Token lifecycle:
 *  - access_token  → sessionStorage (1-hour lifetime)
 *  - refresh_token → SQLite settings.google_refresh_token (permanent, on user's Drive)
 *  - id_token      → passed to Supabase signInWithIdToken(), then discarded
 */

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.file",
].join(" ");

// ─── PKCE helpers ─────────────────────────────────────────────────────────────

/** Generate a cryptographically random code_verifier (64 chars, URL-safe). */
export function generateVerifier(): string {
  const array = new Uint8Array(48);
  crypto.getRandomValues(array);
  return base64urlEncode(array);
}

/** SHA-256 hash of the verifier, base64url-encoded → code_challenge. */
export async function generateChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return base64urlEncode(new Uint8Array(hash));
}

function base64urlEncode(buffer: Uint8Array): string {
  return btoa(String.fromCharCode(...buffer))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

// ─── Auth URL builder ─────────────────────────────────────────────────────────

export interface BuildAuthURLOptions {
  challenge: string;
  /** Pre-fill the Google login UI with the invited user's email. */
  loginHint?: string;
  /** Redirect back here after Google auth. Defaults to /auth/callback. */
  redirectUri?: string;
}

export function buildAuthURL({
  challenge,
  loginHint,
  redirectUri,
}: BuildAuthURLOptions): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri ?? `${appUrl}/auth/callback`,
    response_type: "code",
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    // Required to receive refresh_token
    access_type: "offline",
    // Forces consent screen so Google always issues a refresh_token.
    // Without this, subsequent logins skip consent and omit refresh_token.
    prompt: "consent",
    ...(loginHint ? { login_hint: loginHint } : {}),
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

// ─── Code exchange (server-side) ─────────────────────────────────────────────

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token: string;
  id_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

export async function exchangeCode(
  code: string,
  verifier: string,
  redirectUri: string
): Promise<GoogleTokenResponse> {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? '';

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google token exchange failed: ${err}`);
  }

  return res.json() as Promise<GoogleTokenResponse>;
}

// ─── Silent token refresh (client-side, mid-session) ─────────────────────────

/**
 * Refresh the Google access token using the stored refresh_token.
 * Called every ~55 minutes by useSyncStore, or on Drive 401.
 * Returns the new access_token (stored in memory; never written to server).
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<string> {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

  const body = new URLSearchParams({
    client_id: clientId,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error("Google access token refresh failed");
  }

  const data = await res.json();
  return data.access_token as string;
}

// ─── Decode id_token (client-side, no verification needed here) ───────────────

/** Decode the JWT payload from Google's id_token — no signature verification
 *  needed because we received this directly from Google over HTTPS. */
export function decodeIdToken(idToken: string): Record<string, unknown> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Invalid id_token format");
  const payload = parts[1];
  const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
  return JSON.parse(atob(padded));
}
