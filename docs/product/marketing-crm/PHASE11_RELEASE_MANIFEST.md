# Phase 11 — Marketing Staging Activation: Release Manifest & Approval Boundary

**Status: DEPLOYMENT-READY PLAN — STOPPED AT THE APPROVAL BOUNDARY (2026-08-01).**
No remote environment was touched. No staging environment exists. No Meta credential
exists. Marketing remains `LAUNCH-READY — PREVIEW`; Meta remains
`ADAPTER IMPLEMENTED — FIXTURE TESTED — NOT LIVE VERIFIED`.

**Phase 11.1 addendum (2026-08-01): the release chain is remediated —
`STAGING-DEPLOYMENT READY` at the repository level.** F-P11-1 (duplicate migration
version) is RESOLVED and guarded, and the complete committed migration chain has been
proven against a genuinely fresh database (90/90 applied, §4b). This classification
means the _repository_ is safe to deploy from; it does not mean a staging project
exists, and Marketing remains `PREVIEW`.

This document is the exact Step 2–4 output of the Phase 11 mission: the release
manifest, the environment conformance report, the deployment command set with risk
classification, and the precise approvals required to proceed. It contains no
secrets.

---

## 1 · Repository truth (verified 2026-08-01)

| Item                 | Value                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Branch               | `serviceos-backend-foundation`                                                                                                                               |
| HEAD                 | `be85ce1675dc37a85c67b575f72eade77083cdfd` (Phase 10B)                                                                                                       |
| Phase 10B parent     | `466c6a227ce70d7293ac47f82297d1af5406905d` (Phase 10A) ✅                                                                                                    |
| Phase 9 / Phase 8    | `70e67cc…` / `df8b6c5…` — hashes, parents, subjects verified ✅                                                                                              |
| origin               | `b74bd8b42a9c258eb74b0d86b8294c9b229dd0e5` — branch 11 ahead / 0 behind ✅                                                                                   |
| Index                | empty ✅ · `git diff --check` clean ✅                                                                                                                       |
| Phase 10B path set   | exactly 15 paths (10 modified, 5 created) — matches the ledger ✅                                                                                            |
| Unrelated dirty tree | 20 files (phone-ops / telephony / product-review / run-checkpoints only); SHA-256 baseline captured and re-verified unchanged after all verification runs ✅ |
| Registry             | Marketing `PREVIEW`; Meta `fixture_tested`; nothing `live_verified` ✅                                                                                       |

## 2 · Local regression baseline (all re-run 2026-08-01, this session)

| Suite                                                         | Result                                                                                                                                                                                                                           |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 8 pure (`marketing-ads-pure`)                           | **PASS 18/18**                                                                                                                                                                                                                   |
| Phase 9 pure (`marketing-connections-pure`)                   | **PASS 11/11**                                                                                                                                                                                                                   |
| Phase 10A pure (`marketing-provider-hardening-pure`)          | **PASS 14/14**                                                                                                                                                                                                                   |
| Meta pure (`marketing-meta-pure`)                             | **PASS 19/19**                                                                                                                                                                                                                   |
| Phase 8 SQL (`marketing_ads.test.sql`)                        | Stops at the **documented pre-existing §17b F6 environmental point on the dev DB** ("forged attribution person reference") — byte-identical to the recorded Phase 9/10/10B baseline; passes on a clean chain. **No regression.** |
| Phase 9 SQL (`marketing_provider_connections.test.sql`)       | **PASS** (exit 0, rollback)                                                                                                                                                                                                      |
| Phase 10A SQL (`marketing_provider_hardening.test.sql`)       | **PASS** (exit 0, rollback)                                                                                                                                                                                                      |
| PostgREST boundary (`marketing-connections.test.mjs`)         | **PASS 47/47**                                                                                                                                                                                                                   |
| Phase 10A served-HTTP (`marketing-connections-http.test.mjs`) | **PASS 122, both rounds** (locally served Edge runtime + real platform-worker)                                                                                                                                                   |
| Meta served-HTTP (`marketing-meta-http.test.mjs`)             | **PASS 96, both rounds** (contract fixtures — NOT live data)                                                                                                                                                                     |
| TypeScript (`tsc --noEmit`)                                   | **PASS**                                                                                                                                                                                                                         |
| Production build (`npm run build`, Vite + nitro)              | **PASS**                                                                                                                                                                                                                         |
| eslint / prettier                                             | **Environmental finding, low severity, not build-gating** — see §9 F-P11-3                                                                                                                                                       |

