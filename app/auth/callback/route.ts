/**
 * app/auth/callback/route.ts
 *
 * PKCE code exchange flow (Section 7.1, Steps 5–8):
 *  1. Receive ?code from Google redirect
 *  2. Retrieve code_verifier from cookie (set during login initiation)
 *  3. Exchange code + verifier → access_token, refresh_token, id_token
 *  4. Pass id_token to supabase.auth.signInWithIdToken()
 *  5. Check users.status and route accordingly:
 *     - waitlist → /waitlist
 *     - invited  → mark invite used, seed subscription, → /log
 *     - beta/active → /log
 *
 * The refresh_token is NOT stored here — it's saved to SQLite by useSettingsStore
 * after the DB initialises on first app load (Steps 9 of the spec flow).
 * We pass it to the app via a short-lived HttpOnly cookie that the client reads once.
 */

import { exchangeCode } from '@/lib/auth';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import dayjs from 'dayjs';
import { NextResponse, type NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  // Google returned an error (user denied consent, etc.)
  if (error) {
    return NextResponse.redirect(`${origin}/?error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/?error=missing_code`);
  }

  // Retrieve the PKCE verifier from cookie (set during login initiation)
  const verifier = request.cookies.get('pkce_verifier')?.value;
  if (!verifier) {
    return NextResponse.redirect(`${origin}/?error=missing_verifier`);
  }

  try {
    // Exchange code → tokens
    const redirectUri = `${origin}/auth/callback`;
    const tokens = await exchangeCode(code, verifier, redirectUri);

    // Sign in to Supabase using the id_token
    const supabase = await getSupabaseServiceClient();
    const { data: authData, error: authError } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: tokens.id_token,
    });

    if (authError || !authData.user) {
      console.error('[auth/callback] signInWithIdToken failed:', authError);
      return NextResponse.redirect(`${origin}/?error=auth_failed`);
    }

    const supabaseUserId = authData.user.id;
    const userEmail = authData.user.email!;
    const googleId = authData.user.user_metadata?.sub ?? authData.user.id;

    // Check or create users row
    const { data: existingUser } = await supabase.from('users').select('id, status').eq('id', supabaseUserId).single();

    let userStatus = existingUser?.status ?? null;

    if (!existingUser) {
      // First-ever login — check if they have a pending invite
      const { data: invite } = await supabase
        .from('invites')
        .select('id, plan_grant, used_at, expires_at')
        .eq('email', userEmail)
        .is('used_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!invite) {
        // No valid invite — create user with waitlist status
        await supabase.from('users').insert({
          id: supabaseUserId,
          email: userEmail,
          google_id: googleId,
          status: 'waitlist',
        });
        userStatus = 'waitlist';
      } else {
        // Valid invite — create user with beta status and seed subscription
        const isLifetimeFree = invite.plan_grant === 'beta_free';

        await supabase.from('users').insert({
          id: supabaseUserId,
          email: userEmail,
          google_id: googleId,
          status: 'beta',
          is_lifetime_free: isLifetimeFree,
        });

        // Seed subscription based on plan_grant
        const now = dayjs();
        const planMap: Record<string, string> = {
          beta_free: 'beta_free',
          founding: 'founding_monthly',
          standard: 'pro_monthly',
        };
        const plan = planMap[invite.plan_grant] ?? 'pro_monthly';

        await supabase.from('subscriptions').insert({
          user_id: supabaseUserId,
          plan,
          status: 'active',
          current_period_start: now.toISOString(),
          current_period_end: now.add(30, 'day').toISOString(),
        });

        // Mark invite as used
        await supabase.from('invites').update({ used_at: now.toISOString() }).eq('id', invite.id);

        userStatus = 'beta';
      }
    } else {
      // Returning user — update last_seen_at
      await supabase.from('users').update({ last_seen_at: new Date().toISOString() }).eq('id', supabaseUserId);
    }

    // Route based on status
    let destination: string;
    if (userStatus === 'waitlist') {
      destination = `${origin}/waitlist`;
    } else {
      destination = `${origin}/log`;
    }

    const response = NextResponse.redirect(destination);

    // Clear the PKCE verifier cookie
    response.cookies.delete('pkce_verifier');

    // Pass the Google refresh_token to the client via a one-time cookie.
    // The (app) layout reads this, saves it to SQLite, then deletes the cookie.
    if (tokens.refresh_token) {
      response.cookies.set('g_rt_once', tokens.refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60, // 60 seconds — read once then gone
        path: '/',
      });
    }

    return response;
  } catch (err) {
    console.error('[auth/callback] Unexpected error:', err);
    return NextResponse.redirect(`${origin}/?error=unexpected`);
  }
}
