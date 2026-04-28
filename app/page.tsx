"use client";

import { useState, useEffect } from "react";
import { captureReferral, getReferralSource, getReferralCode, clearReferral } from "@/lib/referral";

// ─── Waitlist Form ─────────────────────────────────────────────────────────────

function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "exists" | "error">("idle");

  async function handleSubmit() {
    if (!email.includes("@")) return;
    setStatus("loading");

    const source = getReferralSource();
    const referralCode = getReferralCode();

    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source, referral_code: referralCode }),
      });

      if (res.ok) {
        clearReferral(); // one-time use
        setStatus("success");
      } else if (res.status === 409) {
        setStatus("exists");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div style={{ border: "1px solid #d97706", padding: "18px 24px", background: "#fffbeb" }}>
        <p style={{ fontFamily: "var(--font-serif)", color: "#78350f", margin: 0 }}>You&apos;re on the list.</p>
        <p style={{ fontSize: "0.78rem", color: "#6b6b5e", margin: "4px 0 0" }}>
          We&apos;ll send an invite when your spot is ready.
        </p>
      </div>
    );
  }

  if (status === "exists") {
    return (
      <p style={{ fontSize: "0.78rem", color: "#6b6b5e" }}>
        Already on the list — we&apos;ll be in touch.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", maxWidth: "480px" }}>
      <input
        type="email"
        placeholder="your@email.com"
        value={email}
        onChange={e => setEmail(e.target.value)}
        onKeyDown={e => e.key === "Enter" && handleSubmit()}
        disabled={status === "loading"}
        style={{
          flex: 1, padding: "13px 16px", border: "1px solid #0e0e0e",
          borderRight: "none", fontFamily: "var(--font-mono)", fontSize: "0.85rem",
          background: "white", outline: "none", color: "#0e0e0e",
        }}
      />
      <button
        onClick={handleSubmit}
        disabled={status === "loading" || !email}
        style={{
          padding: "13px 22px", background: "#0e0e0e", color: "#f5f0e8",
          border: "1px solid #0e0e0e", fontFamily: "var(--font-mono)",
          fontSize: "0.82rem", fontWeight: 500, cursor: "pointer",
          opacity: status === "loading" ? 0.6 : 1,
        }}
      >
        {status === "loading" ? "..." : "Request access →"}
      </button>
    </div>
  );
}

// ─── Features ──────────────────────────────────────────────────────────────────

const FEATURES = [
  { label: "Runs in your browser", body: "SQLite via WebAssembly. No server receives your work data. Ever." },
  { label: "Your Drive, your file", body: "One overtimeiq.db on your Google Drive. You own it. We can't see it." },
  { label: "Offline-first", body: "Log, view, and calculate earnings with zero network. Sync when you're back." },
  { label: "Midnight-crossing logic", body: "Night shifts split correctly across two calendar days — holiday and weekend rates auto-applied per segment." },
  { label: "Multi-job support", body: "Separate rates, multipliers, and shift hours per employer. One dashboard across all." },
  { label: "Excel import", body: "Bring historical logs in from any spreadsheet. Preview conflicts before a single row touches the DB." },
];

