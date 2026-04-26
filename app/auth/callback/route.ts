import { exchangeCode } from '@/lib/auth';
import { getSupabaseServiceClient } from '@/lib/supabase/server';
import dayjs from 'dayjs';
import { NextResponse, type NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const verifier = searchParams.get('verifier');

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error)}`);
  }
  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }
  // No verifier yet — redirect to processing page which reads it from sessionStorage
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

    const { data: existingUser } = await supabase.from('users').select('id, status').eq('id', uid).single();

    let status = existingUser?.status ?? null;

    if (!existingUser) {
      // Check for valid pending invite
      const { data: invite } = await supabase
        .from('invites')
        .select('id, plan_grant')
        .eq('email', email)
        .is('used_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!invite) {
        // No valid invite — create user with waitlist status
        await supabase
          .from('users')
          .upsert({ id: uid, email, google_id: googleId, status: 'waitlist' }, { onConflict: 'id' });
        await supabase
          .from('waitlist')
          .upsert({ email, source: 'landing' }, { onConflict: 'email', ignoreDuplicates: true });
        status = 'waitlist';
      } else {
        // Valid invite → beta access
        const isLifetimeFree = invite.plan_grant === 'beta_free';
        await supabase
          .from('users')
          .upsert(
            { id: uid, email, google_id: googleId, status: 'beta', is_lifetime_free: isLifetimeFree },
            { onConflict: 'id' },
          );

        // Seed subscription based on plan_grant
        const now = dayjs();
        const planMap: Record<string, string> = {
          beta_free: 'beta_free',
          founding: 'founding_monthly',
          standard: 'pro_monthly',
        };
        await supabase.from('subscriptions').insert({
          user_id: uid,
          plan: planMap[invite.plan_grant] ?? 'pro_monthly',
          status: 'active',
          current_period_start: now.toISOString(),
          current_period_end: now.add(30, 'day').toISOString(),
        });

        // Mark invite as used
        await supabase.from('invites').update({ used_at: now.toISOString() }).eq('id', invite.id);
        status = 'beta';
      }
    } else {
      // Returning user — update last_seen_at
      await supabase.from('users').update({ last_seen_at: new Date().toISOString() }).eq('id', uid);
    }

    const destination = status === 'waitlist' ? `${origin}/waitlist` : `${origin}/log`;
    const response = NextResponse.redirect(destination);

    if (tokens.refresh_token) {
      response.cookies.set('g_rt_once', tokens.refresh_token, {
        httpOnly: true,
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
