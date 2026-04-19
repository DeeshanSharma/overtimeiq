/**
 * app/(marketing)/join/[token]/page.tsx
 *
 * Server component. Validates the invite token server-side before rendering.
 * If valid: shows "You're invited" page with Google Sign-In button.
 * If invalid/expired/used: shows error page.
 */

import { createClient } from '@supabase/supabase-js';
import InviteClaimClient from './InviteClaimClient';

interface PageProps {
  params: Promise<{ token: string }>;
}

function getServiceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!);
}

export default async function JoinPage({ params }: PageProps) {
  const { token } = await params;
  const supabase = getServiceClient();

  const { data: invite } = await supabase
    .from('invites')
    .select('email, plan_grant, expires_at, used_at')
    .eq('token', token)
    .maybeSingle();

  const now = new Date();

  if (!invite) {
    return <InvalidInvite reason="This invite link doesn't exist." />;
  }
  if (invite.used_at) {
    return <InvalidInvite reason="This invite has already been used." />;
  }
  if (new Date(invite.expires_at) < now) {
    return <InvalidInvite reason="This invite link has expired." />;
  }

  return <InviteClaimClient token={token} email={invite.email} planGrant={invite.plan_grant} />;
}

function InvalidInvite({ reason }: { reason: string }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#f5f0e8',
        fontFamily: 'var(--font-mono)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <div style={{ maxWidth: '400px', textAlign: 'center', padding: '48px' }}>
        <p style={{ fontFamily: 'var(--font-serif)', fontSize: '1.5rem', color: '#0e0e0e', marginBottom: '12px' }}>
          Invalid invite
        </p>
        <p style={{ fontSize: '0.85rem', color: '#6b6b5e', marginBottom: '32px' }}>{reason}</p>
        <a
          href="/"
          style={{
            fontSize: '0.78rem',
            color: '#0e0e0e',
            textDecoration: 'none',
            borderBottom: '1px solid currentColor',
          }}>
          ← Back to waitlist
        </a>
      </div>
    </div>
  );
}
