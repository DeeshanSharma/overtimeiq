"use client";

import { useState } from "react";
import { generateVerifier, generateChallenge, buildAuthURL } from "@/lib/auth";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    setLoading(true);
    setError(null);
    try {
      const verifier = generateVerifier();
      const challenge = await generateChallenge(verifier);
      const authUrl = buildAuthURL({ challenge });
      sessionStorage.setItem("pkce_verifier", verifier);
      window.location.href = authUrl;
    } catch {
      setError("Failed to start sign-in. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "#f5f0e8",
      fontFamily: "var(--font-mono)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px",
    }}>
      <div style={{ maxWidth: "400px", width: "100%" }}>

        {/* Wordmark */}
        <p style={{ fontFamily: "var(--font-serif)", fontSize: "1.4rem", color: "#0e0e0e", marginBottom: "48px", letterSpacing: "-0.02em" }}>
          OvertimeIQ
        </p>

        <p style={{ fontSize: "1rem", fontFamily: "var(--font-serif)", color: "#0e0e0e", marginBottom: "8px", lineHeight: 1.2 }}>
          Sign in to continue
        </p>
        <p style={{ fontSize: "0.8rem", color: "#6b6b5e", marginBottom: "36px", lineHeight: 1.6 }}>
          If you have an invite, sign in with the email it was sent to.
          First-time users without an invite will be added to the waitlist.
        </p>

        {error && (
          <div style={{ padding: "12px 16px", background: "#fef2f2", border: "1px solid #dc2626", marginBottom: "20px" }}>
            <p style={{ fontSize: "0.78rem", color: "#dc2626", margin: 0 }}>{error}</p>
          </div>
        )}

        <button
          onClick={handleSignIn}
          disabled={loading}
          style={{
            width: "100%",
            padding: "14px 24px",
            background: loading ? "#6b6b5e" : "#0e0e0e",
            color: "#f5f0e8",
            border: "none",
            fontFamily: "var(--font-mono)",
            fontSize: "0.85rem",
            fontWeight: 500,
            cursor: loading ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "12px",
            transition: "background 0.15s",
          }}
        >
          {loading ? (
            <>
              <span style={{ width: "14px", height: "14px", border: "2px solid #f5f0e8", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
              Redirecting to Google…
            </>
          ) : (
            <>
              <GoogleIcon />
              Continue with Google
            </>
          )}
        </button>

        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

        <div style={{ marginTop: "32px", paddingTop: "24px", borderTop: "1px solid #d1c9b8" }}>
          <a href="/" style={{ fontSize: "0.72rem", color: "#6b6b5e", textDecoration: "none", borderBottom: "1px solid #d1c9b8" }}>
            ← Back to homepage
          </a>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}
