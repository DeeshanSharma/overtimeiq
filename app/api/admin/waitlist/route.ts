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

  // Waitlist entries
  const { data: waitlist, error } = await db.from('waitlist').select('*').order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Augment with invite + user status
  const emails = waitlist.map((w) => w.email);

  const { data: invites } = await db
    .from('invites')
    .select('email, plan_grant, used_at, expires_at, created_at')
    .in('email', emails);

  const { data: users } = await db.from('users').select('email, status, is_lifetime_free').in('email', emails);

  const inviteMap = Object.fromEntries((invites ?? []).map((i) => [i.email, i]));
  const userMap = Object.fromEntries((users ?? []).map((u) => [u.email, u]));

  const enriched = waitlist.map((w) => ({
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
