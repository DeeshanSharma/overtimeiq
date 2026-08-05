# OvertimeIQ — Task List

Read `AGENTS.md` fully before starting any task.
Tasks are ordered by priority within each phase. Pick the next unchecked task and complete it fully before moving on.

---

## Phase 2 — Dashboard Charts

All charts go in `app/(app)/dashboard/page.tsx` alongside the existing KPI strip and 7-day bar chart.
Use Recharts. Import from `"recharts"`. Wrap every chart in `ResponsiveContainer width="100%" height={240}`.
Earnings data comes from running `calcEntryEarning()` from `lib/earnings.ts` on each log row — do not store earnings in SQLite.

- [x] **Cumulative earnings line chart**
  - Recharts `LineChart` with a single `Line` for running total earnings over time
  - X-axis: date labels (abbreviated). Y-axis: currency symbol from settings
  - Green `#16a34a` stroke, light green `#f0fdf4` area fill using `linearGradient`
  - Respects timeframe filter and job filter already wired in the page
  - Shows "No data" empty state if zero logs in range

- [x] **Location donut chart**
  - Recharts `PieChart` with `innerRadius={60}` (donut style)
  - Three segments: office / home / client
  - Colors: office `#0e0e0e`, home `#3B8BD4`, client `#d97706`
  - Centre label: total hours. Legend below with hour counts

- [x] **Shift-type donut chart**
  - Same structure as location donut
  - Three segments: weekday / weekend / holiday (derived from `getMultiplier()` per log entry)
  - Colors: weekday `#6b6b5e`, weekend `#3B8BD4`, holiday `#d97706`

- [x] **Burnout gauge**
  - Half-donut (180 degree arc). Value = total hours this week vs `settings.burnout_threshold_hours`
  - Color: green `#16a34a` when below 70% of threshold, amber `#d97706` at 70-99%, red `#dc2626` at 100%+
  - Centre text: `Xh / Yh` where Y is the threshold
  - "This week" is always the current ISO week regardless of the timeframe tab
  - Build with Recharts `PieChart` using `startAngle={180}` `endAngle={0}`

- [x] **Earnings by rate tier stacked bar chart**
  - Recharts `BarChart` stacked
  - Three segments per bar: base earnings / weekend premium / holiday premium
  - Premium = (multiplier - 1.0) x hours x hourly_rate for that segment
  - Colors: base `#0e0e0e`, weekend `#3B8BD4`, holiday `#d97706`
  - X-axis: week or month buckets depending on timeframe
  - Only render if at least one session has a non-1.0 multiplier

---

## Phase 3 — Power Features

### Excel Export

- [ ] **Excel export**
  - Located in Settings DataSection (currently a stub button)
  - Flow: `fetchExportToken()` from `lib/gating.ts` → if 403 show lock → verify token signature → query logs → SheetJS write
  - Columns: Date, Start, End, Duration (h), Location, Job, Project, Notes, Status, Earnings (calculated)
  - Filename: `overtimeiq-export-YYYY-MM-DD.xlsx`
  - Gate: `FEATURES.excelExport(plan)` from `lib/gating.ts`

- [ ] **Excel import — conflict resolver**
  - Currently overlapping entries are marked as errors and skipped
  - Add the four-option resolver for overlaps (not exact duplicates — those stay silently skipped):
    - Skip / Replace / Import anyway / Edit & merge (inline time editor, auto-recalculate duration + crosses_midnight)

### PDF Export

- [ ] **PDF export**
  - Flow mirrors Excel export (fetchExportToken → verify → generate)
  - Use `jsPDF` + `jspdf-autotable`
  - Summary stats section at top, then full log table
  - Columns: Date, Time, Duration, Location, Job, Status, Earnings
  - Filename: `overtimeiq-report-YYYY-MM-DD.pdf`

### Submission Status Workflow

- [ ] **Status filter in log list**
  - Filter pill row in `app/(app)/log/page.tsx`: All / Draft / Submitted / Approved
  - SQL: `WHERE status = ?` when not "All"
  - Gate: locked on free tier with lock icon

- [ ] **Bulk status update**
  - Checkbox selection on log rows
  - "Mark as submitted" action button when rows selected
  - Uses `execSQL` (user data — debounce is correct here)

### Project Tagging

- [ ] **Project filter in log list**
  - Dropdown showing `SELECT DISTINCT project FROM logs WHERE project IS NOT NULL`
  - Gate: `FEATURES.projectTagging(plan)`

- [ ] **Project breakdown on dashboard**
  - Hours per project as horizontal bar list
  - Only render if any logs have a non-null project tag

### Push Notifications

