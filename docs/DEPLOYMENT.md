# Deployment — how ServiceOS reaches production

> Authoritative description of the **live** deployment path. If anything else in the repo
> (including older notes in `CLAUDE.md` / `AGENTS.md`) implies Lovable deploys the site,
> this file wins.

## TL;DR

- **Frontend host: Vercel.** The live site is served by Vercel, not Lovable.
- **Lovable is legacy.** It was an early UX accelerator. It is **not** the active deploy
  path and must not be used to publish. Lovable-origin packages (e.g.
  `@lovable.dev/vite-tanstack-config`) are still load-bearing for the build — do **not**
  remove them just because they came from Lovable.
- **Backend is separate.** Supabase (project `tgbnakbxwcqjeimygroz`) is deployed
  independently via the Supabase CLI (migrations + edge functions). Frontend deploys
  never touch Supabase.

## The pipeline

```
Claude builds & verifies  →  git push  →  Vercel builds from Git  →  production
```

| Fact | Value |
|------|-------|
| Vercel team | **Allkin** |
| Vercel project | **serviceos-dh** (`prj_XEuCp5gnEireW5WynUgkRp9QNiXa`) |
| Linked Git repo | **github.com/Drummasterflash83/serviceos-dh** |
| **Production branch** | **`main`** |
| Production domain | **https://serviceos-dh.vercel.app** |
| Framework preset | TanStack Start (nitro) |
| Install / build command | `npm install` / `npm run build` |
| Public env (Production + Preview) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (marked *Sensitive*) |

### Build-target note

`npm run build` runs Vite + nitro. Nitro's **default preset is Cloudflare** (a local build
emits `wrangler.json`), but when Vercel runs the same command it **auto-detects `VERCEL=1`
and switches to the Vercel preset** (`λ __server`). So: build **remotely on Vercel** (source
upload or Git push). Do **not** ship a locally-prebuilt `.output` to Vercel — it would be
Cloudflare-flavoured.

## Preview deployments

### Isolated LEARN TEST project (10 October 2026)

**serviceos-learn-test** (`prj_KOScR3ShQmvxjrwLAJ68yTh93Pcs`, Allkin) is separate
from the production project above. Its preview-only public configuration targets
Supabase TEST `saatxzwxvdvqevbnskxy`. Vercel authentication protects its Vercel
hostnames, and no custom domain or automatic Git linkage was added.

