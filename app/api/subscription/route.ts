/**
 * app/api/subscription/route.ts
 *
 * GET /api/subscription
 * Returns current plan and status. Polled by the app immediately after
 * payment redirect to confirm subscription is active before minting a new pro-token.
 */

import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await getSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("plan, status, current_period_end, cancel_at_period_end")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  const { data: userData } = await supabase
    .from("users")
    .select("is_lifetime_free, status")
    .eq("id", user.id)
    .single();

  return NextResponse.json({
    plan: subscription?.plan ?? null,
    status: subscription?.status ?? "none",
    current_period_end: subscription?.current_period_end ?? null,
    cancel_at_period_end: subscription?.cancel_at_period_end ?? false,
    is_lifetime_free: userData?.is_lifetime_free ?? false,
    user_status: userData?.status ?? null,
  });
}
