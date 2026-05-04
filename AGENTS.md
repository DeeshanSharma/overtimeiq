Before any file creation task, scan `.agents/skills/` for a matching SKILL.md and read it first.

# OvertimeIQ — AI Agent Context

This file is the single source of truth for any AI agent working on this codebase.
Read it fully before touching any file. Do not infer architecture from file names alone.

---

## What this product is

A personal overtime tracking PWA. Work data lives in a SQLite file on the user's own
Google Drive (via sql.js WASM in the browser). Identity, invites, and subscriptions live
in Supabase. There is no traditional backend — only a few Next.js API routes for auth
token exchange, JWT minting, and billing webhooks.

---

## Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 16.2 (App Router, Turbopack) | Server components for auth-gated pages only |
| Styling | Tailwind CSS + inline styles | No CSS modules. Inline styles for component-specific, Tailwind for layout |
| Database (work data) | SQLite via sql.js (WASM) | Runs in browser. Serialised to localStorage + synced to Google Drive |
| Database (identity) | Supabase (Postgres) | Users, invites, waitlist, subscriptions only. Zero work data here |
| State | Zustand | 6 stores: useDBStore, useSyncStore, useProStore, useSettingsStore, useSessionStore, useUIStore |
| Auth | Google OAuth PKCE → Supabase signInWithIdToken | PKCE in browser, code exchange server-side |
| Drive sync | Google Drive API v3 | Single file: overtimeiq.db |
| Pro gating | ECDSA ES256 JWT | Server mints, client verifies via WebCrypto. Public key in bundle, never in SQLite |
| Charts | Recharts | Dashboard only |
| Excel I/O | SheetJS (xlsx) | Import and export |
| PDF | jsPDF + jspdf-autotable | Export only |
| Date | Day.js | Lightweight, immutable |
| Payments | Cashfree | UPI AutoPay, webhook → Supabase |

---

## Architecture rules — never break these

1. **Work data never touches Supabase.** Logs, jobs, holidays, earnings — SQLite on Drive only.
2. **`execSQL` vs `runSilent`** — critical distinction in `useDBStore`:
   - `execSQL` → writes SQLite + localStorage + **arms the 10s Drive debounce**. Use for user data (logs, jobs, settings the user controls).
   - `runSilent` → writes SQLite + localStorage **only, no debounce**. Use for sync metadata: `last_synced_at`, `drive_file_id`, `google_refresh_token`, `pro_token`. Using `execSQL` for these causes infinite PATCH loop.
3. **`GOOGLE_CLIENT_SECRET` is server-only.** No `NEXT_PUBLIC_` prefix. Any Google token refresh from client code must go through `/api/google-token` route, not call Google directly.
4. **Public key for JWT verification lives in `lib/publicKeys.ts`** (compiled into the JS bundle). Never store it in SQLite — an attacker could swap it and forge tokens.
5. **`/admin` route** is server-gated by `lib/adminAuth.ts` which checks session email against `ADMIN_EMAILS` env var. The client `AdminDashboard.tsx` only renders after the server confirms access.
6. **Drive upload guard**: `uploadInProgress` boolean in `useSyncStore` prevents concurrent uploads. Never remove this.

---

## Environment variables

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Google OAuth — Web application client type (not Desktop)
NEXT_PUBLIC_GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=          # server-only, no NEXT_PUBLIC_ prefix

# ECDSA JWT signing — generate with: node scripts/generate-keys.js
JWT_SIGNING_KID=k1
JWT_PRIVATE_KEY_JWK=           # full JWK object as JSON string

# Cashfree
CASHFREE_WEBHOOK_SECRET=

# App
NEXT_PUBLIC_APP_URL=           # e.g. http://localhost:3000
ADMIN_EMAILS=                  # comma-separated Google account emails for /admin access
```

---

## Authentication flow

```
User clicks "Continue with Google" on /login
  → generateVerifier() + generateChallenge() in browser
  → verifier saved to sessionStorage as "pkce_verifier"
  → ref_source saved to sessionStorage as "ref_source"
  → redirect to Google with code_challenge
  → Google redirects to /auth/callback?code=...
  → Server route: no verifier in query → redirect to /auth/processing
  → /auth/processing (client): reads verifier + ref_source from sessionStorage
  → redirects to /auth/callback?code=...&verifier=...&ref_source=...
  → Server route: exchangeCode() with GOOGLE_CLIENT_SECRET
  → supabase.auth.signInWithIdToken() with id_token
  → Three-branch invite check:
      valid invite   → grantAccess() → /log
      expired invite → /invite-expired?email=...
      no invite      → addToWaitlist() → /waitlist
  → refresh_token saved in g_rt_once HttpOnly cookie (60s TTL)
  → App layout reads cookie, saves to SQLite via saveGoogleRefreshToken() (runSilent)
  → syncOnLogin() fetches fresh access token via /api/google-token (server-side)
  → Drive sync runs
