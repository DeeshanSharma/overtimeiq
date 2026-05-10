'use client';

/**
 * app/auth/processing/page.tsx
 *
 * Bridge page between Google's OAuth redirect and our server route handler.
 *
 * Flow:
 *  1. Google redirects to /auth/callback?code=...
 *  2. Route handler sees no verifier → redirects here with the code preserved
 *  3. This client page reads verifier from sessionStorage (set before Google redirect)
 *  4. Redirects to /auth/callback?code=...&verifier=... for server-side exchange
 */

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';

function ProcessingInner() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const code = searchParams.get('code');
    const error = searchParams.get('error');
    const state = searchParams.get('state');

    if (error) {
      window.location.href = `/login?error=${encodeURIComponent(error)}`;
      return;
    }
    if (!code) {
      window.location.href = '/login?error=missing_code';
      return;
    }

    const verifier = sessionStorage.getItem('pkce_verifier');
    if (!verifier) {
      window.location.href = '/login?error=missing_verifier';
      return;
    }

    // Read referral source that was stored before the Google redirect
    const refSource = sessionStorage.getItem('ref_source') ?? 'landing';
    const refCode = sessionStorage.getItem('ref_code') ?? null;

    // Clear both — one-time use
    sessionStorage.removeItem('pkce_verifier');
    sessionStorage.removeItem('ref_source');
    sessionStorage.removeItem('ref_code');

    // Send code + verifier + source + state to the server route
    const params = new URLSearchParams({
      code,
      verifier,
      ref_source: refSource,
      ...(refCode ? { ref_code: refCode } : {}),
      ...(state ? { state } : {}),
    });
    window.location.href = `/auth/callback?${params.toString()}`;
  }, [searchParams]);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#f5f0e8',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-mono)',
      }}>
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            width: '28px',
            height: '28px',
            border: '2px solid #d1c9b8',
            borderTopColor: '#0e0e0e',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
            margin: '0 auto 16px',
          }}
        />
        <p style={{ fontSize: '0.78rem', color: '#6b6b5e' }}>Signing you in…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}

export default function ProcessingPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            minHeight: '100vh',
            background: '#f5f0e8',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: '#6b6b5e' }}>Loading…</p>
        </div>
      }>
      <ProcessingInner />
    </Suspense>
  );
}
