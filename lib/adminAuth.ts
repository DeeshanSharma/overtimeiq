/**
 * lib/adminAuth.ts
 *
 * Server-side admin check.
 * Add emails to ADMIN_EMAILS in .env.local (comma-separated):
 *   ADMIN_EMAILS=you@gmail.com,colleague@gmail.com
 *
 * Usage in server components / route handlers:
 *   const { ok, email } = await requireAdmin();
 *   if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
 */

import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function getAdminEmails(): Promise<Set<string>> {
  const raw = process.env.ADMIN_EMAILS ?? "";
  return new Set(
    raw.split(",").map(e => e.trim().toLowerCase()).filter(Boolean)
  );
}

export async function requireAdmin(): Promise<{
  ok: boolean;
  email: string | null;
  userId: string | null;
}> {
  const supabase = await getSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user || !user.email) {
    return { ok: false, email: null, userId: null };
  }

  const admins = await getAdminEmails();
  return {
    ok: admins.has(user.email.toLowerCase()),
    email: user.email,
    userId: user.id,
  };
}
