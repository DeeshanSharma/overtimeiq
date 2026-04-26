/**
 * app/api/google-token/route.ts
 *
 * POST /api/google-token
 * Server-side Google access token refresh.
 *
 * Why this exists:
 *   GOOGLE_CLIENT_SECRET has no NEXT_PUBLIC_ prefix — it is undefined in browser
 *   JS bundles. refreshAccessToken() in lib/auth.ts can't use it client-side.
 *   This route runs on the server where the secret is available, and returns
 *   only the short-lived access_token (never the refresh_token or secret).
 *
 * Security:
 *   - Requires valid Supabase session cookie (authenticated users only)
 *   - Receives the refresh_token in the request body (stored on user's own Drive)
 *   - Returns only the access_token — nothing else
 *   - The refresh_token never gets logged or stored server-side
 */

import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export async function POST(request: NextRequest) {
  // Auth check — only signed-in users can use this endpoint
  const supabase = await getSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const refreshToken = body?.refresh_token as string | undefined;

  if (!refreshToken) {
    return NextResponse.json({ error: "refresh_token required" }, { status: 400 });
  }

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";

  if (!clientSecret) {
    console.error("[api/google-token] GOOGLE_CLIENT_SECRET not set");
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("[api/google-token] Google refresh failed:", err);
    return NextResponse.json({ error: "Token refresh failed", detail: err }, { status: 502 });
  }

  const data = await res.json();

  // Return only the access_token — never forward client_secret or other fields
  return NextResponse.json({
    access_token: data.access_token,
    expires_in: data.expires_in,
  });
}
