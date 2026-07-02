# ServiceOS — Deployment & Test Checklist

**Status:** Planning/checklist only — no application code. Covers deployment
readiness, authentication, access control, and live testing for the Phone Input
backend built in Phases Phone-0 → Phone-3. **Phase Phone-4 (transcription) is
paused** and out of scope here.

**Last updated:** 2026-07-02

> This document contains **no secrets** — only variable/secret *names*. Fill
> actual values in Vercel / Supabase, never in the repo. Related docs:
> [PHONE_INPUT_SIMWOOD_SPEC.md](PHONE_INPUT_SIMWOOD_SPEC.md), [README.md](../README.md),
> [CLAUDE.md](../CLAUDE.md).

---

## 1. Current repo / branch model

| Branch | Role | Owner | Notes |
| --- | --- | --- | --- |
| `main` | Lovable UX branch | Lovable ↔ GitHub two-way sync | Visual/UI source of truth. **Never rewrite pushed history** (no force-push/rebase/amend/squash). |
| `serviceos-backend-foundation` | Claude engineering branch | Local (Claude Code) | Backend foundation, migrations, Edge Functions, specs. Preserves the Lovable UI exactly. |

**Merge direction:** backend branch → `main` via reviewed PR (after Codex
review, §10). Production deploys only from `main` after merge (§2).

**Backend delivered so far (all on `serviceos-backend-foundation`, unmerged):**
- Migrations: `20260701120000_phone_input_foundation.sql`, `20260701130000_phone_recordings_storage.sql`
- Edge Functions: `simwood-test-connection`, `simwood-sync-calls`, `simwood-sync-recordings`, `simwood-download-recording` (+ `_shared/simwood.ts`)
- Frontend helpers in `src/lib/api.ts` (typed, **not wired to UI**)

---

## 2. Live hosting plan (Vercel)

**Recommended:** Vercel for the app; Supabase for DB/auth/storage/functions.

1. **Import the GitHub repo** into Vercel (Vercel → Add New → Project → import the repo).
2. **Framework preset:** the app is TanStack Start (SSR) built via
   `@lovable.dev/vite-tanstack-config`.
   - ⚠️ **Known gap:** the Vite/Nitro output currently defaults to a **Cloudflare**
     target (see README note). Before the first Vercel deploy, confirm/switch the
     Nitro deploy preset to Vercel (or set `NITRO_PRESET=vercel`). Treat this as a
     pre-deploy engineering task — validate a build locally first.
3. **Preview deployments:** enable for `serviceos-backend-foundation` so every
   push gets a throwaway preview URL for testing before merge.
4. **Production deployment:** set Production Branch = `main`. Production builds
   **only** from `main`, after the backend branch is merged via PR.
5. **Build command / output:** use the framework preset defaults; do not add a
   custom build that diverges from the Lovable config.

**Deploy gate:** do not promote to production until the testing sequence (§7)
passes on a preview deployment wired to a real Supabase project.

---

## 3. Required Vercel environment variables

Set in Vercel → Project → Settings → Environment Variables. **Public client
values only** — anything `VITE_`-prefixed is bundled into the browser.

| Variable | Scope | Notes |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Production + Preview | Public Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Production + Preview | Public anon/publishable key (safe to expose) |

**Do NOT** put `SUPABASE_SERVICE_ROLE_KEY`, `SIMWOOD_USERNAME`, or
`SIMWOOD_PASSWORD` in Vercel — those are Supabase Edge Function secrets (§5) and
must never reach the frontend or the client bundle.

Consider separate values for Preview vs Production (e.g. a staging Supabase
project for previews) so test syncs never touch production data.

---

## 4. Supabase project setup

1. **Create the project** (choose region appropriate for UK data — see spec §12
   compliance). Record the project ref.
2. **Enable Email/Password auth:** Auth → Providers → Email = on. **Disable public
   sign-ups** (invite-only, §8/§9) — Auth → keep "Allow new users to sign up" off,
   or gate via invite flow.
3. **Configure URLs:** Auth → URL Configuration:
   - **Site URL:** the production app URL (from `main`/Vercel).
   - **Redirect URLs:** add the production URL and Vercel preview URL pattern(s)
     so magic-link/confirmation redirects resolve on previews too.