```

---

## Drive sync flow

```
App load → bootstrap() in (app)/layout.tsx:
  1. Verify Supabase session
  2. Check users.status — waitlist → /waitlist, else continue
  3. initDB() — loads sql.js WASM, restores from localStorage, runs schema migrations
  4. loadAll() — loads settings/jobs/holidays into Zustand
  5. Read google_refresh_token from g_rt_once cookie OR SQLite settings
  6. saveGoogleRefreshToken() via runSilent (no debounce)
  7. syncOnLogin(refreshToken) — fire-and-forget, doesn't block render
     → /api/google-token to get access token (server-side, has GOOGLE_CLIENT_SECRET)
     → Drive: search for overtimeiq.db
     → Compare modifiedTime vs last_synced_at
     → Drive newer → download + reinitDB()
     → Local newer → uploadUpdate()
     → Write last_synced_at via runSilent
  8. Wire debounce trigger (execSQL writes → syncNow after 10s)
  9. initPro() — verify cached JWT, fetch fresh from /api/pro-token if needed
  10. loadSession() — recover any interrupted punch-in

Manual sync: Settings page "Sync now" button → useSyncStore.syncNow()
Token refresh: /api/google-token route (POST, requires Supabase session cookie)
Auto-refresh: scheduleTokenRefresh() sets a 55-minute timer after every successful refresh
```

---

## Pro token system

```
Server (api/pro-token):
  → Verify Supabase session
  → Query subscriptions for active/grace status
  → Check users.is_lifetime_free (beta testers)
  → If Pro: sign ECDSA ES256 JWT with private key
    Payload: { sub: supabaseUserId, plan, iat, exp: +3 days, jti }
    Header:  { alg: "ES256", kid: "k1" }
  → Return { token }

Client (lib/token.ts → useProStore):
  → verifyProToken() — 7 checks via WebCrypto:
    1. Token present?
    2. Valid JWT structure?
    3. kid in PUBLIC_KEYS map?
    4. Cryptographic signature valid?
    5. Not expired?
    6. sub === currentSupabaseUserId?
    7. Valid plan value?
  → If all pass: set pro_plan in memory
  → All feature gate checks read from pro_plan — never from raw SQLite

Export gate: /api/export-token — 60s token, server checks Supabase directly
Key rotation: add new kid alongside old in publicKeys.ts, wait 3 days, remove old
```

---

## Referral source tracking

`lib/referral.ts` exports:
- `captureReferral()` — reads `?ref=` param, saves to `localStorage` (first-touch wins). Call in `useEffect` on landing page and login page.
- `getReferralSource()` — returns stored source or `"landing"`
- `getReferralCode()` — returns stored `?code=` param or null
- `clearReferral()` — clears localStorage. Call after form submit or Google sign-in click.

On Google sign-in: source saved to `sessionStorage` as `ref_source` before redirect.
Processing page reads it and forwards as query param to auth callback.
Auth callback saves it to Supabase `waitlist.source`.

Valid sources (matches Supabase CHECK constraint): `landing`, `linkedin`, `devto`, `producthunt`, `referral`

Share links: `https://yourapp.com?ref=linkedin`, `?ref=devto`, `?ref=producthunt`

---

## SQLite schema (what's in the browser DB)

Tables: `jobs`, `logs`, `holidays`, `active_session`, `settings`, `schema_version`

Key columns in `settings`: `google_refresh_token`, `pro_token`, `pro_plan`, `drive_file_id`, `last_synced_at`, `default_job_id`, `currency_symbol`, `burnout_threshold_hours`

Key columns in `logs`: `job_id`, `date` (YYYY-MM-DD), `start_time` (HH:MM), `end_time` (HH:MM), `crosses_midnight` (0|1), `duration_hours`, `location` (office|home|client), `project`, `notes`, `status` (draft|submitted|approved), `source` (manual|punch|import)

Schema migrations run in `useDBStore.initDB()` via `lib/db.ts`. Uses `CREATE TABLE IF NOT EXISTS` — idempotent. Default job seeded with `WHERE NOT EXISTS` guard (not INSERT OR IGNORE — no UNIQUE constraint on jobs table).

---

## Earnings calculation (lib/earnings.ts)

