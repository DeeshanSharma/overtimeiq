export default function WaitlistPage() {
  return (
    <div style={{
      minHeight: "100vh",
      background: "#f5f0e8",
      fontFamily: "var(--font-mono)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}>
      <div style={{ maxWidth: "440px", padding: "48px", textAlign: "center" }}>
        <p style={{ fontSize: "0.7rem", letterSpacing: "0.1em", color: "#d97706", textTransform: "uppercase", marginBottom: "16px" }}>
          You&apos;re on the list
        </p>
        <p style={{ fontFamily: "var(--font-serif)", fontSize: "2rem", color: "#0e0e0e", marginBottom: "16px", lineHeight: 1.15 }}>
          We&apos;ll be in touch<br />when your invite is ready.
        </p>
        <p style={{ fontSize: "0.83rem", color: "#6b6b5e", lineHeight: 1.7, marginBottom: "40px" }}>
          OvertimeIQ is invite-only during the beta. We&apos;re onboarding users
          gradually to make sure the experience is solid before opening up.
        </p>
        <div style={{ padding: "20px", border: "1px solid #d1c9b8", marginBottom: "32px" }}>
          <p style={{ fontSize: "0.78rem", color: "#6b6b5e", margin: 0, lineHeight: 1.7 }}>
            While you wait: we&apos;re writing about how this was built —
            SQLite in the browser, PKCE without a backend, atomic Drive uploads.
            The interesting engineering decisions beneath a simple-seeming product.
          </p>
        </div>
        <a href="/" style={{ fontSize: "0.78rem", color: "#0e0e0e", textDecoration: "none", borderBottom: "1px solid currentColor" }}>
          ← Back to homepage
        </a>
      </div>
    </div>
  );
}