## 3 · Environment truth (Step 3 conformance)

| Environment                | Identity                                                                                  | State                                                                                                                                                                                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Local**                  | Docker stack `supabase_db_serviceos-dh` etc.; CLI `npx --no-install supabase` 2.111.0     | Full schema through `20260907120000` present and verified live. Migration ledger _records_ only through `20260821120000` — later migrations were applied via direct `psql` (documented pattern). Bun absent on this machine; npm used (matches Vercel). |
| **Remote Supabase**        | `tgbnakbxwcqjeimygroz` (eu-west-2), account `chris@allkin.co`, org `nmhqcjrjrtwsvlcvqqnh` | **PRODUCTION — the only remote project configured.** Marketing migrations `20260828…20260907` NOT deployed; marketing Edge functions NOT deployed. Untouched this session.                                                                              |
| **Staging Supabase**       | —                                                                                         | **DOES NOT EXIST.** This is the mission's explicit stopping condition.                                                                                                                                                                                  |
| **Frontend (prod)**        | Vercel `Allkin/serviceos-dh`, Production = `main` → serviceos-dh.vercel.app               | Untouched.                                                                                                                                                                                                                                              |
| **Frontend (preview)**     | Vercel Preview per branch push                                                            | **Preview is backed by the PRODUCTION Supabase project** (`VITE_SUPABASE_URL` in Vercel points at prod — proven in the prior authenticated Preview audit). A true staging frontend needs branch-scoped env vars or a second Vercel project.             |
| **Meta (staging or prod)** | —                                                                                         | **No Meta app, no Business Manager, no system user, no token exist** (external registrations never performed — META_SETUP.md, re-confirmed).                                                                                                            |

Session note: `supabase projects list` (management API) hung in this non-interactive
session — the CLI token lives in the macOS keychain and was unavailable; prior
interactive sessions ran it successfully. This does not affect the conclusion: the
linked ref proves production identity, and deployment is blocked regardless.

## 4 · Database release manifest

Ten committed Marketing migrations, strict timestamp order, **all additive** (the
apparent "drop/truncate" matches are commented rollback documentation and
`revoke … truncate` hardening statements — verified):

| Migration                                          | Lines      | Tables | Functions | Policies | Triggers |
| -------------------------------------------------- | ---------- | ------ | --------- | -------- | -------- |
| `20260828120000_marketing_foundation`              | 927        | 13     | 6         | 5        | 11       |
| `20260829120000_marketing_contacts_projection`     | 1,936      | 2      | 13        | 1        | 2        |
| `20260831120000_marketing_admin_phase3`            | 3,558      | 3      | 24        | 2        | 7        |
| `20260901120000_marketing_sender_delivery`         | 2,202      | 3      | 22        | 3        | 15       |
| `20260902120000_marketing_broadcasts`              | 3,916      | 8      | 36        | 6        | 11       |
| `20260903120000_marketing_sequences`               | 4,990      | 8      | 47        | 7        | 12       |
| `20260904120000_marketing_templates_reporting_ai`  | 4,123      | 7      | 39        | 7        | 16       |
| `20260905120000_marketing_ads`                     | 2,487      | 7      | 25        | 7        | 14       |
| `20260906120000_marketing_provider_connections`    | 991        | 3      | 13        | 3        | 6        |
| `20260907120000_marketing_provider_sync_hardening` | 1,234      | 1      | 12        | 1        | 2        |
| **Total**                                          | **26,364** | **55** | **237**   | **42**   | **96**   |

