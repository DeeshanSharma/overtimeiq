-- OvertimeIQ Supabase Schema
-- Run this in your Supabase SQL editor to set up the identity/billing layer.
-- Work data (logs, jobs, earnings) lives in SQLite on the user's Drive — never here.

-- ============================================================
-- EXTENSIONS
-- ============================================================

create extension if not exists "pgcrypto";


-- ============================================================
-- USERS
-- ============================================================
-- One row per signed-up user. Created on first successful OAuth + invite claim.
-- Mirrors Supabase auth.users.

create table if not exists public.users (
  id              uuid        primary key default gen_random_uuid(),
  email           text        not null unique,
  google_id       text        not null unique,
  status          text        not null default 'waitlist'
                              check (status in ('waitlist', 'invited', 'beta', 'active')),
  is_lifetime_free boolean    default false,
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz default null
);

-- RLS: Users can only read their own row. Service role manages writes.
alter table public.users enable row level security;

create policy "Users can read own record"
  on public.users for select
  using (auth.uid() = id);

-- Admins (service role) bypass RLS — no policy needed for insert/update.


-- ============================================================
-- WAITLIST
-- ============================================================
-- Captures emails from the landing page before an invite is issued.

create table if not exists public.waitlist (
  id            uuid        primary key default gen_random_uuid(),
  email         text        not null unique,
  name          text        default null,
  -- Source tracks where the user came from.
  -- "landing"     = direct visit, no ref param
  -- "linkedin"    = ?ref=linkedin
  -- "devto"       = ?ref=devto or ?ref=dev.to
  -- "producthunt" = ?ref=producthunt or ?ref=ph
  -- "twitter"     = ?ref=twitter or ?ref=x
  -- "referral"    = personal referral link or unknown ?ref value
  source        text        not null default 'landing'
                check (source in ('landing', 'linkedin', 'devto', 'producthunt', 'twitter', 'referral')),
  referral_code text        default null,
  converted_at  timestamptz default null,
  created_at    timestamptz not null default now()
);

-- No RLS on waitlist — reads/writes always via service role (server-side only).
-- Public insert via /api/waitlist uses service role with email-only access.
alter table public.waitlist enable row level security;


-- ============================================================
-- INVITES
-- ============================================================
-- Each row is a unique invite link. Admin creates these to grant access.

create table if not exists public.invites (
  id          uuid        primary key default gen_random_uuid(),
  email       text        not null,
  token       text        not null unique,  -- 32 hex chars, used in /join/[token]
  invited_by  text        not null,         -- "admin" or inviter email
  plan_grant  text        not null default 'standard'
              check (plan_grant in ('beta_free', 'founding', 'standard')),
  expires_at  timestamptz not null,
  used_at     timestamptz default null,
  created_at  timestamptz not null default now()
);

alter table public.invites enable row level security;
-- No user-facing reads — always via service role server-side.


-- ============================================================
-- SUBSCRIPTIONS
-- ============================================================
-- One row per user. Source of truth for plan and billing status.
-- Updated by the Cashfree webhook.

create table if not exists public.subscriptions (
  id                      uuid        primary key default gen_random_uuid(),
  user_id                 uuid        not null references public.users(id) on delete cascade,
  plan                    text        not null
                          check (plan in ('beta_free', 'founding_monthly', 'pro_monthly', 'pro_annual')),
  status                  text        not null default 'active'
                          check (status in ('active', 'cancelled', 'past_due', 'expired', 'grace')),
  current_period_start    timestamptz not null,
  current_period_end      timestamptz not null,
  cancel_at_period_end    boolean     default false,
  cashfree_subscription_id text       default null,
  cashfree_customer_id    text        default null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

create policy "Users can read own subscription"
  on public.subscriptions for select
  using (auth.uid() = user_id);

-- Index for fast user → subscription lookup (called on every app load for pro-token)
create index if not exists idx_subscriptions_user_id on public.subscriptions(user_id);
create index if not exists idx_subscriptions_status  on public.subscriptions(status);


-- ============================================================
-- AUTO-UPDATED updated_at
-- ============================================================

create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger subscriptions_updated_at
  before update on public.subscriptions
  for each row execute procedure public.handle_updated_at();


-- ============================================================
-- SEED: Central Gazetted Holidays 2025
-- (Stored in SQLite on Drive — not here. This is just a reference comment.)
-- See lib/db.ts for the holiday seed data that goes into SQLite.
-- ============================================================

-- MIGRATION: run these if you already have the table from v1
-- alter table public.waitlist drop constraint if exists waitlist_source_check;
-- alter table public.waitlist add constraint waitlist_source_check check (source in ('landing', 'linkedin', 'devto', 'producthunt', 'referral'));
