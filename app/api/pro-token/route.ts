/**
 * app/api/pro-token/route.ts
 *
 * POST /api/pro-token
 * Requires valid Supabase session cookie.
 *
 * Flow:
 *  1. Verify Supabase session
 *  2. Query subscriptions table for active/grace Pro plan
 *  3. If Pro: sign ECDSA ES256 JWT (3-day expiry, kid in header)
 *  4. Return { token } or { pro: false }
 *
 * The client verifies this token locally via WebCrypto (lib/token.ts).
 * The private key NEVER leaves the server.
 */

import { NextResponse, type NextRequest } from "next/server";
import { SignJWT, importJWK } from "jose";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { randomUUID } from "crypto";

const PRO_STATUSES = ["active", "grace"];

export async function POST(request: NextRequest) {
  // 1. Verify Supabase session
  const supabase = await getSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Query subscription
  const { data: subscription, error: subError } = await supabase
    .from("subscriptions")
    .select("plan, status")
    .eq("user_id", user.id)
    .in("status", PRO_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  // Check for lifetime free (beta tester) — these users always get Pro
  const { data: userData } = await supabase
    .from("users")
    .select("is_lifetime_free")
    .eq("id", user.id)
    .single();

  const isLifetimeFree = userData?.is_lifetime_free === true;
  const isPro = isLifetimeFree || (!!subscription && !subError);

  if (!isPro) {
    return NextResponse.json({ pro: false });
  }

  // 3. Mint ECDSA ES256 JWT
  const kid = process.env.JWT_SIGNING_KID ?? "k1";
  const privateKeyJwk = process.env.JWT_PRIVATE_KEY_JWK;

  if (!privateKeyJwk) {
    console.error("[api/pro-token] JWT_PRIVATE_KEY_JWK not set");
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  let privateKey;
  try {
    privateKey = await importJWK(JSON.parse(privateKeyJwk), "ES256");
  } catch (err) {
    console.error("[api/pro-token] Failed to import private key:", err);
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const plan = isLifetimeFree
    ? "beta_free"
    : (subscription?.plan ?? "pro_monthly");

  const token = await new SignJWT({ plan, jti: randomUUID() })
    .setProtectedHeader({ alg: "ES256", kid })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("3d") // 3-day expiry — enforced cryptographically
    .sign(privateKey);

  return NextResponse.json({ token, pro: true });
}