- **Dependencies:** each migration depends on the full prior chain (platform tenant
  model, Vault, platform jobs/worker seam). A fresh staging project applies the
  entire 90-file chain from scratch.
- **Data-destructive risk:** none — additive DDL + `revoke` hardening + bounded
  seed rows only; no bulk backfill of existing data.
- **Lock/runtime impact:** DDL-dominated; low lock risk; minutes not hours.
- **Rollback feasibility:** every file documents its own drop list in comments.
  Preferred rollback (per the runbook): disable capability + revert function/app
  deployments and **retain the additive schema inert**; destructive reversal only
  for a proven data-integrity incident.

### Release-chain blockers found by the Phase 11 audit — remediated in Phase 11.1

1. **F-P11-1 — RESOLVED (Phase 11.1 checkpoint).** Duplicate migration version
   `20260827120000` was shared by `20260827120000_delegated_setup_tasks.sql`
   (deployed to prod 2026-07-24; its tables verified present via read-only
   PostgREST probes) and `20260827120000_identity_review_defer_unassigned.sql`
   (proven never deployed: created 2026-07-25 — one day _after_ the version row was
   recorded in the production history, which keys on version and never re-applies;
   the file's own header says "NOT deployed until confirmation mode is separately
   approved"). Remediation: `git mv` restamp of the undeployed file to
   **`20260827120100_identity_review_defer_unassigned.sql`** — contents
   byte-identical (SHA-256 `9e08425…` before and after), the deployed twin
   untouched (SHA-256 `68c8ef7…` unchanged), apply order preserved (the identity
   file already sorted after its twin and before marketing `20260828`). Production
   is unaffected (the old version never ran there; the new version is greater than
   prod's max applied version so a future push stays in-order).
2. **Guard added:** `scripts/check-migration-order.mjs` now also asserts every
   _committed_ migration carries a unique 14-digit version and a conforming
   `<digits>_<snake_case>.sql` name, and lists colliding paths on failure.
   Proven fail-before (exit 1 naming `20260827120000` and both paths) and
   pass-after (90 unique committed versions).
3. **F-P11-2 (procedural, permanent rule): uncommitted phone-ops migration inside
   the marketing span.** `20260830120000_phone_operations_control.sql` is untracked
   but present in `supabase/migrations/`, ordered between marketing `20260829` and
   `20260831`. Any `db push` from this working tree would apply uncommitted
   phone-ops SQL. **Mandatory procedure: deploy only from a clean worktree at the
   Phase 11.1 checkpoint** (§10), never from the mixed working tree.

### §4b · Fresh-chain proof (Phase 11.1, 2026-08-01)

Executed against a genuinely fresh database (`phase111_chainproof`) in the local
supabase-image container, bootstrapped with only the platform baseline (extensions,
auth/storage stubs, realtime publication, **real `supabase_vault`**, and an empty
`supabase_migrations.schema_migrations` history table). Source = the candidate
committed tree only (`git write-tree` → `git archive`): 90 files, renamed identity
migration present, untracked phone-ops migration absent.

- Fail-before at the history layer: inserting both `20260827120000` rows violates
  the history PK (`Key (version)=(20260827120000) already exists`) — the exact
  fresh-environment collision F-P11-1 predicted.
- Full apply: **90/90 migrations applied in order, zero failures**; history shows
  90 rows / 90 distinct versions; `20260827120100` recorded once;
  `20260827120000` recorded once (delegated only); chain reaches
  `20260907120000`; the renamed migration's effect is genuinely present
  (`endpoint_identity_reviews_decision_check` includes `deferred`/`unassigned`);
  50 `marketing%` tables incl. all four `marketing_provider%` tables.
- Scratch database dropped after verification; full log retained in session
  evidence (`chainproof-apply.log`).

## 5 · Edge function release manifest

18 functions required (16 marketing + 2 platform dependencies). All marketing
functions and `platform-worker` run `verify_jwt = false` in `supabase/config.toml`
(authentication is enforced inside — `requireTenantUser`, worker shared-secret,
digest-verified public tokens). Deploy name = source directory name; rollback for
every function = redeploy the same name from the prior commit's worktree.

| Function                                            | Auth model                       | Extra env/secrets                           |
| --------------------------------------------------- | -------------------------------- | ------------------------------------------- |
| `marketing-access`                                  | requireTenantUser                | —                                           |
| `marketing-contacts`                                | requireTenantUser + resolver     | —                                           |
| `marketing-admin`                                   | owner/admin + resolver           | —                                           |
| `marketing-segments`                                | requireTenantUser + resolver     | —                                           |
| `marketing-senders`                                 | requireTenantUser + resolver     | —                                           |
| `marketing-campaigns`                               | requireTenantUser + double gate  | —                                           |
| `marketing-unsubscribe`                             | PUBLIC (digest-verified tokens)  | `MARKETING_PUBLIC_BASE_URL`                 |
| `marketing-broadcast-scheduled-sync`                | shared secret                    | `MARKETING_BROADCAST_SECRET`                |
| `marketing-sequences`                               | requireTenantUser + resolver     | `MARKETING_SEQUENCE_SECRET`                 |
| `marketing-sequence-scheduled-sync`                 | shared secret                    | `MARKETING_SEQUENCE_SECRET`                 |
| `marketing-templates`                               | requireTenantUser + resolver     | —                                           |
| `marketing-reporting`                               | requireTenantUser + resolver     | —                                           |
| `marketing-ai-drafts`                               | requireTenantUser + resolver     | — (drafting via governed RPC seam)          |
| `marketing-ads`                                     | requireTenantUser + resolver     | —                                           |
| `marketing-ad-webhook`                              | HMAC per-source (Vault-brokered) | —                                           |
| `marketing-provider-connections`                    | requireTenantUser + resolver     | `MARKETING_TEST_PROVIDER` **must be UNSET** |
| `platform-worker` (dependency)                      | `x-schedule-secret`              | `WORKER_SECRET`                             |
| `data-import` (dependency: contacts import profile) | requireTenantUser                | —                                           |

Secrets to set in staging (names only — values operator-supplied):
`WORKER_SECRET`, `MARKETING_SEQUENCE_SECRET`, `MARKETING_BROADCAST_SECRET`,
`MARKETING_PUBLIC_BASE_URL`. `MARKETING_TEST_PROVIDER` is deliberately **absent**
unless the staging project is explicitly designated a labelled test environment
(fixture credentials are structurally invalid without it — this is the designed
production posture). `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are
platform-injected. Vault must be enabled (credential storage `mkt-conn-<account>`).

## 6 · Frontend release manifest

- Route: `src/routes/marketing.tsx` (protected `/marketing` surface).
- Components: 14 (`src/components/app/Marketing*.tsx`).
- Client libraries: `src/lib/marketing/*` (~20 modules) + `src/lib/capability-registry.ts` gates.
- Env: `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` — **must point at the staging
  project for a staging frontend**. Today Vercel Preview points at production;
  staging requires branch-scoped Vercel env vars or a second Vercel project.
- Deployment: Vercel Git integration (push builds Preview). **Pushing requires
  explicit authorisation** (11 unpushed commits would go up).
- Rollback: Vercel deployment rollback / previous Preview URL.

## 7 · Scheduler release manifest (staging-only; NOT installed anywhere today)

- Technology: platform scheduler (pg_cron) → the existing 1-minute platform cron
  invokes `platform-worker`; the marketing addition is a per-tenant enqueue tick.
- Cadence: enqueue tick every 5 minutes ± 30 s jitter; lease 300 s; batch 5;
  fairness = per-tenant enqueue + the worker's global batch claim.
- Target: `marketing_provider_sync_enqueue_due` (due-computation:
  `marketing_provider_sync_due` — connected + cadence elapsed + no active run;
  structurally idempotent, proven safe under overlapping invocations).
- Auth: `x-schedule-secret` = `WORKER_SECRET`.
- Disable switch: do not register / unregister the enqueue tick — nothing else polls.
- Expected audit: run rows in `marketing_provider_sync_runs` + connection events.
- Rollback: `cron.unschedule` of the tick; worker cron untouched.

## 8 · Monitoring release manifest (defined — NOT activated)

Signals per CONNECTIONS_RUNBOOK.md + META_SETUP.md additions, all derivable from
existing tables (`marketing_provider_sync_runs`, connection events, freshness,
function logs): validation/credential failures, sync success rate + duration,
attempts ≥ 5, `max_attempts_exhausted`, stale / never-run connected accounts,
rate-limit + timeout classes, ingestion rejections (`fact_rejected`,
`schema_invalid`), permission denials (42501), cross-tenant NOT_FOUND rate,
scheduler heartbeat, and the Meta additions (auth failures, missing scope,
discovery failures, paging failures, action-type drift, insights latency).
**Open item: no monitoring destination exists in the repo** — the operator must
choose the staging destination (owner: Chris) before Step 14 activation.

## 9 · Defects & findings from this session (none touch committed marketing behaviour)

| ID      | Severity             | Finding                                                                                                                                                                                                                                                                                                                                                                                                                               | Disposition                                                                                                                                                                                             |
| ------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-P11-1 | HIGH (release chain) | Duplicate migration version `20260827120000` (two committed files) blocked any fresh-environment full-chain push                                                                                                                                                                                                                                                                                                                      | **RESOLVED in the Phase 11.1 checkpoint**: undeployed file restamped to `20260827120100` (byte-identical), uniqueness guard added to `scripts/check-migration-order.mjs`, fresh-chain 90/90 proof (§4b) |
| F-P11-2 | HIGH (procedural)    | Untracked phone-ops migration `20260830120000` sits inside the marketing migration span; naive `db push` from the dirty tree would apply uncommitted SQL                                                                                                                                                                                                                                                                              | Mandatory clean-worktree deploy procedure (§10); permanent rule, no code change                                                                                                                         |
| F-P11-3 | LOW (environmental)  | eslint/prettier repo-wide drift under the npm-installed toolchain (prettier 3.9.4 vs bun.lock-pinned 3.8.3; 116–155 files depending on version, incl. many non-marketing). No Phase 10B file fails under 3.9.4; two pre-existing single lint errors in committed marketing files (`marketing_test_provider.ts` no-explicit-any; `marketing-provider-connections/index.ts` no-control-regex). Neither tool gates the production build. | Recorded; do NOT mass-reformat (would touch unrelated files). Optional later: align local toolchain to bun.lock.                                                                                        |

## 10 · Deployment command set (ready; DO NOT RUN without the approvals in §11)

All commands assume a designated staging project ref `<STAGING_REF>` that does not
yet exist. Risk classes: RO = read-only · RM = remote mutation · R = reversible ·
PR = partially reversible.

```text
# 0 · Clean worktree (local, RO/R) — from the Phase 11.1 remediation checkpoint
#     <CHECKPOINT> = the commit whose subject is
#     "fix(migrations): resolve duplicate release-chain version" (or any later
#     checkpoint on serviceos-backend-foundation). NEVER the mixed working tree.
git worktree add /tmp/serviceos-phase11-deploy <CHECKPOINT>
cd /tmp/serviceos-phase11-deploy

# 0b · Gate: prove the worktree is clean and the chain is sound (local, RO)
git status --porcelain            # MUST print nothing
ls supabase/migrations | grep -c 20260830120000   # MUST print 0 (phone-ops absent)
node scripts/check-migration-order.mjs            # MUST PASS (uniqueness + order)

# 1 · Link to STAGING only (local config write, R)
npx supabase link --project-ref <STAGING_REF>

# 2 · Verify identity + pending set (RO)  — expect the full chain incl. the ten marketing files
npx supabase migration list
npx supabase db push --dry-run

# 3 · Apply migrations (RM, PR — additive; retain-inert rollback)
npx supabase db push

# 4 · Secrets (RM, R)  — values supplied by the operator at run time, never stored in repo
npx supabase secrets set WORKER_SECRET=… MARKETING_SEQUENCE_SECRET=… \
  MARKETING_BROADCAST_SECRET=… MARKETING_PUBLIC_BASE_URL=…

# 5 · Functions (RM, R — rollback = redeploy from prior commit's worktree)
for f in marketing-access marketing-contacts marketing-admin marketing-segments \
         marketing-senders marketing-campaigns marketing-unsubscribe \
         marketing-broadcast-scheduled-sync marketing-sequences \
         marketing-sequence-scheduled-sync marketing-templates marketing-reporting \
         marketing-ai-drafts marketing-ads marketing-ad-webhook \
         marketing-provider-connections platform-worker data-import; do
  npx supabase functions deploy "$f" --project-ref <STAGING_REF>
done

# 6 · Frontend staging env (Vercel dashboard, RM, R): branch-scoped
#     VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY → staging project; then git push
#     origin serviceos-backend-foundation (RM — requires separate explicit authorisation)

# 7 · Scheduler (staging only, RM, R): register the 5-min enqueue tick per §7 — ONLY
#     after Steps 5–12 of the mission pass in staging.

# 8 · Rollback (staging): unschedule tick → revoke connections → redeploy prior
#     functions → retain additive schema inert → (last resort) delete the staging project.

# 9 · After verification: remove the temporary worktree
git worktree remove /tmp/serviceos-phase11-deploy
```

F-P11-1 is resolved (§4), so step 3 no longer collides; step 0b is the standing
gate that keeps it that way. **Vercel Preview backed by the production Supabase
project is NOT staging and must never be used as a staging substitute** — a staging
frontend requires its own `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` pointing at
the staging project.

## 11 · Exact approvals required to proceed (the boundary this phase stopped at)

1. **Staging environment**: none exists. Required — user creates (or explicitly
   authorises creating) a **separate staging Supabase project** (org
   `nmhqcjrjrtwsvlcvqqnh`, suggested name `serviceos-staging`, region eu-west-2;
   has billing implications, so this is the user's call), then names it as the
   approved Phase 11 target. Per the mission, production
   (`tgbnakbxwcqjeimygroz`) is NOT an acceptable substitute.
2. **Remote-mutation authorisation**: explicit approval for the §10 command set
   against that named staging ref (none was given this session; the mission is not
   blanket authority).
3. ~~F-P11-1 fix authorisation~~ — **done** (Phase 11.1 checkpoint, §4).
4. **Meta external prerequisites** (all user actions, all currently absent): Meta
   app + Business Manager (verified) + Marketing API product + system user +
   assigned ad account + `ads_read` system-user token. The token must be submitted
   **through the ServiceOS credential form** on the staging surface — never via
   chat, repo, or CLI.
5. **Operational decisions**: monitoring destination for staging (§8) and the
   staging frontend env route (§6); named approved test tenant + approved Meta ad
   account for the bounded sync.

## 12 · Classification

**Marketing capability: `LAUNCH-READY — PREVIEW` (unchanged).**
**Release chain (Phase 11.1): `STAGING-DEPLOYMENT READY`** — duplicate version
resolved and guarded, complete committed chain proven on a fresh database, clean
deployment-source procedure proven. `STAGING-DEPLOYED` / `STAGING-VERIFIED` remain
unreached: no staging environment exists, remote mutation was not authorised, and
every Meta external prerequisite is BLOCKED (external registrations). The
deployment plan is exact and ready the day the §11 approvals exist.