Two-segment midnight-crossing logic:
```
Standard:       earning = duration_hours × hourly_rate × multiplier(date)
Crosses midnight:
  segA = (24:00 - start_time) hours × multiplier(punch-in date)
  segB = end_time hours × multiplier(punch-in date + 1)
  total = segA + segB
```

Multiplier priority: holiday (is_active=1 in holidays table) > weekend (Sat/Sun) > 1.0

There is no `shift_type` field. Rates are always derived from calendar dates automatically.

---

## What is built (current state)

### Fully implemented
- Landing page with waitlist form + referral tracking
- `/login` — Google sign-in, referral capture
- `/auth/callback` + `/auth/processing` — full PKCE flow with three-branch invite logic
- `/waitlist` — holding page
- `/invite-expired` — expired invite error page with clear UX
- `/join/[token]` — invite claim page (server validates token)
- `/log` — punch in/out, manual entry modal, Excel import modal, log list with edit/delete
- `/dashboard` — job switcher, timeframe tabs, KPI strip, 7-day bar chart, location/status breakdown
- `/settings` — job add/edit/delete, set default, currency, burnout threshold, manual Drive sync button
- `/admin` — waitlist viewer, invite creator, invite list with revoke/resend
- All API routes: waitlist, invite, pro-token, export-token, google-token, subscription, webhook
- Admin API routes: admin/waitlist, admin/invite
- Drive sync — full on every app load, debounced on writes, manual trigger
- Google token refresh — server-side via /api/google-token
- Pro token gating — ECDSA JWT, 3-day offline window
- Referral source tracking — localStorage persistence, passed through auth flow

### Stubs (built but minimal — needs Phase 2+ work)
- Dashboard charts — only bar chart + breakdowns done. Recharts integration (line chart, donut charts, burnout gauge, earnings by tier) not yet built.
- PDF export — button exists in Settings, logic not implemented
- Excel export — button exists in Settings, logic not implemented
- Submission status workflow — field exists in DB and log entry modal, no filter UI
- Project tagging filter — field exists, no dashboard breakdown chart
- Browser push notifications — not implemented
- PWA manifest + Service Worker — not implemented
- Dark mode — not implemented
- Keyboard shortcuts — not implemented

---

## What to build next (priority order)

See `TODO.md` for the detailed task list.

**Phase 2 — Dashboard (charts):**
1. Cumulative earnings line chart (Recharts LineChart, green fill)
2. Location donut chart (Recharts PieChart)
3. Shift-type donut chart (weekday/weekend/holiday)
4. Burnout gauge (half-donut, green→amber→red based on burnout_threshold_hours)
5. Earnings by rate tier chart (stacked bar: base × weekend premium × holiday premium)

**Phase 3 — Power features:**
1. Excel export (SheetJS write, requires /api/export-token)
2. PDF export (jsPDF + autotable, requires /api/export-token)
3. Submission status filter in log list
4. Project tagging filter + dashboard breakdown
5. Browser push notifications for punch-out reminders

**Phase 4 — PWA + polish:**
1. PWA manifest + Service Worker (Workbox)
2. Offline sync queue
3. Dark mode (Tailwind dark: classes)
4. Keyboard shortcuts
5. Accessibility audit (WCAG 2.1 AA)

---

## Key file locations

```
lib/
  auth.ts          — PKCE flow helpers (generateVerifier, generateChallenge, buildAuthURL, exchangeCode)
  db.ts            — SQLite schema SQL + holiday seed data
  earnings.ts      — Two-segment earnings calculation engine
  gating.ts        — Feature gate helpers, reads from pro_plan
  token.ts         — verifyProToken(), syncProToken()
  publicKeys.ts    — ECDSA public keys (compiled into bundle, NEVER in SQLite)
  referral.ts      — captureReferral, getReferralSource, clearReferral
  adminAuth.ts     — requireAdmin() server helper
  supabase/
    client.ts      — Browser Supabase client singleton
    server.ts      — Server Supabase clients (anon + service role)

stores/
  useDBStore.ts    — sql.js instance, execSQL (with debounce), runSilent (no debounce), saveDB, initDB
  useSyncStore.ts  — Drive sync, token refresh via /api/google-token, uploadInProgress guard
  useProStore.ts   — JWT fetch/verify, isPro(), currentPlan()
  useSettingsStore.ts — Settings/jobs/holidays CRUD, saveProToken/saveGoogleRefreshToken use runSilent
  useSessionStore.ts  — Punch-in state, live timer, auto-timeout at 6h
  useUIStore.ts    — Tabs, modals, toast queue, import step

app/
  (app)/layout.tsx — Bootstrap sequence (auth check → initDB → sync → pro → session)
  (app)/log/       — LogPage, ManualEntryModal, PunchInModal, ExcelImportModal
  (app)/dashboard/ — DashboardPage (partial — see stubs above)
  (app)/settings/  — SettingsPage, JobEditModal
  admin/           — AdminPage (server), AdminDashboard (client)
  auth/callback/   — route.ts (server), no page.tsx here
  auth/processing/ — page.tsx (client bridge for sessionStorage → server)

scripts/
  generate-keys.js — Run once: node scripts/generate-keys.js
                     Output: private key JWK → JWT_PRIVATE_KEY_JWK env var
                             public key JWK → paste into lib/publicKeys.ts

supabase/
  schema.sql       — Full Postgres schema. Run in Supabase SQL editor.
```