- [ ] **Punch-out reminders**
  - Request `Notification` permission when user punches in (not on app load)
  - Schedule reminders at 1h, 3h, 5h using `setTimeout` in `useSessionStore`
  - Fallback to in-app toast via `useUIStore.addToast` if permission denied
  - Auto-timeout at 6h already implemented — do not touch

---

## Phase 4 — PWA + Polish

- [ ] **PWA manifest** — wire existing `public/manifest.json` in `app/layout.tsx`, add real icon files

- [ ] **Service Worker (Workbox)**
  - `CacheFirst` for `/sql-wasm/sql-wasm.wasm` — never changes
  - `NetworkFirst` for API routes
  - `StaleWhileRevalidate` for static assets
  - Offline fallback page at `app/offline/page.tsx`

- [ ] **Offline sync queue**
  - On network failure in `uploadToDrive()`: set `hasPendingUpload: true`
  - `window.addEventListener("online", ...)` → flush queue via `syncNow()`
  - Show "Offline — changes will sync when reconnected" banner

- [ ] **Install prompt**
  - `beforeinstallprompt` event listener in app layout
  - After 3rd session (count in localStorage): show "Add to Home Screen" banner

- [ ] **Dark mode**
  - `darkMode: 'class'` in `tailwind.config.ts`
  - Toggle in Settings writes `dark` class to `document.documentElement`
  - Persist in `settings` table: add `theme TEXT DEFAULT 'light'` column (schema migration needed)
  - CSS variables in `globals.css`:
    `.dark { --ink: #f5f0e8; --paper: #0e0e0e; --rule: #2a2a2a; --muted: #9ca3af; }`

- [ ] **Keyboard shortcuts**
  - Global `keydown` listener in app layout
  - `P` = punch in/out, `N` = new manual entry, `/` = focus log search
  - `?` modal showing all shortcuts, accessible from TopBar

- [ ] **Accessibility audit**
  - Visible focus rings on all interactive elements
  - `aria-label` on all icon-only buttons
  - Focus trapping in modals
  - WCAG 2.1 AA contrast check (amber on paper may need darkening)

---

## Ongoing / Maintenance

- [ ] **Holiday seed for 2026**
  - `lib/db.ts` only has 2025. Add `CENTRAL_HOLIDAYS_2026` array.
  - Update `buildHolidaySeedSQL()` to handle both years

- [ ] **Email sending for invites**
  - `app/api/admin/invite/route.ts` logs the invite link but does not send email
  - Integrate Resend (`npm install resend`) — simple REST API, generous free tier
  - Send from a `noreply@yourdomain.com` address
  - Template: plain text with invite link, expiry date, and what plan they're getting

- [ ] **Upgrade flow for free users**
  - "Upgrade to Pro" link in the free-tier banner currently goes to `/settings` which has no upgrade UI
  - Build a `/upgrade` page or modal with pricing table and Cashfree checkout link
  - Cashfree Subscriptions checkout URL format documented in their dashboard

- [ ] **Log list search**
  - Text search on `notes` and `project` fields
  - SQL: `WHERE (notes LIKE ? OR project LIKE ?)` with `%term%`
  - Add a search input to the filter bar in `app/(app)/log/page.tsx`

- [ ] **Cashfree to Razorpay migration (at ~200 subscribers)**
  - Only `app/api/webhook/route.ts` needs updating for Razorpay webhook format
  - Event names: `subscription.charged` and `subscription.cancelled`
  - No other files need changing

- [ ] **Annual key rotation (every 6 months)**
  - `node scripts/generate-keys.js k2` — new keypair
  - Add k2 public key to `lib/publicKeys.ts` alongside k1
  - Set `JWT_SIGNING_KID=k2` + new private key in env, deploy
  - Wait 3 days (all online Pro users refresh to k2 tokens)
  - Remove k1 from `lib/publicKeys.ts`, deploy again

---

## Known issues / tech debt

- [ ] **`lib/publicKeys.ts` has placeholder coordinates** — `x` and `y` say `"REPLACE_WITH_ACTUAL_X_COORDINATE"`. Run `node scripts/generate-keys.js` and paste output before any production deploy. Without real keys, pro token verification always fails with `unknown_kid`.

- [ ] **No email sending for invites** — invite link is returned in the API response for manual copy-paste. See maintenance task above.

- [ ] **Log list has no search** — `LogFilters` component referenced in spec was never built. Only date-range and job filters exist currently.

- [ ] **`useSessionStore` `startTick` has `set: unknown` type** — simplified to avoid a complex Zustand generic error. No runtime impact. Low priority.

- [ ] **Dashboard free-tier upgrade link goes to `/settings`** — no Cashfree checkout wired yet. Placeholder until billing is live.

- [ ] **`app/(marketing)/join/[token]/page.tsx`** — calls `getSupabaseServiceClient()` at build time. Needs a graceful fallback if Supabase env vars are missing in preview deployments.
