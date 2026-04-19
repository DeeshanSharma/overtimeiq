/**
 * app/api/waitlist/route.ts
 *
 * POST /api/waitlist
 * Adds an email to the Supabase waitlist table.
 * No auth required — public endpoint.
 * Returns 200 (added) or 409 (already exists).
 */

import { createClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';

// Use service role to bypass RLS for inserts
function getServiceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const email = body?.email?.trim()?.toLowerCase();
  const name = body?.name?.trim() ?? null;
  const source = body?.source ?? 'landing';

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
  }

  const supabase = getServiceClient();

  const { error } = await supabase.from('waitlist').insert({
    email,
    name,
    source,
  });

  if (error) {
    // Unique constraint violation = already on waitlist
    if (error.code === '23505') {
      return NextResponse.json({ message: 'Already on waitlist' }, { status: 409 });
    }
    console.error('[api/waitlist] Insert error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }

  return NextResponse.json({ message: 'Added to waitlist' }, { status: 200 });
}
