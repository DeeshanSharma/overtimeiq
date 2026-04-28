"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function InviteExpiredInner() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";

  return (
    <div style={{
      minHeight: "100vh",
      background: "#f5f0e8",
      fontFamily: "var(--font-mono)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px",
    }}>
      <div style={{ maxWidth: "440px", width: "100%" }}>

        {/* Status badge */}
        <div style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "8px",
          padding: "4px 10px",
          border: "1px solid #dc2626",
          marginBottom: "28px",
        }}>
          <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#dc2626", display: "inline-block" }} />
          <span style={{ fontSize: "0.68rem", letterSpacing: "0.08em", color: "#dc2626", textTransform: "uppercase" }}>
            Invite expired
          </span>
        </div>

        <p style={{
          fontFamily: "var(--font-serif)",
          fontSize: "1.8rem",
          color: "#0e0e0e",
          marginBottom: "16px",
          lineHeight: 1.15,
          letterSpacing: "-0.02em",
        }}>
          Your invite link has expired.
        </p>

        <p style={{ fontSize: "0.85rem", color: "#6b6b5e", lineHeight: 1.75, marginBottom: "8px" }}>
          We found an invite for{" "}
          {email ? (
            <strong style={{ color: "#0e0e0e" }}>{email}</strong>
          ) : (
            "your email"
          )}
          , but it expired before you used it.
        </p>

        <p style={{ fontSize: "0.85rem", color: "#6b6b5e", lineHeight: 1.75, marginBottom: "32px" }}>
          Invite links are valid for 7 days. Your spot on the waitlist is still
          saved — you just need a fresh invite link to get in.
        </p>

        {/* What to do */}
        <div style={{
          padding: "20px",
          border: "1px solid #d1c9b8",
          marginBottom: "32px",
        }}>
          <p style={{
            fontSize: "0.68rem",
            letterSpacing: "0.1em",
            color: "#6b6b5e",
            textTransform: "uppercase",
            margin: "0 0 12px",
          }}>
            What to do
          </p>
          <ol style={{
            margin: 0,
            padding: "0 0 0 18px",
            fontSize: "0.82rem",
            color: "#0e0e0e",
            lineHeight: 1.9,
          }}>
            <li>Reply to the original invite email and ask for a new link.</li>
            <li>Or reach out directly — include your email address.</li>
            <li>A fresh invite will arrive within 24 hours.</li>
          </ol>
        </div>

        {/* Data safety note */}
        <div style={{
          padding: "14px 18px",
          background: "#fffbeb",
          border: "1px solid #d97706",
          marginBottom: "32px",
          fontSize: "0.78rem",
          color: "#78350f",
          lineHeight: 1.65,
        }}>
          <strong style={{ display: "block", marginBottom: "4px", color: "#92400e" }}>
            Your data is safe.
          </strong>
          No account has been created and nothing has been stored. Once you get a
          fresh invite and sign in, everything starts clean.
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          <a
            href="/login"
            style={{
              padding: "11px 20px",
              background: "#0e0e0e",
              color: "#f5f0e8",
              textDecoration: "none",
              fontSize: "0.78rem",
              fontFamily: "var(--font-mono)",
            }}
          >
            Try signing in again
          </a>
          <a
            href="/"
            style={{
              padding: "11px 20px",
              border: "1px solid #d1c9b8",
              color: "#6b6b5e",
              textDecoration: "none",
              fontSize: "0.78rem",
              fontFamily: "var(--font-mono)",
            }}
          >
            ← Back to homepage
          </a>
        </div>

      </div>
    </div>
  );
}

export default function InviteExpiredPage() {
  return (
    <Suspense fallback={
      <div style={{
        minHeight: "100vh",
        background: "#f5f0e8",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--font-mono)",
      }}>
        <p style={{ fontSize: "0.78rem", color: "#6b6b5e" }}>Loading…</p>
      </div>
    }>
      <InviteExpiredInner />
    </Suspense>
  );
}