The latest staging candidate is
[serviceos-learn-test-g7nlyfdcg-allkin.vercel.app](https://serviceos-learn-test-g7nlyfdcg-allkin.vercel.app),
built remotely from GitHub commit `1af32a493633b73f5f3fa127d4e47712b27e89fb`
and observed READY at **18:26 UTC on 11 October**. It includes the password-reset
flow, saved-snapshot freshness, projection/identity review and queued manual
processing messages, initially paired with TEST schema release 066 and worker v12.
The backend now has release **068**, worker **v14** and Workspace discovery **v3**.
Release 067 added directory-verified alias identities; 068 adds mailbox-wide recent
Gmail capture with a mandatory reconciliation when upgrading old label-limited
cursors. The protected frontend is unchanged. Neither release inferred real alias
bindings or activated capture. See the
[mailbox coverage evidence](operations/evidence/learn-email-mailbox-coverage-test-2026-10-11.json)
and [identity evidence](operations/evidence/learn-workspace-profile-identity-test-2026-10-11.json).
The exact TEST project, Git SHA, preview-only backend binding and Vercel protection
were verified. Homepage, login and LEARN routes remain protected. Browser approval
for this new origin and positive signed-in acceptance are pending.

TEST Auth now uses this preview's `/login?reset=1` as its default recovery target;
the previous exact TEST recovery URL remains allowlisted. No wildcard redirect,
user, grant, password, email or other Auth setting changed. The existing owner
login reactivation proposal remains unapproved. Do not claim an email-token journey
or authenticated acceptance from these configuration checks.
[Frontend release evidence](operations/evidence/learn-processing-frontend-test-2026-10-11.json).

The previous scheduler-health staging candidate is
[serviceos-learn-test-b5u66qgft-allkin.vercel.app](https://serviceos-learn-test-b5u66qgft-allkin.vercel.app),
built remotely from GitHub commit `aff42842d82ae228de3513a63cad73c2a91ff9a7`
and observed READY at 14:35 UTC on 11 October. It adds bounded scheduling checks
to OpenFolk and the legacy LEARN/Ops readers, paired with TEST release 060. Its
exact TEST project, Git SHA, backend environment and Vercel protection configuration
were verified through the management API. This release does not activate capture,
install the email schedulers or change production. Browser permission for the
updated origin is pending; positive signed-in hosted acceptance remains open.
[Release evidence](operations/evidence/learn-scheduler-health-test-2026-10-11.json).

The previous partial-job-time staging candidate is
[serviceos-learn-test-c7irm9j5p-allkin.vercel.app](https://serviceos-learn-test-c7irm9j5p-allkin.vercel.app),
built remotely from GitHub commit `a084b97a7a21f8377c04e054b893a18e69b3bfb9`
and observed READY at 13:20 UTC on 11 October. It exposes Commusoft job timing
limitations without withholding otherwise reviewable job identity/status.
TEST release 059 was installed at 13:16 UTC; the existing review function retains
its owner and execution grants, and all 113 monitored datasets matched. No real
Drummonds records were published. The frontend retains the prior call-detail
contract fix. Three HTTP routes remain Vercel protected. Browser inspection of
this new origin awaits explicit permission after automatic approval review
rejected opening it; no signed-in acceptance is claimed.
[Release evidence](operations/evidence/learn-commusoft-partial-times-test-2026-10-11.json).

The previous call-detail staging candidate is
[serviceos-learn-test-fpzgfbxtu-allkin.vercel.app](https://serviceos-learn-test-fpzgfbxtu-allkin.vercel.app),
built remotely from GitHub commit `a5f2329369b50194be4bcad59f29d31157d2717a`
and READY at 12:56 UTC on 11 October. It fixes exact transcript linkage and
unverified saved-analysis messaging in the older `/app#communications` detail.
TEST `phone-call-detail` v1 is ACTIVE, JWT verified and serves response contract
`phone-call-detail/2`; this endpoint must precede the matching frontend because
its client rejects unversioned responses. Source readback and eight handler cases
passed, three hosted access denials passed and all 113 retained datasets matched.
No database migration, credential, account, grant, schedule or production change.
The frontend's TEST binding, three protected routes, actual app login redirect
and zero browser errors pass. Positive signed-in detail/review acceptance remains
open. [Release evidence](operations/evidence/learn-call-detail-test-2026-10-11.json).

The previous saved-results staging candidate is
[serviceos-learn-test-ea944wgld-allkin.vercel.app](https://serviceos-learn-test-ea944wgld-allkin.vercel.app),
built remotely from GitHub commit `508dc13172f80fa565e52802105951e01a6687b5`
and READY at 12:32 UTC on 11 October. It adds paged saved transcripts and advisory
analysis to customer-card recordings, with source-matched/stale/unverified labels.
TEST schema release 058 installed at 12:30 UTC and preserved all 113 datasets.
TEST binding, three Vercel-protected routes, actual app login redirect and zero
browser errors pass. Positive signed-in reading remains open; the component was
verified locally with synthetic results, and its SQL passed full-schema hosted
rollback assertions. No provider requests or production changes.
[Release evidence](operations/evidence/learn-phone-saved-results-test-2026-10-11.json).

The previous playback candidate `serviceos-learn-test-qu7dogqm4-allkin.vercel.app`
from `0a8d7eab2eeede40d368a9e5b66508ddd954abeb` passed the approved isolated
signed-in card-to-generated-audio journey. Its synthetic login is now banned and
company membership removed. [Acceptance](operations/LEARN-PHONE-PLAYBACK-ACCEPTANCE.md).

The earlier operator candidate is
[serviceos-learn-test-c6le93r67-allkin.vercel.app](https://serviceos-learn-test-c6le93r67-allkin.vercel.app),
built remotely from GitHub commit `48999ca1c8439ab039375a0972befc2e5b787cfb`
and READY at 10:39 UTC on 11 October. It adds safe Phone attempt history and
audited saved-result recovery, paired with TEST database release 056 installed
at 10:37 UTC. All 111 existing monitored datasets were preserved; seven HTTP
permission checks passed with 112 datasets unchanged including the new journal.
No users, grants, provider calls or production changes were introduced. TEST
backend binding, protection on three routes, actual same-origin client/operator
login redirects and zero observed browser errors pass. Positive signed-in recovery
acceptance remains open. [Release evidence](operations/evidence/learn-phone-operator-test-2026-10-11.json).

The previous staging candidate is
[serviceos-learn-test-k2z4ob4ri-allkin.vercel.app](https://serviceos-learn-test-k2z4ob4ri-allkin.vercel.app),
built remotely from backed-up GitHub commit `6be7c9b34a50dfdb07264806188eb0d9333e0259`
and READY on 11 October at 08:31 UTC. It includes the typed team/person ownership
name fix for customer/job findings, with clear unresolved-assignment gaps. It also
retains the source timeline viewer and safe Workspace diagnostics from the prior
07:00 UTC candidate `serviceos-learn-test-pncxu962n-allkin.vercel.app`.
TEST backend binding, deployment protection on three routes, actual client/operator
same-origin sign-in redirects and zero observed browser console errors pass.
Positive signed-in card/source/diagnostic and real-provider acceptance remain open.
No backend or production change occurred. Backup/restore scripts in this Git commit
remain unactivated; this frontend deployment does not run them.
[Frontend evidence](operations/evidence/learn-owner-labels-test-2026-10-11.json).

TEST database release 054 installed at 06:52 UTC and `platform-worker` v6 at
06:54 UTC. Rollback/install/worker/HTTP evidence preserved all 101 monitored
datasets and existing authority. Worker HTTP checks reject missing/incorrect
internal credentials and accept an authorised execution with no capture jobs.
No provider calls, access grants or production changes occurred.
[Diagnostic release evidence](operations/evidence/learn-email-diagnostic-test-2026-10-11.json).

The earlier 05:05 UTC candidate
[serviceos-learn-test-428847jna-allkin.vercel.app](https://serviceos-learn-test-428847jna-allkin.vercel.app)
was built from GitHub commit `1e4fc645d4b71e7ae7be8d4e29a0cfbc4092f53a`.
It added durable numerical-correction recovery: check, exact retry and cancellation
after an interrupted request or reload, paired with TEST database release 053.
All 101 monitored datasets and prior writer authority were preserved; the writer
adds only its cancellation check. Eight hosted HTTP access-denial checks passed.
Controller v8 remains unchanged. Positive signed-in hosted recovery acceptance
remains open. [Correction recovery evidence](operations/evidence/learn-correction-recovery-test-2026-10-11.json).

The earlier 04:46 UTC candidate added receipt attribution checks before performance
scoring, paired with database release 052 at 04:41 UTC. All 101 monitored datasets
and prior RPC access were preserved. Four private helpers and three deferred
constraints guard new observations, confirmations and assessments. The read-only
management audit cannot execute the private checker and does not prove historical
receipt compatibility. Positive signed-in hosted acceptance remains open.
[Receipt release evidence](operations/evidence/learn-measurement-receipts-test-2026-10-11.json).

The earlier 04:11 UTC candidate added complete cursor-based discovery/sync
history with filters, previous/next navigation and failed-read recovery, paired
with controller v8 at 04:10 UTC. All 101 monitored datasets, schema and other
endpoints were preserved; 32 hosted access checks pass. Synthetic 57-run history
browser checks pass with zero console errors. Actual capture/recovery remains open.
[Discovery history evidence](operations/evidence/learn-discovery-history-test-2026-10-11.json).

The earlier 03:55 UTC candidate separated retained inventory from connection
health, showed distinct Phone providers and retained failed/revoked states,
paired with controller v7.
[Connection inventory evidence](operations/evidence/learn-connection-inventory-test-2026-10-11.json).

The earlier 03:43 UTC candidate corrected Phone readiness and cleared stale
badges on failed/superseded refreshes, paired with controller v6 at 03:40 UTC.
[Phone readiness evidence](operations/evidence/learn-phone-readiness-test-2026-10-11.json).

The earlier 02:51 UTC candidate added searchable operator rosters and paired with
controller v2. [Roster evidence](operations/evidence/learn-roster-pagination-test-2026-10-11.json).
The backend controller was subsequently updated to v3 at 03:04 UTC, from Git
`9dd72d4994f82e2365e90f797321507e654c25cf`, to correct identity/phone health
coverage and use checked paginated inventories. All 101 datasets, schema and
other endpoints were preserved; 14 hosted boundary checks pass. Frontend source
and request contracts were unchanged, so the then-current frontend was retained.
Positive signed-in health acceptance remains outstanding.
[Operator health evidence](operations/evidence/learn-operator-health-test-2026-10-11.json).
Controller v4 supersedes v3 at 03:16 UTC, from Git
`6a1544dcd4ebfb09f6bb4919447e841d6c5127e8`. It checks complete identity
inventories and keeps suggested links within their provider and current scope.
All 101 datasets, schema and other endpoints were preserved; fourteen hosted
boundary checks pass. Frontend source/contracts remain unchanged. Signed-in
identity acceptance remains pending.
[Identity deployment evidence](operations/evidence/learn-identity-inventory-test-2026-10-11.json).
Controller v5 supersedes v4 at 03:30 UTC, from Git
`abc714dead1a9eef552fbe5d37d318ccb54baa5a`. It resolves checked ownership
at the requested time and keeps ambiguous owners/handovers unresolved. All 101
datasets, schema and other endpoints were preserved; twenty hosted access checks
pass. The protected frontend remained unchanged at that release. Positive signed-in ownership
acceptance is still pending.
[Ownership deployment evidence](operations/evidence/learn-ownership-evidence-test-2026-10-11.json).
The earlier 11 October 02:36 UTC candidate added the searchable/paginated team-group
chooser, retaining backend release 051. Local browser checks cover 256 groups,
retry, selection and scoring scope; hosted signed-in acceptance remains pending.
[Chooser deployment evidence](operations/evidence/learn-team-group-picker-test-2026-10-11.json).
Use explicit API `target: "staging"`: the first deployment of a fresh project can
be classified as production when target is omitted. Its default hostname and
intermediate deployments are not the accepted TEST candidate. Preview homepage
login stays on the current origin; production keeps the canonical login URL.
The refreshed candidate includes per-property Commusoft contact progress, secondary-contact
matching explanations, the specific unresolved-timezone review hold and retained-record
search backed by TEST release 045, plus durable assessment recovery backed by
TEST release 046 (installed at 22:06 UTC), older saved-assessment paging, and retained-job source detail inspection backed by
TEST release 047 (installed at 22:34 UTC). Release 047 preserves 88 monitored
datasets, including assessment cancellations, and existing function privileges.
The current frontend also exposes separate team cards and scoring settings for
individual, team, job and customer scopes. Team workload collection is now backed
by TEST release 048 (10 October 23:04 UTC / 11 October 00:04 local). Its hosted
rollback rehearsal, installation and four HTTP-denial checks passed, preserving
91 monitored datasets and every existing collection guard except the exact addition
of the team evidence type. No provider request or capture activation occurred.
Resumable collection is now backed by TEST release 049 (10 October 23:44 UTC /
11 October 00:44 local). It freezes the full work population, processes batches of
100, retains individual proof and supports durable browser recovery and original-rule
review. Its rollback rehearsal, installation and 14 HTTP-denial checks passed;
all 92 monitored datasets were preserved and both new ledgers remain empty. The
existing append function changed only to accept completed runs and reject unfinished
ones. No provider traffic, capture activation or operator access was created.
Working-time package release 050 is installed (11 October 01:57 UTC / 02:57 local).
It adds company calendar revisions/publication, approved-delay history and frozen
member/team working-time collection, with explicit scoring states and retained
input evidence. Hosted rehearsal/install/readback preserved 94 monitored datasets
and existing authority; 40 HTTP access-denial checks passed and seven new tables
remain empty. The paired frontend above is READY; binding, protection and actual
same-origin sign-in redirect pass. Signed-in owner acceptance, real company
configuration and hosted large-evidence transport remain open. No identities,
operator grants, provider requests or capture activation were created.
Canonical card-search release 051 is installed (11 October 02:16 UTC / 03:16 local).
It searches customer titles, job titles/numbers, member names/roles and team names
under existing caller permissions and RLS. Exact rollback/install/readback preserved
101 monitored datasets and existing table access. Eight HTTP role-denial checks
passed. Its paired frontend above is READY; TEST binding, deployment protection and
actual browser sign-in redirect passed with no console errors. Signed-in hosted
search acceptance remains pending. No provider, source or production changes occurred.
History paging is a frontend-only change with no new backend migration. Release 046
preserved all 87 monitored datasets, including assessment and scoring ledgers, and
existing assessment privileges.
Vercel reports READY; TEST environment binding and anonymous protection on homepage,
login and client routes pass. This candidate rendered the login screen and passed the actual browser
unauthenticated client redirect check. Signed-in hosted card-search acceptance, calendar/delay/working-time acceptance, resumable collection/recovery/review, team workload collection/review, team-card/scoring-scope, job-detail, history, card recovery
and control acceptance remain pending;
a successful build is not that acceptance. The Phone evidence panel is backed by TEST release 044, installed at 21:24 UTC
on 10 October with rollback service-path and HTTP-denial checks. Fresh signed-in
visual acceptance and real scheduled capture remain pending. See the
[Phone release evidence](operations/evidence/learn-phone-operator-evidence-test-2026-10-10.json).
See [current deployment evidence](operations/evidence/learn-roster-pagination-test-2026-10-11.json),
[card-search deployment evidence](operations/evidence/learn-card-search-test-2026-10-11.json) and
[047 backend evidence](operations/evidence/learn-job-details-test-2026-10-10.json).

Backup pushes to `codex/learn-v1-test` do **not** automatically deploy because
`vercel.json` disables that branch. Verify and deploy a pinned Git commit explicitly.
Do not apply the production Supabase settings in the sections below to this TEST
project. Full signed-in acceptance still requires the TEST operator backend and
account dependencies recorded in [TEST readiness](operations/LEARN-TEST-READINESS.md).

### Production-project previews

- Every branch push produces a **Preview** deployment. Pushes to a non-production branch
  (e.g. `serviceos-backend-foundation`) only ever produce Preview, never Production.
- A preview can also be created from the working tree with `vercel deploy` (remote build).
- **Preview URLs are behind Vercel Deployment Protection (SSO)** — open them while signed
  in to Vercel, or via a Protection-Bypass-for-Automation token. Production URLs are public.

## Promoting to production

Production tracks `main`, so the controlled routes are:

1. **Fast-forward `main`** to the verified branch and push — Vercel's Git integration then
   builds & deploys it to production (carries the real commit SHA). This is the current
   default. It is a fast-forward, never a history rewrite.
2. `vercel promote <preview-url>` — promote an already-built, verified preview.
3. `vercel deploy --prod` — deploy the working tree straight to production.

Instant rollback: `vercel rollback` (or `vercel promote <previous-prod-url>`).

### Required checks before promoting

1. `npm install` — dependency install (repo also carries `bun.lock`; **Vercel uses npm**).
2. `npx tsc --noEmit` — typecheck must pass (the meaningful gate).
3. `npm run build` — production build must succeed.
4. Route verification — the intended routes exist (`/openfolk`, `/openfolk/$tenantId`,
   `/demo/openfolk`, `/demo/ownership`, `/health-shadow`, `/demo/customer-health`).
5. Preview smoke test — routes render, auth works, API calls target
   `tgbnakbxwcqjeimygroz`, no console errors, unauthorised users fail closed.

> `npm run lint` currently reports pre-existing `prettier/prettier` formatting drift. Vercel
> builds with `vite build`, **not** lint, so it does not gate deployment. Do not mass-reformat
> as part of a deploy.

## Confirming the deployed commit

- **In-app:** the OpenFolk operator surface (`/openfolk`) renders a build/version badge —
  frontend commit SHA, build timestamp, environment, and Supabase project ref
  (`src/components/BuildBadge.tsx`, injected via `vite.config.ts` `define`). If the badge SHA
  is behind the branch HEAD, the frontend is stale. It is operator-only (auth-gated route,
  never in tenant navigation) so ordinary tenant users do not see it.
- **From the CLI:** `vercel inspect https://serviceos-dh.vercel.app --scope allkin` and
  `vercel ls serviceos-dh --scope allkin`.

## Custom domain — `app.openfolk.ai`

The **canonical user-facing production hostname** is **`https://app.openfolk.ai`**, attached to
the same `allkin/serviceos-dh` project (no second project). **`serviceos-dh.vercel.app` stays
attached** as a temporary fallback + deployment-diagnostic hostname.

| Item | Value |
|------|-------|
| Canonical domain | `https://app.openfolk.ai` |
| Fallback domain | `https://serviceos-dh.vercel.app` (keep working) |
| DNS provider | **GoDaddy** (`ns11/ns12.domaincontrol.com`) — nameservers unchanged |
| **DNS record to add** | `CNAME` host `app` → `b7083fbc113bbb6d.vercel-dns-017.com` (Vercel A-record alt: `76.76.21.21`) |
| Ownership verification | Automatic — domain is under the same Vercel scope (`attached: true, verified: true`); **no TXT record** |
| SSL | Auto-issued by Vercel (Let's Encrypt) once the CNAME resolves |
| Control Plane route | `https://app.openfolk.ai/openfolk` (no hostname-based routing this increment) |

**Do not** change nameservers or touch MX / SPF / DKIM / DMARC (a DMARC record exists at
`_dmarc.openfolk.ai`). Add only the single `app` CNAME.

### Verify after DNS is added

```bash
vercel domains inspect app.openfolk.ai --scope allkin   # DNS + SSL status
dig +short CNAME app.openfolk.ai                         # should show the vercel-dns target
```

## Application canonical URL / auth origins

The app has **no application-URL / site-URL env var** — it derives origins from
`window.location.origin` at runtime, so serving it at `app.openfolk.ai` needs **no Vercel env
change**. Auth is **password-only** (`signInWithPassword` / `signUpWithPassword`,
`detectSessionInUrl: false`); there are **no magic-link / OAuth / email-redirect client flows**.

### Supabase Auth URL configuration (project `tgbnakbxwcqjeimygroz`)

Set in the Supabase dashboard (Authentication → URL Configuration). Do **not** change the
Supabase project API URL.

- **Site URL:** `https://app.openfolk.ai`
- **Redirect allow-list:**
  - `https://app.openfolk.ai/**`
  - `https://serviceos-dh.vercel.app/**` (temporary fallback)
  - `https://*-allkin.vercel.app/**` (preview deployments — narrowest safe pattern)
  - existing local-dev URLs the team already uses (e.g. `http://localhost:5173/**`)

Because no client flow consumes these today, this only affects future email-template links
(e.g. signup confirmation, currently gated off by `VITE_ENABLE_SIGNUP`).

## Rollback (no data touched)

1. **Auth:** if sign-in breaks, restore the previous Supabase Auth **Site URL** in the dashboard.
2. **Frontend:** `serviceos-dh.vercel.app` keeps serving the same deployment — use it while
   diagnosing. Roll a bad deploy back with `vercel rollback` (never delete deployments).
3. **Domain:** detach `app.openfolk.ai` only if required (`vercel domains rm` / dashboard);
   the fallback hostname keeps the app reachable.
4. All Supabase schema, audit and configuration data is untouched by any of the above.

## Future domain structure (documented, not implemented)

- `control.openfolk.ai` — OpenFolk operator entry point (future)
- `demo.openfolk.ai` — synthetic commercial demo (future)
- optional customer-specific subdomains (future)

For now `app.openfolk.ai/openfolk` is the authoritative Control Plane route.

## Platform authority (who can open `/openfolk`)

Platform authority is **decoupled from `profiles.role`** (migration
`20260822120000_platform_authority_decoupled_from_role.sql`). Access to the Control Plane
requires exactly three things:

1. an authenticated user;
2. an existing `public.profiles` row;
3. an **active `platform.controlplane` grant** (`admin` implies `view`) in
   `platform_authority_grants` (effective-dated, auditable, reversible).

`profiles.role` is the **tenant-facing role only** (`owner|admin|ops|viewer|openfolk`) and is
never consulted by the gate — so a tenant **`owner` can hold platform authority without
surrendering their tenant role**. `is_openfolk()` is deliberately unchanged: it still means
`role='openfolk'` and still governs cross-tenant access in tenant RLS, so **a platform grant
confers Control Plane access only, never tenant data access**.

Grant an operator with `scripts/openfolk-grant-operator.sh` (it never modifies a profile's
role). Both enforcement points must be in sync in production: the SQL gate
`current_user_is_openfolk_operator()` **and** the deployed `openfolk-control-plane` edge
function (`_shared/controlplane/authz.ts`).

## Backend (Supabase) — separate track

For the developing LEARN V1 release, use the separate
[verified TEST environment map](operations/LEARN-TEST-READINESS.md). The existing
TEST backend is a partial schema with its own deployment ledger; a successful
local build does not establish hosted TEST compatibility. Do not point a TEST
frontend at the production project documented above.

Supabase migrations and edge functions deploy via the Supabase CLI against project
`tgbnakbxwcqjeimygroz`, independently of Vercel. A frontend deploy must never modify
Supabase, publish the Customer Health policy, enable the source allowlist, or activate any
live source.

## LEARN V1 checkpoint branch — 10 October 2026

Chris requests regular GitHub backups during TEST development. This reconstructed
checkout uses `codex/learn-v1` locally and pushes checkpoints to
`Drummasterflash83/serviceos-dh:codex/learn-v1-test`. Verify the remote head after
each push. Keep secrets, private manifests, generated builds and original customer
files excluded. The branch contains recovered source plus subsequent LEARN work;
it does not replace the original checkout's full history.

`vercel.json` disables automatic Git deployment for this exact TEST checkpoint
branch, as supported by [Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration).
This permits source backup while a separately configured TEST frontend remains
unpublished. Do not point it at production Supabase. Promoting `main` and deploying
backend changes remain separate operations. A source-code backup is not a backup
of hosted email, phone audio or database records.

The 11 October read-only backup check found eight completed production database
backups and an empty TEST backup list. Database backups exclude Storage file
bytes. Independent recording backup and a manifest-selected audio restore are now
verified; a real database restore and unattended recurring operation remain open.
See [data recovery coverage](operations/LEARN-DATA-RECOVERY.md) before claiming
that a GitHub checkpoint or database backup protects all retained customer data.