const s = {
  muted: { color: "#6b6b5e" },
  rule: "1px solid #d1c9b8",
  amber: "#d97706",
} as const;

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  // Capture ?ref param on every load — stores to localStorage if not already set
  useEffect(() => {
    captureReferral();
  }, []);

  return (
    <div style={{ minHeight: "100vh", fontFamily: "var(--font-mono)", background: "#f5f0e8", color: "#0e0e0e" }}>

      {/* Nav */}
      <nav style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 48px", borderBottom: s.rule }}>
        <span style={{ fontFamily: "var(--font-serif)", fontSize: "1.1rem", letterSpacing: "-0.02em" }}>OvertimeIQ</span>
        <div style={{ display: "flex", gap: "28px", fontSize: "0.78rem", ...s.muted }}>
          <a href="#features" style={{ color: "inherit", textDecoration: "none" }}>Features</a>
          <a href="#pricing" style={{ color: "inherit", textDecoration: "none" }}>Pricing</a>
          <a href="/login" style={{ color: "inherit", textDecoration: "none" }}>Sign in</a>
        </div>
      </nav>

      {/* Hero */}
      <section style={{ padding: "88px 48px 72px", maxWidth: "960px" }}>
        <p style={{ fontSize: "0.7rem", letterSpacing: "0.12em", color: s.amber, textTransform: "uppercase", marginBottom: "20px" }}>
          Invite-only beta · now open
        </p>
        <h1 style={{ fontFamily: "var(--font-serif)", fontSize: "clamp(2.6rem,5.5vw,4.8rem)", lineHeight: 1.05, letterSpacing: "-0.03em", marginBottom: "28px", maxWidth: "820px" }}>
          Every extra hour you work<br />
          <em style={{ color: s.amber }}>has a number attached to it.</em>
        </h1>
        <p style={{ fontSize: "0.95rem", lineHeight: 1.75, ...s.muted, maxWidth: "500px", marginBottom: "44px" }}>
          OvertimeIQ tracks your overtime, calculates earnings with correct holiday
          and midnight-crossing rates, and stores everything in a SQLite file on your
          own Google Drive — no backend, no data custody.
        </p>
        <WaitlistForm />
        <p style={{ fontSize: "0.72rem", ...s.muted, marginTop: "14px" }}>
          Free forever · Pro from ₹149/mo · Founding rate ₹99/mo (30-day window)
        </p>
      </section>

      <div style={{ borderTop: s.rule, margin: "0 48px" }} />

      {/* Architecture strip */}
      <section style={{ padding: "56px 48px", display: "flex", gap: "48px", alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "0 0 auto" }}>
          <p style={{ fontSize: "0.68rem", letterSpacing: "0.1em", ...s.muted, textTransform: "uppercase", marginBottom: "8px" }}>Architecture</p>
          <p style={{ fontFamily: "var(--font-serif)", fontSize: "1.5rem", lineHeight: 1.2, maxWidth: "240px" }}>
            One sentence,<br />no asterisks.
          </p>
        </div>
        <div style={{ flex: 1, minWidth: "280px" }}>
          <p style={{ fontSize: "0.83rem", lineHeight: 1.8, ...s.muted, borderLeft: `2px solid ${s.amber}`, paddingLeft: "20px" }}>
            Next.js + sql.js (SQLite WASM) + Google OAuth PKCE + Drive API v3, deployed
            as a static site with a Service Worker for offline support. One Vercel Edge
            Function mints pro tokens. That&apos;s the entire backend.
          </p>
          <div style={{ display: "flex", gap: "10px", marginTop: "20px", flexWrap: "wrap" }}>
            {["Next.js 16", "sql.js WASM", "Supabase", "Google Drive", "Zustand", "Recharts"].map(t => (
              <span key={t} style={{ fontSize: "0.7rem", padding: "3px 9px", border: s.rule, ...s.muted }}>{t}</span>
            ))}
          </div>
        </div>
      </section>

      <div style={{ borderTop: s.rule, margin: "0 48px" }} />

      {/* Features */}
      <section id="features" style={{ padding: "72px 48px" }}>
        <p style={{ fontSize: "0.68rem", letterSpacing: "0.1em", ...s.muted, textTransform: "uppercase", marginBottom: "40px" }}>What it does</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(270px,1fr))", border: s.rule }}>
          {FEATURES.map((f, i) => (
            <div key={i} style={{ padding: "28px", borderRight: s.rule, borderBottom: s.rule }}>
              <p style={{ fontSize: "0.8rem", fontWeight: 500, marginBottom: "7px" }}>{f.label}</p>
              <p style={{ fontSize: "0.78rem", lineHeight: 1.65, ...s.muted, margin: 0 }}>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <div style={{ borderTop: s.rule, margin: "0 48px" }} />

      {/* Pricing */}
      <section id="pricing" style={{ padding: "72px 48px" }}>
        <p style={{ fontSize: "0.68rem", letterSpacing: "0.1em", ...s.muted, textTransform: "uppercase", marginBottom: "40px" }}>Pricing</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: "1px", background: "#d1c9b8" }}>
          {[
            {
              plan: "Personal", price: "₹0", period: "forever", note: "No credit card.", highlight: false,
              features: ["Unlimited log entries", "Google Drive sync", "3 months visibility", "1 job profile", "Offline support"],
              cta: "Request access",
            },
            {
              plan: "Pro", price: "₹149", period: "/ month", note: "₹999/year — save 44%", highlight: false,
              features: ["Full history", "5 job profiles", "Excel import & export", "PDF reports", "Project tagging"],
              cta: "Request access",
            },
            {
              plan: "Founding", price: "₹99", period: "/ month", note: "Locked for life · 30-day window", highlight: true,
              features: ["Everything in Pro", "Price never increases", "First to new features", "Direct line to the builder"],
              cta: "Claim founding rate",
            },
          ].map(tier => (
            <div key={tier.plan} style={{ padding: "36px 28px", background: tier.highlight ? "#0e0e0e" : "#f5f0e8", color: tier.highlight ? "#f5f0e8" : "#0e0e0e" }}>
              <p style={{ fontSize: "0.68rem", letterSpacing: "0.1em", textTransform: "uppercase", opacity: 0.5, marginBottom: "10px" }}>{tier.plan}</p>
              <p style={{ fontFamily: "var(--font-serif)", fontSize: "2.2rem", lineHeight: 1, marginBottom: "2px" }}>{tier.price}</p>
              <p style={{ fontSize: "0.78rem", opacity: 0.55, marginBottom: "4px" }}>{tier.period}</p>
              <p style={{ fontSize: "0.72rem", color: tier.highlight ? "#fbbf24" : s.amber, marginBottom: "24px" }}>{tier.note}</p>
              <ul style={{ listStyle: "none", padding: 0, margin: "0 0 28px", display: "flex", flexDirection: "column", gap: "8px" }}>
                {tier.features.map(f => (
                  <li key={f} style={{ fontSize: "0.78rem", opacity: 0.85, paddingLeft: "14px", position: "relative" }}>
                    <span style={{ position: "absolute", left: 0, color: tier.highlight ? "#fbbf24" : s.amber }}>›</span>
                    {f}
                  </li>
                ))}
              </ul>
              <a href="#waitlist" style={{ display: "inline-block", padding: "10px 18px", border: `1px solid ${tier.highlight ? "#f5f0e8" : "#0e0e0e"}`, fontSize: "0.75rem", color: "inherit", textDecoration: "none" }}>
                {tier.cta} →
              </a>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom CTA */}
      <section id="waitlist" style={{ padding: "72px 48px", borderTop: s.rule, display: "flex", gap: "48px", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <p style={{ fontFamily: "var(--font-serif)", fontSize: "1.7rem", marginBottom: "6px", lineHeight: 1.2 }}>Know what your overtime is worth.</p>
          <p style={{ fontSize: "0.83rem", ...s.muted }}>Invite-only during beta. Join the list.</p>
        </div>
        <WaitlistForm />
      </section>

      <footer style={{ padding: "20px 48px", borderTop: s.rule, display: "flex", justifyContent: "space-between", fontSize: "0.72rem", ...s.muted }}>
        <span>OvertimeIQ · {new Date().getFullYear()}</span>
        <span>Your data lives on your Drive. Always.</span>
      </footer>
    </div>
  );
}
