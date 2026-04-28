/**
 * app/api/admin/waitlist/route.ts
 *
 * GET  /api/admin/waitlist  — list all waitlist entries with invite/user status
 * DELETE /api/admin/waitlist — remove an entry from the waitlist
 */

import { requireAdmin } from '@/lib/adminAuth';
import { createClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';

function service() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);
}

export async function GET() {
  const { ok } = await requireAdmin();
  if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const db = service();

  // Get all waitlist form entries
  const { data: waitlist, error } = await db.from('waitlist').select('*').order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Also get users who signed in via Google but are still in waitlist status
  // (they skipped the form and went straight to Google sign-in)
  const { data: waitlistUsers } = await db
    .from('users')
    .select('id, email, status, created_at')
    .eq('status', 'waitlist');

  // Build unified list: form entries + Google-signed-in waitlist users not already in form list
  const formEmails = new Set((waitlist ?? []).map((w) => w.email));
  const googleOnlyUsers = (waitlistUsers ?? []).filter((u) => !formEmails.has(u.email));

  // Convert Google-only users into waitlist-shaped entries
  const googleEntries = googleOnlyUsers.map((u) => ({
    id: u.id,
    email: u.email,
    name: null,
    source: 'google_signin', // special marker for the UI
    referral_code: null,
    converted_at: null,
    created_at: u.created_at,
    _google_only: true,
  }));

  const allEntries = [...(waitlist ?? []), ...googleEntries].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  const allEmails = allEntries.map((w) => w.email);

  // Enrich with invite + user status
  const { data: invites } = await db
    .from('invites')
    .select('email, plan_grant, token, used_at, expires_at, created_at, id')
    .in('email', allEmails);

  const { data: users } = await db.from('users').select('email, status, is_lifetime_free').in('email', allEmails);

  // Use the most recent active invite per email
  const inviteMap: Record<string, NonNullable<typeof invites>[number]> = {};
  for (const inv of invites ?? []) {
    const existing = inviteMap[inv.email];
    if (!existing || new Date(inv.created_at) > new Date(existing.created_at)) {
      inviteMap[inv.email] = inv;
    }
  }

  const userMap = Object.fromEntries((users ?? []).map((u) => [u.email, u]));

  const enriched = allEntries.map((w) => ({
    ...w,
    invite: inviteMap[w.email] ?? null,
    user: userMap[w.email] ?? null,
  }));

  return NextResponse.json({ waitlist: enriched });
}

export async function DELETE(request: NextRequest) {
  const { ok } = await requireAdmin();
  if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { email } = await request.json();
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });

  const db = service();
  await db.from('waitlist').delete().eq('email', email);

  return NextResponse.json({ ok: true });
}
