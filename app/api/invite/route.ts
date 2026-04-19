/**
 * app/api/invite/route.ts
 *
 * POST /api/invite
 * Admin-only. Creates an invite row and (optionally) logs the invite link.
 * Requires Authorization: Bearer <ADMIN_SECRET> header.
 *
 * Body: { email, plan_grant?, invited_by?, expires_in_days? }
 */

import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';
import dayjs from 'dayjs';
import { NextResponse, type NextRequest } from 'next/server';

function getServiceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);
}

export async function POST(request: NextRequest) {
  // Admin auth check
  const authHeader = request.headers.get('Authorization');
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret || authHeader !== `Bearer ${adminSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const email = body?.email?.trim()?.toLowerCase();
  const planGrant = body?.plan_grant ?? 'standard';
  const invitedBy = body?.invited_by ?? 'admin';
  const expiresInDays = body?.expires_in_days ?? 7;

  if (!email) {
    return NextResponse.json({ error: 'Email required' }, { status: 400 });
  }

  const validPlanGrants = ['beta_free', 'founding', 'standard'];
  if (!validPlanGrants.includes(planGrant)) {
    return NextResponse.json({ error: 'Invalid plan_grant' }, { status: 400 });
  }

  // Generate 32-char hex token
  const token = randomBytes(16).toString('hex');
  const expiresAt = dayjs().add(expiresInDays, 'day').toISOString();

  const supabase = getServiceClient();

  const { data, error } = await supabase
    .from('invites')
    .insert({
      email,
      token,
      invited_by: invitedBy,
      plan_grant: planGrant,
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error) {
    console.error('[api/invite] Insert error:', error);
    return NextResponse.json({ error: 'Failed to create invite' }, { status: 500 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
  const inviteLink = `${appUrl}/join/${token}`;

  // Mark waitlist entry as converted if it exists
  await supabase.from('waitlist').update({ converted_at: new Date().toISOString() }).eq('email', email);

  // TODO: Send invite email via your email provider (Resend, Postmark, etc.)
  // For now, the invite link is returned in the response for manual sending.
  console.log(`[api/invite] Invite created for ${email}: ${inviteLink}`);

  return NextResponse.json({
    message: 'Invite created',
    invite_link: inviteLink,
    expires_at: expiresAt,
    plan_grant: planGrant,
  });
}
