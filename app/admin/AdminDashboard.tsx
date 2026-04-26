"use client";

import { useState, useEffect, useCallback } from "react";

interface WaitlistEntry {
  id: string;
  email: string;
  name: string | null;
  source: string;
  created_at: string;
  converted_at: string | null;
  invite: {
    plan_grant: string;
    used_at: string | null;
    expires_at: string;
    created_at: string;
  } | null;
  user: {
    status: string;
    is_lifetime_free: boolean;
  } | null;
}

interface Invite {
  id: string;
  email: string;
  token: string;
  plan_grant: string;
  invited_by: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

const PLAN_LABELS: Record<string, string> = {
  beta_free: "Beta Free",
  founding: "Founding (₹99)",
  standard: "Pro Standard",
};

const PLAN_COLORS: Record<string, string> = {
  beta_free: "#16a34a",
  founding: "#d97706",
  standard: "#3B8BD4",
};

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

export default function AdminDashboard({ adminEmail }: { adminEmail: string }) {
  const [tab, setTab] = useState<"waitlist" | "invites" | "create">("waitlist");
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; type: "ok" | "err" } | null>(null);

  // Create invite form state
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePlan, setInvitePlan] = useState("standard");
  const [inviteDays, setInviteDays] = useState("7");
  const [creating, setCreating] = useState(false);
  const [lastLink, setLastLink] = useState<string | null>(null);

  const showToast = (msg: string, type: "ok" | "err" = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const loadWaitlist = useCallback(async () => {
    const res = await fetch("/api/admin/waitlist", { credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      setWaitlist(data.waitlist ?? []);
    }
  }, []);

  const loadInvites = useCallback(async () => {
    const res = await fetch("/api/admin/invite", { credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      setInvites(data.invites ?? []);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadWaitlist(), loadInvites()]).finally(() =>
      setLoading(false)
    );
  }, [loadWaitlist, loadInvites]);

  async function createInvite(email: string, plan: string, days: string) {
    setCreating(true);
    setLastLink(null);
    try {
      const res = await fetch("/api/admin/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email,
          plan_grant: plan,
          expires_in_days: parseInt(days) || 7,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Failed to create invite", "err");
      } else {
        setLastLink(data.invite_link);
        showToast(
          data.existing
            ? "Existing invite returned (already active)"
            : "Invite created",
          "ok"
        );
        await Promise.all([loadWaitlist(), loadInvites()]);
        if (!data.existing) setInviteEmail("");
      }
    } catch {
      showToast("Network error", "err");
    }
    setCreating(false);
  }

  async function revokeInvite(id: string, email: string) {
    if (!confirm(`Revoke invite for ${email}?`)) return;
    await fetch("/api/admin/invite", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ id }),
    });
    showToast("Invite revoked");
    await loadInvites();
  }

  async function removeFromWaitlist(email: string) {
    if (!confirm(`Remove ${email} from waitlist?`)) return;
    await fetch("/api/admin/waitlist", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email }),
    });
    showToast("Removed from waitlist");
    await loadWaitlist();
  }

  function copyLink(link: string) {
    navigator.clipboard.writeText(link);
    showToast("Copied to clipboard");
  }

  const isExpired = (dt: string) => new Date(dt) < new Date();

  // Waitlist stats
  const pending = waitlist.filter((w) => !w.invite && !w.user).length;
  const invited = waitlist.filter((w) => w.invite && !w.invite.used_at).length;
  const joined = waitlist.filter((w) => w.user).length;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f5f0e8",
        fontFamily: "var(--font-mono)",
        color: "#0e0e0e",
      }}
    >
      {/* Toast */}
      {toast && (
        <div
          style={{
            position: "fixed",
            top: "16px",
            right: "16px",
            padding: "10px 18px",
            background: toast.type === "ok" ? "#0e0e0e" : "#dc2626",
            color: "white",
            fontSize: "0.78rem",
            zIndex: 200,
          }}
        >
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <header
        style={{
          padding: "16px 32px",
          borderBottom: "1px solid #d1c9b8",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <span
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "1rem",
              letterSpacing: "-0.02em",
            }}
          >
            OvertimeIQ
          </span>
          <span
            style={{
              marginLeft: "10px",
              fontSize: "0.65rem",
              padding: "2px 7px",
              background: "#0e0e0e",
              color: "#f5f0e8",
              letterSpacing: "0.08em",
            }}
          >
            ADMIN
          </span>
        </div>
        <span style={{ fontSize: "0.72rem", color: "#6b6b5e" }}>{adminEmail}</span>
      </header>

      <div style={{ maxWidth: "900px", margin: "0 auto", padding: "28px 32px" }}>

        {/* Stats strip */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr 1fr",
            gap: "1px",
            background: "#d1c9b8",
            marginBottom: "28px",
          }}
        >
          {[
            { label: "Waitlist", value: waitlist.length },
            { label: "Pending", value: pending },
            { label: "Invited", value: invited },
            { label: "Joined", value: joined },
          ].map((s) => (
            <div key={s.label} style={{ padding: "16px 20px", background: "#f5f0e8" }}>
              <p
                style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: "1.8rem",
                  margin: "0 0 4px",
                  letterSpacing: "-0.02em",
                }}
              >
                {s.value}
              </p>
              <p
                style={{
                  fontSize: "0.65rem",
                  color: "#6b6b5e",
                  margin: 0,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                {s.label}
              </p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div
          style={{
            display: "flex",
            borderBottom: "1px solid #d1c9b8",
            marginBottom: "24px",
          }}
        >
          {(
            [
              { key: "waitlist", label: `Waitlist (${waitlist.length})` },
              { key: "invites", label: `Invites (${invites.length})` },
              { key: "create", label: "+ Create invite" },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                padding: "9px 18px",
                fontFamily: "var(--font-mono)",
                fontSize: "0.75rem",
                border: "none",
                borderBottom: tab === t.key ? "2px solid #0e0e0e" : "2px solid transparent",
                background: "none",
                color: tab === t.key ? "#0e0e0e" : "#6b6b5e",
                cursor: "pointer",
                marginBottom: "-1px",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <p style={{ fontSize: "0.78rem", color: "#6b6b5e" }}>Loading…</p>
        ) : (
          <>
            {/* ── Waitlist tab ─────────────────────────── */}
            {tab === "waitlist" && (
              <div>
                {waitlist.length === 0 ? (
                  <p style={{ fontSize: "0.82rem", color: "#6b6b5e" }}>
                    No waitlist entries yet.
                  </p>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid #d1c9b8" }}>
                        {["Email", "Source", "Signed up", "Status", "Actions"].map((h) => (
                          <th
                            key={h}
                            style={{
                              padding: "8px 12px 10px",
                              textAlign: "left",
                              fontSize: "0.65rem",
                              letterSpacing: "0.08em",
                              color: "#6b6b5e",
                              textTransform: "uppercase",
                              fontWeight: 500,
                            }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {waitlist.map((w) => {
                        const status = w.user
                          ? w.user.status
                          : w.invite
                          ? isExpired(w.invite.expires_at)
                            ? "expired"
                            : w.invite.used_at
                            ? "used"
                            : "invited"
                          : "pending";

                        const statusColor: Record<string, string> = {
                          pending: "#6b6b5e",
                          invited: "#d97706",
                          used: "#6b6b5e",
                          expired: "#dc2626",
                          beta: "#16a34a",
                          active: "#16a34a",
                          waitlist: "#6b6b5e",
                        };

                        return (
                          <tr
                            key={w.id}
                            style={{ borderBottom: "1px solid #d1c9b8" }}
                          >
                            <td style={{ padding: "12px" }}>
                              <span style={{ fontWeight: 500 }}>{w.email}</span>
                              {w.name && (
                                <span style={{ marginLeft: "6px", color: "#6b6b5e", fontSize: "0.72rem" }}>
                                  ({w.name})
                                </span>
                              )}
                            </td>
                            <td style={{ padding: "12px", color: "#6b6b5e" }}>{w.source}</td>
                            <td style={{ padding: "12px", color: "#6b6b5e" }}>
                              {new Date(w.created_at).toLocaleDateString()}
                            </td>
                            <td style={{ padding: "12px" }}>
                              <span
                                style={{
                                  color: statusColor[status] ?? "#6b6b5e",
                                  fontSize: "0.7rem",
                                  textTransform: "uppercase",
                                  letterSpacing: "0.06em",
                                }}
                              >
                                {status}
                              </span>
                              {w.invite && (
                                <span
                                  style={{
                                    marginLeft: "6px",
                                    fontSize: "0.65rem",
                                    color: PLAN_COLORS[w.invite.plan_grant] ?? "#6b6b5e",
                                  }}
                                >
                                  {PLAN_LABELS[w.invite.plan_grant]}
                                </span>
                              )}
                            </td>
                            <td style={{ padding: "12px" }}>
                              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                                {/* Invite button — only for pending/expired */}
                                {(!w.invite || isExpired(w.invite.expires_at)) && !w.user && (
                                  <div style={{ display: "flex", gap: "4px" }}>
                                    <select
                                      defaultValue="standard"
                                      id={`plan-${w.id}`}
                                      style={{ fontSize: "0.7rem", padding: "3px 6px", border: "1px solid #d1c9b8", background: "white", fontFamily: "var(--font-mono)" }}
                                    >
                                      <option value="standard">Standard</option>
                                      <option value="founding">Founding</option>
                                      <option value="beta_free">Beta Free</option>
                                    </select>
                                    <button
                                      onClick={() => {
                                        const sel = document.getElementById(`plan-${w.id}`) as HTMLSelectElement;
                                        createInvite(w.email, sel.value, "7");
                                      }}
                                      style={actionBtn}
                                    >
                                      Send invite
                                    </button>
                                  </div>
                                )}

                                {/* Copy link if invite is active */}
                                {w.invite && !isExpired(w.invite.expires_at) && !w.invite.used_at && (
                                  <button
                                    onClick={() =>
                                      copyLink(`${appUrl}/join/${invites.find((i) => i.email === w.email)?.token ?? ""}`)
                                    }
                                    style={actionBtn}
                                  >
                                    Copy link
                                  </button>
                                )}

                                <button
                                  onClick={() => removeFromWaitlist(w.email)}
                                  style={{ ...actionBtn, color: "#dc2626", borderColor: "#dc262640" }}
                                >
                                  Remove
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* ── Invites tab ──────────────────────────── */}
            {tab === "invites" && (
              <div>
                {invites.length === 0 ? (
                  <p style={{ fontSize: "0.82rem", color: "#6b6b5e" }}>No invites yet.</p>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid #d1c9b8" }}>
                        {["Email", "Plan", "Created", "Expires", "Used", "Actions"].map((h) => (
                          <th
                            key={h}
                            style={{
                              padding: "8px 12px 10px",
                              textAlign: "left",
                              fontSize: "0.65rem",
                              letterSpacing: "0.08em",
                              color: "#6b6b5e",
                              textTransform: "uppercase",
                              fontWeight: 500,
                            }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {invites.map((inv) => {
                        const expired = isExpired(inv.expires_at);
                        const used = !!inv.used_at;
                        const active = !expired && !used;

                        return (
                          <tr
                            key={inv.id}
                            style={{
                              borderBottom: "1px solid #d1c9b8",
                              opacity: !active ? 0.55 : 1,
                            }}
                          >
                            <td style={{ padding: "12px", fontWeight: 500 }}>{inv.email}</td>
                            <td style={{ padding: "12px" }}>
                              <span style={{ color: PLAN_COLORS[inv.plan_grant] ?? "#6b6b5e", fontSize: "0.72rem" }}>
                                {PLAN_LABELS[inv.plan_grant] ?? inv.plan_grant}
                              </span>
                            </td>
                            <td style={{ padding: "12px", color: "#6b6b5e" }}>
                              {new Date(inv.created_at).toLocaleDateString()}
                            </td>
                            <td style={{ padding: "12px" }}>
                              <span style={{ color: expired ? "#dc2626" : "#6b6b5e", fontSize: "0.72rem" }}>
                                {expired ? "Expired" : new Date(inv.expires_at).toLocaleDateString()}
                              </span>
                            </td>
                            <td style={{ padding: "12px" }}>
                              <span style={{ color: used ? "#16a34a" : "#6b6b5e", fontSize: "0.72rem" }}>
                                {used ? new Date(inv.used_at!).toLocaleDateString() : "—"}
                              </span>
                            </td>
                            <td style={{ padding: "12px" }}>
                              <div style={{ display: "flex", gap: "6px" }}>
                                {active && (
                                  <>
                                    <button
                                      onClick={() => copyLink(`${appUrl}/join/${inv.token}`)}
                                      style={actionBtn}
                                    >
                                      Copy link
                                    </button>
                                    <button
                                      onClick={() => revokeInvite(inv.id, inv.email)}
                                      style={{ ...actionBtn, color: "#dc2626", borderColor: "#dc262640" }}
                                    >
                                      Revoke
                                    </button>
                                  </>
                                )}
                                {expired && !used && (
                                  <button
                                    onClick={() => createInvite(inv.email, inv.plan_grant, "7")}
                                    style={actionBtn}
                                  >
                                    Resend
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* ── Create invite tab ────────────────────── */}
            {tab === "create" && (
              <div style={{ maxWidth: "440px" }}>
                <p style={{ fontSize: "0.78rem", color: "#6b6b5e", marginBottom: "24px", lineHeight: 1.7 }}>
                  Create an invite for any email address. The link is valid for the
                  specified number of days and can only be used once.
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  <div>
                    <p style={fieldLabel}>Email address</p>
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && createInvite(inviteEmail, invitePlan, inviteDays)}
                      placeholder="user@example.com"
                      style={inputStyle}
                    />
                  </div>

                  <div>
                    <p style={fieldLabel}>Plan grant</p>
                    <select
                      value={invitePlan}
                      onChange={(e) => setInvitePlan(e.target.value)}
                      style={inputStyle}
                    >
                      <option value="standard">Standard Pro</option>
                      <option value="founding">Founding (₹99/mo locked)</option>
                      <option value="beta_free">Beta Free (lifetime)</option>
                    </select>
                    <p style={{ fontSize: "0.68rem", color: "#6b6b5e", marginTop: "5px" }}>
                      {invitePlan === "standard" && "Access to Pro for 30 days, then billing kicks in."}
                      {invitePlan === "founding" && "₹99/month locked for life — the founding member rate."}
                      {invitePlan === "beta_free" && "Free Pro access permanently. Use for beta testers."}
                    </p>
                  </div>

                  <div>
                    <p style={fieldLabel}>Link expires in (days)</p>
                    <input
                      type="number"
                      value={inviteDays}
                      onChange={(e) => setInviteDays(e.target.value)}
                      min="1"
                      max="30"
                      style={{ ...inputStyle, width: "80px" }}
                    />
                  </div>

                  <button
                    onClick={() => createInvite(inviteEmail, invitePlan, inviteDays)}
                    disabled={creating || !inviteEmail}
                    style={{
                      padding: "12px 24px",
                      background: creating || !inviteEmail ? "#6b6b5e" : "#0e0e0e",
                      color: "#f5f0e8",
                      border: "none",
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.82rem",
                      cursor: creating || !inviteEmail ? "not-allowed" : "pointer",
                      alignSelf: "flex-start",
                    }}
                  >
                    {creating ? "Creating…" : "Create invite →"}
                  </button>
                </div>

                {/* Invite link result */}
                {lastLink && (
                  <div
                    style={{
                      marginTop: "28px",
                      padding: "16px 20px",
                      border: "1px solid #16a34a",
                      background: "#f0fdf4",
                    }}
                  >
                    <p style={{ fontSize: "0.68rem", letterSpacing: "0.08em", color: "#16a34a", textTransform: "uppercase", margin: "0 0 8px" }}>
                      Invite link ready
                    </p>
                    <p
                      style={{
                        fontSize: "0.72rem",
                        color: "#0e0e0e",
                        wordBreak: "break-all",
                        margin: "0 0 12px",
                        background: "white",
                        padding: "8px 10px",
                        border: "1px solid #d1c9b8",
                      }}
                    >
                      {lastLink}
                    </p>
                    <button
                      onClick={() => copyLink(lastLink)}
                      style={{
                        padding: "7px 14px",
                        background: "#0e0e0e",
                        color: "#f5f0e8",
                        border: "none",
                        fontFamily: "var(--font-mono)",
                        fontSize: "0.75rem",
                        cursor: "pointer",
                      }}
                    >
                      Copy link
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const actionBtn: React.CSSProperties = {
  padding: "4px 10px",
  border: "1px solid #d1c9b8",
  background: "none",
  fontFamily: "var(--font-mono)",
  fontSize: "0.7rem",
  cursor: "pointer",
  color: "#0e0e0e",
  whiteSpace: "nowrap",
};

const fieldLabel: React.CSSProperties = {
  fontSize: "0.65rem",
  letterSpacing: "0.08em",
  color: "#6b6b5e",
  textTransform: "uppercase",
  margin: "0 0 6px",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #d1c9b8",
  fontFamily: "var(--font-mono)",
  fontSize: "0.82rem",
  background: "white",
  color: "#0e0e0e",
  outline: "none",
  boxSizing: "border-box",
};
