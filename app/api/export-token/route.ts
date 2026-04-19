/**
 * app/api/export-token/route.ts
 *
 * POST /api/export-token
 * Issues a short-lived (60s) export token for Excel/PDF exports.
 * This closes the bypass gap for the highest-value Pro features —
 * export gates cannot be circumvented by a cached pro_token.
 *
 * No log data is sent to this server. Privacy is fully preserved.
 */

import { NextResponse, type NextRequest } from "next/server";
import { SignJWT, importJWK } from "jose";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { randomUUID } from "crypto";

export async function POST(request: NextRequest) {
  const supabase = await getSupabaseServerClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check subscription directly — no offline caching for this gate
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("status")
    .eq("user_id", user.id)
    .in("status", ["active", "grace"])
    .limit(1)
    .single();

  const { data: userData } = await supabase
    .from("users")
    .select("is_lifetime_free")
    .eq("id", user.id)
    .single();

  const isPro = userData?.is_lifetime_free === true || !!subscription;

  if (!isPro) {
    return NextResponse.json({ error: "Pro subscription required" }, { status: 403 });
  }

  const kid = process.env.JWT_SIGNING_KID ?? "k1";
  const privateKeyJwk = process.env.JWT_PRIVATE_KEY_JWK;

  if (!privateKeyJwk) {
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const privateKey = await importJWK(JSON.parse(privateKeyJwk), "ES256");

  // 60-second expiry — just enough time to run the export
  const token = await new SignJWT({ action: "export", jti: randomUUID() })
    .setProtectedHeader({ alg: "ES256", kid })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(privateKey);

  return NextResponse.json({ token });
}
