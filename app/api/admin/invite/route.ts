/**
 * app/api/admin/invite/route.ts
 *
 * POST   /api/admin/invite — create invite for any email
 * DELETE /api/admin/invite — revoke (expire) an existing invite
 * GET    /api/admin/invite — list all invites
 */

import { requireAdmin } from '@/lib/adminAuth';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';
import dayjs from 'dayjs';
import { NextResponse, type NextRequest } from 'next/server';

function service() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);
}

export async function GET() {
  const { ok } = await requireAdmin();
  if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const db = service();
  const { data, error } = await db.from('invites').select('*').order('created_at', { ascending: false }).limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ invites: data });
}

export async function POST(request: NextRequest) {
  const { ok, email: adminEmail } = await requireAdmin();
  if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const email = body.email?.trim()?.toLowerCase();
  const planGrant: string = body.plan_grant ?? 'standard';
  const expiresInDays: number = body.expires_in_days ?? 7;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
  }

  const validPlans = ['beta_free', 'founding', 'standard'];
  if (!validPlans.includes(planGrant)) {
    return NextResponse.json({ error: 'Invalid plan_grant' }, { status: 400 });
  }

  const db = service();
  const token = randomBytes(16).toString('hex');
  const expiresAt = dayjs().add(expiresInDays, 'day').toISOString();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';

  // Check if there's already an unused, non-expired invite for this email
  const { data: existing } = await db
    .from('invites')
    .select('id, token')
    .eq('email', email)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .limit(1)
    .single();

  if (existing) {
    // Return the existing invite link instead of creating a duplicate
    return NextResponse.json({
      message: 'Active invite already exists for this email',
      invite_link: `${appUrl}/join/${existing.token}`,
      existing: true,
    });
  }

  const { data, error } = await db
    .from('invites')
    .insert({
      email,
      token,
      invited_by: adminEmail ?? 'admin',
      plan_grant: planGrant,
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Mark waitlist entry as converted if it exists
  await db.from('waitlist').update({ converted_at: new Date().toISOString() }).eq('email', email);

  return NextResponse.json({
    message: 'Invite created',
    invite_link: `${appUrl}/join/${token}`,
    invite: data,
    existing: false,
  });
}

export async function DELETE(request: NextRequest) {
  const { ok } = await requireAdmin();
  if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = service();
  // Expire it immediately rather than deleting — preserves the audit trail
  await db.from('invites').update({ expires_at: new Date().toISOString() }).eq('id', id).is('used_at', null);

  return NextResponse.json({ ok: true });
}
