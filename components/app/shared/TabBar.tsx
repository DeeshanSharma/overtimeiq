"use client";

import { usePathname, useRouter } from "next/navigation";
import { useSessionStore } from "@/stores/useSessionStore";

const TABS = [
  { href: "/log", label: "Log", icon: "≡" },
  { href: "/dashboard", label: "Dashboard", icon: "▦" },
  { href: "/settings", label: "Settings", icon: "⚙" },
] as const;

export default function TabBar() {
  const router = useRouter();
  const pathname = usePathname();
  const { activeSession } = useSessionStore();

  return (
    <nav style={{
      display: "flex",
      borderTop: "1px solid #d1c9b8",
      background: "#f5f0e8",
      position: "sticky",
      bottom: 0,
      zIndex: 10,
    }}>
      {TABS.map(tab => {
        const isActive = pathname.startsWith(tab.href);
        return (
          <button
            key={tab.href}
            onClick={() => router.push(tab.href)}
            style={{
              flex: 1,
              padding: "12px 8px",
              background: "none",
              border: "none",
              borderTop: isActive ? "2px solid #0e0e0e" : "2px solid transparent",
              fontFamily: "var(--font-mono)",
              fontSize: "0.7rem",
              color: isActive ? "#0e0e0e" : "#6b6b5e",
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "3px",
              position: "relative",
              letterSpacing: "0.04em",
            }}
          >
            <span style={{ fontSize: "1rem", lineHeight: 1 }}>{tab.icon}</span>
            {tab.label}
            {/* Active session indicator dot on Log tab */}
            {tab.href === "/log" && activeSession && (
              <span style={{
                position: "absolute",
                top: "8px",
                right: "calc(50% - 16px)",
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background: "#16a34a",
              }} />
            )}
          </button>
        );
      })}
    </nav>
  );
}
