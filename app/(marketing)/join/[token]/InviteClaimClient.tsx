"use client";

import { generateVerifier, generateChallenge, buildAuthURL } from "@/lib/auth";

interface Props {
  token: string;
  email: string;
  planGrant: string;
}

const PLAN_LABELS: Record<string, string> = {
  beta_free: "Beta · Free Pro access",
  founding: "Founding member · ₹99/mo locked for life",
  standard: "Pro access included",
};

export default function InviteClaimClient({ token, email, planGrant }: Props) {
  async function handleSignIn() {
    const verifier = generateVerifier();
    const challenge = await generateChallenge(verifier);
    const authUrl = buildAuthURL({ challenge, loginHint: email });

    // Store verifier in sessionStorage — survives the Google redirect back to /auth/callback.
    // The callback route reads it from there instead of a cookie.
    sessionStorage.setItem("pkce_verifier", verifier);

    window.location.href = authUrl;
  }

  const planLabel = PLAN_LABELS[planGrant] ?? "Access included";

  return (
    <div style={{ minHeight: "100vh", background: "#f5f0e8", fontFamily: "var(--font-mono)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ maxWidth: "440px", width: "100%", padding: "48px" }}>

        <p style={{ fontFamily: "var(--font-serif)", fontSize: "2rem", color: "#0e0e0e", marginBottom: "8px", lineHeight: 1.1 }}>
          You&apos;re invited.
        </p>
        <p style={{ fontSize: "0.83rem", color: "#6b6b5e", marginBottom: "40px", lineHeight: 1.6 }}>
          Your invite was sent to <strong style={{ color: "#0e0e0e" }}>{email}</strong>.
          Sign in with Google to claim your account.
        </p>

        <div style={{ padding: "12px 16px", border: "1px solid #d97706", background: "#fffbeb", marginBottom: "32px" }}>
          <p style={{ fontSize: "0.7rem", letterSpacing: "0.08em", color: "#d97706", textTransform: "uppercase", margin: 0 }}>Your plan</p>
          <p style={{ fontSize: "0.85rem", color: "#78350f", margin: "3px 0 0", fontWeight: 500 }}>{planLabel}</p>
        </div>

        <button
          onClick={handleSignIn}
          style={{ width: "100%", padding: "14px 24px", background: "#0e0e0e", color: "#f5f0e8", border: "none", fontFamily: "var(--font-mono)", fontSize: "0.85rem", fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "12px" }}
        >
          <GoogleIcon />
          Continue with Google
        </button>

        <p style={{ fontSize: "0.72rem", color: "#6b6b5e", marginTop: "20px", lineHeight: 1.6 }}>
          Your work data lives only on your Google Drive — we can&apos;t access it.
        </p>

        <div style={{ borderTop: "1px solid #d1c9b8", marginTop: "32px", paddingTop: "24px" }}>
          <a href="/" style={{ fontSize: "0.72rem", color: "#6b6b5e", textDecoration: "none", borderBottom: "1px solid currentColor" }}>← Back to homepage</a>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}
