import { exchangeCode } from '@/lib/auth';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import dayjs from 'dayjs';
import { NextResponse, type NextRequest } from 'next/server';

const VALID_SOURCES = new Set(['landing', 'linkedin', 'devto', 'producthunt', 'twitter', 'referral']);

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const verifier = searchParams.get('verifier');
  // Referral source passed through from the processing page
  const rawSource = searchParams.get('ref_source') ?? 'landing';
  const refCode = searchParams.get('ref_code') ?? null;
  const refSource = VALID_SOURCES.has(rawSource) ? rawSource : 'landing';

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error)}`);
  }
  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }
  // No verifier yet — redirect to processing page to read it from sessionStorage
  if (!verifier) {
    return NextResponse.redirect(`${origin}/auth/processing?code=${code}`);
  }

  try {
    const redirectUri = `${origin}/auth/callback`;
    const tokens = await exchangeCode(code, verifier, redirectUri);

    const supabase = await getSupabaseServiceClient();
    const { data: authData, error: authError } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: tokens.id_token,
    });

    if (authError || !authData.user) {
      console.error('[auth/callback] signInWithIdToken failed:', authError);
      return NextResponse.redirect(`${origin}/login?error=auth_failed`);
    }

    const uid = authData.user.id;
    const email = authData.user.email!;
    const googleId = (authData.user.user_metadata?.sub as string) ?? uid;

    // ── Check existing user row ───────────────────────────────────────────
    const { data: existingUser } = await supabase.from('users').select('id, status').eq('id', uid).single();

    let status = existingUser?.status ?? null;

    // ── Helper: look up ANY invite for this email (valid or expired) ──────
    // Returns { valid, expired, invite } so we can branch cleanly.
    async function findInvite(email: string) {
      const now = new Date().toISOString();

      // 1. Unused + not expired = valid
      const { data: valid } = await supabase
        .from('invites')
        .select('id, plan_grant, expires_at')
        .eq('email', email)
        .is('used_at', null)
        .gt('expires_at', now)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (valid) return { valid: true, expired: false, invite: valid };

      // 2. Unused + expired
      const { data: expired } = await supabase
        .from('invites')
        .select('id, plan_grant, expires_at')
        .eq('email', email)
        .is('used_at', null)
        .lte('expires_at', now)
        .order('expires_at', { ascending: false })
        .limit(1)
        .single();

      if (expired) return { valid: false, expired: true, invite: expired };

      return { valid: false, expired: false, invite: null };
    }

    // ── Helper: grant beta access from a valid invite ─────────────────────
    async function grantAccess(invite: { id: string; plan_grant: string }) {
      const isLifetimeFree = invite.plan_grant === 'beta_free';
      await supabase
        .from('users')
        .upsert(
          { id: uid, email, google_id: googleId, status: 'beta', is_lifetime_free: isLifetimeFree },
          { onConflict: 'id' },
        );

      const now = dayjs();
      const planMap: Record<string, string> = {
        beta_free: 'beta_free',
        founding: 'founding_monthly',
        standard: 'pro_monthly',
      };

      // Insert subscription only if one doesn't already exist
      const { data: existingSub } = await supabase
        .from('subscriptions')
        .select('id')
        .eq('user_id', uid)
        .limit(1)
        .single();

      if (!existingSub) {
        await supabase.from('subscriptions').insert({
          user_id: uid,
          plan: planMap[invite.plan_grant] ?? 'pro_monthly',
          status: 'active',
          current_period_start: now.toISOString(),
          current_period_end: now.add(30, 'day').toISOString(),
        });
      }

      // Mark invite as used
      await supabase.from('invites').update({ used_at: now.toISOString() }).eq('id', invite.id);

      // Mark waitlist as converted if they were on it
      await supabase.from('waitlist').update({ converted_at: now.toISOString() }).eq('email', email);
    }

    // ── Helper: add user to waitlist ──────────────────────────────────────
    async function addToWaitlist() {
      await supabase
        .from('users')
        .upsert({ id: uid, email, google_id: googleId, status: 'waitlist' }, { onConflict: 'id' });

      const { data: existingWL } = await supabase.from('waitlist').select('id, source').eq('email', email).single();

      if (existingWL) {
        if (existingWL.source === 'landing' && refSource !== 'landing') {
          await supabase.from('waitlist').update({ source: refSource, referral_code: refCode }).eq('email', email);
        }
      } else {
        await supabase.from('waitlist').insert({ email, source: refSource, referral_code: refCode });
      }
    }

    // ── Main routing logic ────────────────────────────────────────────────

    if (!existingUser) {
      // Brand-new user — check their invite state
      const { valid, expired, invite } = await findInvite(email);

      if (valid && invite) {
        await grantAccess(invite);
        status = 'beta';
      } else if (expired && invite) {
        // Expired invite — redirect to a clear error page
        // Don't create a user row yet — they need a fresh invite first
        return NextResponse.redirect(`${origin}/invite-expired?email=${encodeURIComponent(email)}`);
      } else {
        // No invite at all → waitlist
        await addToWaitlist();
        status = 'waitlist';
      }
    } else if (existingUser.status === 'waitlist') {
      // Returning waitlisted user — check if they've been invited since last visit
      const { valid, expired, invite } = await findInvite(email);

      if (valid && invite) {
        // They've been invited since they last visited — let them in
        await grantAccess(invite);
        status = 'beta';
      } else if (expired && invite) {
        // Had an invite but it expired before they used it
        return NextResponse.redirect(`${origin}/invite-expired?email=${encodeURIComponent(email)}`);
      } else {
        // Still no invite — update last_seen and keep them on waitlist
        await supabase.from('users').update({ last_seen_at: new Date().toISOString() }).eq('id', uid);
        status = 'waitlist';
      }
    } else {
      // Active / beta user — just bump last_seen
      await supabase.from('users').update({ last_seen_at: new Date().toISOString() }).eq('id', uid);
    }

    // ── Final redirect ────────────────────────────────────────────────────
    const destination = status === 'waitlist' ? `${origin}/waitlist` : `${origin}/dashboard`;
    const response = NextResponse.redirect(destination);

    if (tokens.refresh_token) {
      response.cookies.set('g_rt_once', tokens.refresh_token, {
        httpOnly: process.env.NODE_ENV === 'production',
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60,
        path: '/',
      });
    }

    return response;
  } catch (err) {
    console.error('[auth/callback] Unexpected error:', err);
    return NextResponse.redirect(`${origin}/login?error=unexpected`);
  }
}
