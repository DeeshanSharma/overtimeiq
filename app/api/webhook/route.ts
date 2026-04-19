/**
 * app/api/webhook/route.ts
 *
 * POST /api/webhook
 * Receives Cashfree subscription events.
 * Validates HMAC-SHA256 signature before processing.
 *
 * Events handled:
 *  - SUBSCRIPTION_PAYMENT_SUCCESS → upsert subscription as active
 *  - SUBSCRIPTION_CANCELLED       → set cancel_at_period_end = true
 *  - SUBSCRIPTION_STATUS_CHANGE   → update status field
 */

import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'crypto';
import dayjs from 'dayjs';
import { NextResponse, type NextRequest } from 'next/server';

function getServiceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);
}

function verifyHmac(payload: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(payload).digest('base64');
  // Constant-time comparison
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-webhook-signature') ?? '';
  const secret = process.env.CASHFREE_WEBHOOK_SECRET ?? '';

  // Validate HMAC-SHA256 signature
  if (!verifyHmac(rawBody, signature, secret)) {
    console.warn('[api/webhook] Invalid signature — rejecting');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const eventType = event.event as string;
  const supabase = getServiceClient();

  // Look up user by email (Cashfree provides customer_email)
  const customerEmail = (event.customer_email as string)?.toLowerCase();
  if (!customerEmail) {
    return NextResponse.json({ ok: true }); // Ignore events without email
  }

  const { data: user } = await supabase.from('users').select('id').eq('email', customerEmail).single();

  if (!user) {
    console.warn(`[api/webhook] No user found for email ${customerEmail}`);
    return NextResponse.json({ ok: true });
  }

  const now = dayjs();

  if (eventType === 'SUBSCRIPTION_PAYMENT_SUCCESS') {
    const planId = event.subscription_plan_id as string;
    const plan = mapCashfreePlan(planId);

    await supabase.from('subscriptions').upsert(
      {
        user_id: user.id,
        plan,
        status: 'active',
        current_period_start: now.toISOString(),
        current_period_end: now.add(plan.includes('annual') ? 365 : 31, 'day').toISOString(),
        cancel_at_period_end: false,
        cashfree_subscription_id: event.subscription_id as string,
        cashfree_customer_id: event.customer_id as string,
        updated_at: now.toISOString(),
      },
      { onConflict: 'user_id' },
    );

    // Activate user if they were in beta/waitlist state
    await supabase
      .from('users')
      .update({ status: 'active', last_seen_at: now.toISOString() })
      .eq('id', user.id)
      .in('status', ['beta', 'waitlist']);

    console.log(`[api/webhook] Payment success for ${customerEmail}, plan=${plan}`);
  } else if (eventType === 'SUBSCRIPTION_CANCELLED') {
    await supabase
      .from('subscriptions')
      .update({
        cancel_at_period_end: true,
        status: 'cancelled',
        updated_at: now.toISOString(),
      })
      .eq('user_id', user.id);

    console.log(`[api/webhook] Subscription cancelled for ${customerEmail}`);
  } else if (eventType === 'SUBSCRIPTION_STATUS_CHANGE') {
    const newStatus = event.status as string;
    const mappedStatus = mapCashfreeStatus(newStatus);
    if (mappedStatus) {
      await supabase
        .from('subscriptions')
        .update({ status: mappedStatus, updated_at: now.toISOString() })
        .eq('user_id', user.id);
    }
  }

  return NextResponse.json({ ok: true });
}

function mapCashfreePlan(cashfreePlanId: string): string {
  if (cashfreePlanId?.includes('annual')) return 'pro_annual';
  if (cashfreePlanId?.includes('founding')) return 'founding_monthly';
  return 'pro_monthly';
}

function mapCashfreeStatus(cashfreeStatus: string): string | null {
  const map: Record<string, string> = {
    ACTIVE: 'active',
    CANCELLED: 'cancelled',
    BANK_APPROVAL_PENDING: 'past_due',
    EXPIRED: 'expired',
  };
  return map[cashfreeStatus] ?? null;
}