---

## Supabase tables (identity layer)

- `users` — id (UUID, matches auth.users), email, google_id, status (waitlist|invited|beta|active), is_lifetime_free
- `waitlist` — email, name, source (landing|linkedin|devto|producthunt|referral), referral_code, converted_at
- `invites` — email, token (32 hex chars), invited_by, plan_grant (beta_free|founding|standard), expires_at, used_at
- `subscriptions` — user_id, plan (beta_free|founding_monthly|pro_monthly|pro_annual), status (active|cancelled|past_due|expired|grace), current_period_start, current_period_end, cancel_at_period_end

RLS: enabled on all tables. Users can only read their own rows. All writes via service role (server-side only).

---

## Pricing tiers

| Plan | Price | Gate |
|---|---|---|
| Personal (free) | ₹0 | Last 3 months visibility, 1 job, no import/export |
| Pro Monthly | ₹149/mo | Full history, 5 jobs, Excel import/export, PDF, project tagging |
| Pro Annual | ₹999/yr | Same as monthly |
| Founding | ₹99/mo locked | Same as Pro, price never increases |
| Beta Free | ₹0 forever | Same as Pro, for beta testers (is_lifetime_free=true) |

Free tier gate: `WHERE date >= date('now', '-3 months')` in SQL queries. Banner shows exact locked count.
Feature gates: Excel import/export, PDF export, project tagging, submission status, multiple jobs (>1).
Drive sync is never gated — free tier always syncs.

---

## Coding conventions in this codebase

- All client components that use browser APIs are marked `"use client"` at the top
- Inline styles use the CSS variables: `--font-serif` (DM Serif Display), `--font-mono` (DM Mono)
- Color palette: `#0e0e0e` (ink), `#f5f0e8` (paper), `#d1c9b8` (rule/border), `#6b6b5e` (muted), `#d97706` (amber)
- No CSS modules, no styled-components, no emotion
- Zustand stores: actions defined inline in `create()`, no separate action files
- SQLite types: booleans stored as `INTEGER` (0/1), dates as `TEXT` (ISO 8601 or YYYY-MM-DD), times as `TEXT` (HH:MM 24h)
- TypeScript: avoid `any` except for the sql.js Database type (WASM has no good types)
- Fetch calls from client to internal API routes always include `credentials: "include"`

---

## Common gotchas

1. **Do not call `execSQL` inside `useSyncStore`** — use `runSilent`. Breaks the Drive sync loop.
2. **`initDB()` is guarded** — has `if (get().isReady || get().isLoading) return` at the top. Don't try to re-init manually.
3. **`buildDefaultJobSQL()` takes no arguments** — changed from v1 which took `now: string`. Uses `WHERE NOT EXISTS` guard.
4. **Token refresh is server-side only** — `POST /api/google-token` with `{ refresh_token }` in body. Requires Supabase session cookie.
5. **The proxy file is named `proxy.ts` not `middleware.ts`** — Next.js 16 renamed it. Export is `proxy`, not `middleware`.
6. **Drive upload uses `buffer.buffer.slice(...)` not raw `Uint8Array`** — TypeScript's fetch overloads require `ArrayBuffer`.
7. **Auth callback has no `page.tsx`** — only `route.ts`. The client bridge is at `/auth/processing/page.tsx`.
8. **`saveProToken` and `saveGoogleRefreshToken`** in `useSettingsStore` use `runSilent` — do not change to `execSQL`.
9. **CORS headers in `next.config.ts`** — `Cross-Origin-Embedder-Policy: require-corp` is required for sql.js SharedArrayBuffer. Do not remove.
10. **`uploadInProgress` in `useSyncStore`** is a module-level variable (not Zustand state) — intentional, prevents React re-render cycles from resetting it.
