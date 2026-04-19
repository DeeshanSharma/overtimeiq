/**
 * lib/token.ts
 *
 * Client-side pro token verification using WebCrypto API.
 * Zero network calls — verification runs entirely in-browser against the
 * bundled public key from lib/publicKeys.ts.
 *
 * Token structure (ECDSA ES256 JWT):
 *   header:  { alg: "ES256", kid: "k1" }
 *   payload: { sub, plan, iat, exp, jti }
 *   signature: ECDSA_sign(header.payload, PRIVATE_KEY)
 */

import { getPublicKey, isKnownKid } from "./publicKeys";

export type ProPlan =
  | "beta_free"
  | "founding_monthly"
  | "pro_monthly"
  | "pro_annual"
  | null;

export type VerifyResult =
  | { valid: true; plan: ProPlan; sub: string; exp: number }
  | {
      valid: false;
      reason:
        | "no_token"
        | "malformed"
        | "unknown_kid"
        | "bad_signature"
        | "expired"
        | "wrong_user"
        | "invalid_plan";
    };

const VALID_PLANS: ProPlan[] = [
  "beta_free",
  "founding_monthly",
  "pro_monthly",
  "pro_annual",
];

function base64urlDecode(str: string): ArrayBuffer {
  const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Verify a pro JWT token fully client-side.
 * Checks all 7 conditions from the spec (Section 8.4).
 */
export async function verifyProToken(
  token: string | null | undefined,
  currentUserId: string
): Promise<VerifyResult> {
  // Step 1: Token present?
  if (!token) return { valid: false, reason: "no_token" };

  // Step 2: Valid JWT structure (3 parts)?
  const parts = token.split(".");
  if (parts.length !== 3) return { valid: false, reason: "malformed" };

  let header: { alg: string; kid: string };
  let payload: {
    sub: string;
    plan: string;
    iat: number;
    exp: number;
    jti: string;
  };

  try {
    header = JSON.parse(atob(parts[0].replace(/-/g, "+").replace(/_/g, "/")));
    payload = JSON.parse(
      new TextDecoder().decode(base64urlDecode(parts[1]))
    );
  } catch {
    return { valid: false, reason: "malformed" };
  }

  // Step 3: Is header.kid in our known keys?
  if (!header.kid || !isKnownKid(header.kid)) {
    return { valid: false, reason: "unknown_kid" };
  }

  // Step 4: Cryptographic signature valid?
  const publicKey = await getPublicKey(header.kid);
  if (!publicKey) return { valid: false, reason: "unknown_kid" };

  const signedData = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature = base64urlDecode(parts[2]);

  let signatureValid: boolean;
  try {
    signatureValid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      signature,
      signedData
    );
  } catch {
    return { valid: false, reason: "bad_signature" };
  }

  if (!signatureValid) return { valid: false, reason: "bad_signature" };

  // Step 5: Token not expired?
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) return { valid: false, reason: "expired" };

  // Step 6: sub matches current Supabase user ID?
  if (payload.sub !== currentUserId) return { valid: false, reason: "wrong_user" };

  // Step 7: Valid plan value?
  if (!VALID_PLANS.includes(payload.plan as ProPlan)) {
    return { valid: false, reason: "invalid_plan" };
  }

  return {
    valid: true,
    plan: payload.plan as ProPlan,
    sub: payload.sub,
    exp: payload.exp,
  };
}

/**
 * Fetch a fresh pro token from /api/pro-token (server checks Supabase).
 * Called on every online app load if current token expires within 24 hours,
 * and immediately after payment.
 */
export async function syncProToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/pro-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include", // send Supabase session cookie
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data.token ?? null;
  } catch {
    // Network failure — return null, caller will use cached token
    return null;
  }
}

/** Check if a token will expire within the next N seconds. */
export function tokenExpiresWithin(tokenExp: number, seconds: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  return tokenExp - now < seconds;
}
