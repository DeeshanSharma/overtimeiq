/**
 * app/admin/page.tsx
 *
 * Server component — checks admin auth before rendering anything.
 * If not admin: shows a plain 403 page (no info leaked).
 * If admin: renders the full client-side admin dashboard.
 */

import { requireAdmin } from "@/lib/adminAuth";
import AdminDashboard from "./AdminDashboard";

export default async function AdminPage() {
  const { ok, email } = await requireAdmin();

  if (!ok) {
    return (
      <div style={{ minHeight: "100vh", background: "#f5f0e8", fontFamily: "var(--font-mono)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <p style={{ fontFamily: "var(--font-serif)", fontSize: "2rem", color: "#0e0e0e", marginBottom: "8px" }}>403</p>
          <p style={{ fontSize: "0.82rem", color: "#6b6b5e" }}>You don&apos;t have access to this page.</p>
          <a href="/" style={{ display: "inline-block", marginTop: "24px", fontSize: "0.75rem", color: "#6b6b5e", textDecoration: "none", borderBottom: "1px solid #d1c9b8" }}>← Go home</a>
        </div>
      </div>
    );
  }

  return <AdminDashboard adminEmail={email!} />;
}