4. **Apply migrations:** link the project and push:
   ```bash
   supabase link --project-ref <ref>
   supabase db push
   ```
   Confirms `phone_*` + `audit_logs` tables exist with RLS **enabled**.
5. **Private `phone-recordings` bucket:** the storage migration creates it
   idempotently. If your environment blocks `insert into storage.buckets`, create
   it manually (Dashboard → Storage → New bucket → `phone-recordings`, **Public =
   off**) — the migration then no-ops. **Never** make it public.

---

## 5. Supabase secrets (Edge Functions)

Set with `supabase secrets set` (or Dashboard → Edge Functions → Secrets).
Server-side only; never `VITE_`-prefixed; never in the repo/docs.

| Secret | Provided by | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | Auto-injected by platform | Available to functions at runtime |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected by platform | Bypasses RLS — functions use it to read/write `phone_*`, `audit_logs`, storage |
| `SIMWOOD_USERNAME` | You (manual) | Simwood/Sipcentric portal username (Basic Auth) |
| `SIMWOOD_PASSWORD` | You (manual) | Simwood/Sipcentric portal password (Basic Auth) |

```bash
supabase secrets set SIMWOOD_USERNAME=<value> SIMWOOD_PASSWORD=<value>
```

> `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are normally injected
> automatically for deployed functions. For **local** `functions serve`, supply
> them via a git-ignored `supabase/functions/.env.local`.

---

## 6. Function deployment checklist

Deploy each function; verify it appears in Dashboard → Edge Functions.

- [ ] `supabase functions deploy simwood-test-connection`
- [ ] `supabase functions deploy simwood-sync-calls`
- [ ] `supabase functions deploy simwood-sync-recordings`
- [ ] `supabase functions deploy simwood-download-recording`

Post-deploy checks:
- [ ] All four functions read the same `_shared/simwood.ts` (deployed with each).
- [ ] Secrets from §5 are set **before** first invocation.
- [ ] **JWT verification:** decide per-function `verify_jwt`. Default Supabase
      behaviour requires a valid JWT (the anon key qualifies). Until app auth +
      tenant authorization exist (§8), treat these functions as **privileged/admin
      only** — do not expose invocation to untrusted clients, since they currently
      trust the caller-supplied `tenant_id`.

---

## 7. Testing sequence

Run in order on a preview deployment + real (staging) Supabase project. Record a
known `tenant_id` UUID to use throughout.

1. **Auth** — create an invited test user (Dashboard → Auth → Add user); confirm
   email/password login issues a session. Confirm public signup is blocked.
2. **Database migration** — verify tables exist and RLS is on:
   - [ ] `phone_accounts`, `phone_endpoints`, `phone_calls`, `phone_recordings`,
         `phone_transcripts`, `phone_ai_insights`, `phone_sync_runs`, `audit_logs`.
   - [ ] Each `phone_*`/`audit_logs` table shows RLS enabled.
3. **Simwood credentials** — invoke `simwood-test-connection` with the test
   `tenant_id`; expect `ok: true` + `customerCount ≥ 1`. On failure, check codes
   (`auth_failed`, `config_error`, `rate_limited`, `network_error`).
4. **Call sync (last 24h)** — invoke `simwood-sync-calls` with just `tenant_id`
   (defaults to 24h). Expect `success: true`, `records_processed ≥ 0`, a
   `sync_run_id`.
5. **Recording metadata sync** — invoke `simwood-sync-recordings` (24h default).
   Expect `success: true` and, in the sync run metadata, `linked_calls_matched`.
6. **One recording download** — pick a `phone_recordings.id`; invoke
   `simwood-download-recording`. Expect `already_downloaded: false` then a
   `storage_path`. Re-invoke → `already_downloaded: true` (idempotency check);
   `force: true` → re-downloads.
7. **Verify DB rows** — rows present in `phone_calls` / `phone_recordings`; a
   re-run of steps 4–5 does **not** duplicate (upsert idempotency).
8. **Verify storage object** — the WAV exists at
   `{tenant_id}/simwood/recordings/{provider_recording_id}.wav` in the private
   bucket; **no** public URL exists.
9. **Verify audit logs** — `phone_sync_runs` has one row per attempt with correct
   `sync_type`/`status`/`records_processed`; `audit_logs` has matching
   success/failure entries.

Exit criteria: all nine pass with no duplicate rows and no public exposure.

---

## 8. Auth / access-control implementation plan

> Design only — implementation is a later, separate task (likely partly on the
> Lovable branch for the login UI, partly here for RLS/policies).

- **Login page** — email/password sign-in against Supabase Auth. No public
  signup; invite-only.
- **Protected `/app` route** — gate the product surface behind an authenticated
  session; unauthenticated users are redirected to login. (UI wiring happens on
  the Lovable branch to preserve the design.)
- **`profiles` table** — one row per `auth.users` id, holding `tenant_id`, `role`,
  and display fields. A `tenants` table should be introduced so `tenant_id`
  becomes a real FK (today it's a bare uuid on the `phone_*` tables).
- **Roles** — `owner`, `admin`, `ops`, `viewer`. Suggested capabilities:
  | Role | Capability |
  | --- | --- |
  | `owner` | Full access incl. billing/tenant settings, manage users |
  | `admin` | Manage integrations/secrets config, trigger syncs |
  | `ops` | Trigger syncs, view calls/recordings, act on insights |
  | `viewer` | Read-only dashboards |
- **`tenant_id` assignment** — set on the profile at invite time; every query and
  Edge Function derives tenant from the authenticated user, **not** from
  client-supplied input (see security note below).
- **RLS policy plan** — tables are RLS-enabled but currently have **no policies**
  (deny-by-default; only service-role bypasses). Add per-table policies:
  - `select`/`insert`/`update` restricted to rows where `tenant_id` matches the
    caller's profile `tenant_id` (via a helper like `auth.uid()` → profile lookup).
  - Storage: a policy allowing tenant-scoped read of `phone-recordings` objects,
    then serve audio via **signed URLs** only.
- **Edge Function authorization** — set `verify_jwt` and, inside each function,
  resolve `tenant_id` from the verified JWT/profile instead of trusting the
  request body. **This is the key hardening step**: today the functions accept a
  caller-supplied `tenant_id`, which is fine for admin/testing but must be locked
  to the authenticated tenant before any untrusted exposure.
- **Invite-only access** — owner/admin invites users (Supabase invite or a custom
  invite table); no self-service registration.

---

## 9. Do-not-do-yet list

- ❌ No public signup (invite-only).
- ❌ No transcription (Phase-4 paused).
- ❌ No AI enrichment (Phase-5+).
- ❌ No public recording URLs — private bucket + signed URLs only, later.
- ❌ No customer-facing portal.
- ❌ Do not wire Simwood helpers into UI until auth + tenant-scoped authorization exist.
- ❌ Do not deploy to production from the backend branch — merge to `main` first.

---

## 10. Codex review plan

Before merging `serviceos-backend-foundation` → `main`, ask Codex (or an
independent reviewer) to audit the following. Provide the diff and this doc.

**Security review**
- Confirm no secrets in the repo, client bundle, or docs; only `VITE_*` values
  are client-exposed.
- Confirm Simwood credentials are read server-side only and never returned in any
  response (check all four functions' payloads).
- Review the SSRF guard in `_shared/simwood.ts` (`resolveSimwoodUrl` host-lock)
  for bypasses.
- Confirm no public storage URLs are created.

**Supabase / RLS review**
- Verify RLS is enabled on every `phone_*` and `audit_logs` table.
- Assess the deny-by-default posture and the §8 policy plan; flag any table that
  would leak cross-tenant data once anon/authenticated policies are added.
- Confirm the private bucket cannot be read anonymously.

**Edge Function review**
- Input validation and error classification (`auth_failed`, `rate_limited`,
  `network_error`, `upstream_error`, `parse_error`, `db_error`, storage errors).
- Idempotency of upserts (`onConflict` targets) and download short-circuit.
- The **client-supplied `tenant_id`** trust issue (§8) — confirm the plan to bind
  it to the authenticated tenant.
- Pagination safety bounds (`HARD_PAGE_CAP`) and rate-limit handling.

**Deployment review**
- Vercel Nitro preset vs the Cloudflare default (§2) — confirm the correct target.
- Env var / secret placement (§3, §5) — nothing privileged on the frontend.
- Preview-vs-production data isolation (separate Supabase projects).
- Migration order applies cleanly on a fresh project.
