# Existing TEST environment: verified release gaps

## Commusoft contact acceptance — hosted TEST, 10 October 2026

The explicitly approved single-account test passed at **13:21:15 UTC**, with a
separate read-only retirement confirmation at **13:21:47 UTC**. Seven synthetic
pages, versions, permits and successful jobs remain as evidence. Signed-in review
produced one customer card, one site, one job, two people and four contact points.
The test exercises customer and site contacts, unresolved-property holds, shared
email identity review, deliberate lost-response recovery, receipt replay,
cancellation and immediate access loss after demotion. Existing person fields and
contact verification state remain unchanged. All 39 checked pre-existing datasets
and the installed schema/runtime contract match their pre-run snapshots.

The synthetic login is banned, its profile demoted, temporary operator grant ended,
connection revoked, account/connector/switches disabled and dummy Vault binding
renamed. No active synthetic job or authority remains. See
[hosted acceptance and retirement evidence](evidence/learn-commusoft-contacts-hosted-2026-10-10.json).

The initial preservation preflight failed before creating any fixture records:
two verification child tables require a parent-request join for company scoping.
After correcting that query, the runner verified authoritative absence and resumed
with the exact approved identities, retaining the failed attempt's recovery record.
It refuses this continuation if any account, company, grant, connection or binding
exists, or if any fixture work was previously attempted.

Provider responses were intercepted synthetic fixtures. Successful capture used
the production worker modules locally with hosted TEST Vault/RPCs; deployed Edge
execution was exercised for saved-page recovery while capture was disabled. This
does not verify Drummonds' real Commusoft API credentials, response coverage or
production readiness. No production changes or real Commusoft requests occurred.

## Email capture evidence correction — local, 10 October 2026

Read-only production checks at approximately 13:10–13:15 UTC found that all 30
inspected email accounts lacked `last_incremental_success_at`. Recent Workspace
sync-run records nevertheless reported successful captures, including one changed
record at 13:08 UTC. This is a reporting mismatch, not evidence that all capture
stopped. The deployed `gmail-workspace-sync-messages` version 45 was downloaded
and inspected without invocation: it updates run completion but does not populate
the newer account-success field. Its version and deployment hash were reconfirmed
at 13:14:47 UTC. Deployed shared helpers differ from this checkout; reconcile those
versions before changing capture guards or deploying replacements.

The local follow-up migration `20261031220000_learn_email_capture_evidence.sql`
adds mailbox-specific terminal sync-run evidence to the operator health reader.
It matches company, mailbox and OAuth/Workspace capture path, excludes scheduler
heartbeats and historical backfill, rejects incomplete success records, and keeps
raw errors and private metadata out of the response. Existing release 031 is
unchanged. Local Postgres checks pass for rollback, company/mailbox separation,
failure and recovery, provider-path separation, redaction and the application
response parser. This follow-up has **not** been installed in TEST or production;
actual-schema rehearsal and a separately verified release remain required.

Recent run results do not prove full mailbox coverage or preservation of every
email. No production account, worker, schedule or source record was changed.

## OpenFolk capture diagnostics — TEST backend, 10 October 2026

The operator Modules view now includes a tenant-scoped email, phone and Slack
capture panel. It reads a new metadata-only RPC, using existing platform authority;
tenant ownership or View As does not grant access. Results exclude credentials,
raw provider errors, account settings, cursor tokens and message/audio content.
Reads are paginated at 50 accounts. Personal Gmail and Workspace DWD are identified
separately. Recent activity is evidence of a run, not complete source coverage.
Slack completion requires the latest successful history job to match the retained
scope/page checkpoint and records only the approved channel window; thread and
continuous capture remain separate checks. Failed refreshes clear old results.

Release 031 is installed in TEST and confirmed at **13:04:28 UTC**. It adds one
read-only function, no tables or existing-function changes, and takes the release
ledger to 32 receipts. Hosted rollback and installation retained all 43 checked
datasets, including email account metadata and encrypted Vault rows. No new account,
credential, provider request or capture job was created. The first install preflight
was rate-limited before a write journal existed; only the subsequent attempt
submitted a migration. See [TEST release evidence](evidence/learn-capture-health-test-release-2026-10-10.json).

The isolated PG15 fixture is supplemented by a PG17 rehearsal reproducing the
35 actual dependent TEST tables, policies, triggers, grants and 55 helper functions,
including the existing email-ingestion protocol guard. The new function passes
with the actual non-superuser owner. Rollback, deployment-receipt failure and
duplicate-install refusal pass. Authenticated hosted read verification remains
required; this feature has not been released in the frontend or production. No source records, workers, schedules, flags or credentials
were changed. Email/phone/Slack pause controls still need every capture entry point
to honour the operator's module decisions before those controls can be released.

Validation: SQL rollback, cross-tenant exclusion, platform-viewer access,
tenant-owner denial, revoked-access denial, source redaction, DWD classification,
Slack checkpoint mismatch and 50+8 pagination pass; the actual SQL response passes
the TypeScript parser. Three model/parser tests, TypeScript and application build
pass. A network-disabled synthetic browser preview verifies 50+2 pagination,
distinct freshness/authentication states and clearing results after a read failure.
See [local evidence](evidence/learn-capture-health-local-2026-10-10.json).


Read-only checks on 9 October 2026 reused the saved Supabase CLI and Vercel logins.
Those initial audits changed no hosted state. The later **TEST-only metadata release
and subsequent card/work foundation, rules, conflict-repair, measurement and work-capture installations** are recorded below; production remains untouched.
The Vercel CLI refreshed its existing local
session after a direct request using the old saved access token returned HTTP 403.

## Current evidence

Supabase project listing reports both known projects `ACTIVE_HEALTHY`:

| Environment | Project | Organisation | Region |
|---|---|---|---|
| Openfolk TEST | `saatxzwxvdvqevbnskxy` | `efqvhoxukklewruplpdp` | eu-west-1 |
| ServiceOS production | `tgbnakbxwcqjeimygroz` | `nmhqcjrjrtwsvlcvqqnh` | eu-west-2 |

Only TEST schema catalogs and its deployment ledger were queried. Production
database contents and schema were not queried during this audit.

The latest retained TEST catalog is **2026-10-09 21:29:46 UTC**.
The [governed action catalog](evidence/learn-test-actions-installed-schema-2026-10-09.json)
includes the catalog-only readiness report. The foundation and earlier launch
catalogs remain historical snapshots, not the current installed schema.

- 80 public base tables, all with RLS, plus eight restricted launch views.
  The 33 new foundation tables have authenticated SELECT and service-role DML.
  Existing raw communications grants and ingestion policies remain unchanged.
- `customer_cards`, `jobs`, `team_members`, `org_units`, `intelligence_objects`
  and `graph_nodes` now exist. Synthetic signed-in access and company isolation
  passed at 20:12:34 UTC. `interactions` still lacks ordinary-user read authority.
- Nine of ten inspected RPCs now exist: scorecard draft save/read, publication,
  period-rule reading, membership-history reading, performance review, work-history
  reading, handoff collection and residence collection. Signed-in acceptance passed
  for rules at 20:38, measurements at 20:50 and capture/collection at 21:01 UTC,
  including the real card and timeline readers. Slack setup remains absent/unavailable.
- `learn-launch-status` version 1 remains ACTIVE with gateway JWT verification
  and TEST-only metadata mode. Its synthetic redaction, source-denial and authority
  checks passed again after the foundation installation.
- `current_tenant_id()` and `is_openfolk()` now explicitly allow authenticated
  execution; anonymous execution remains denied. Their bodies and source-table
  privileges were preserved. This follow-up repaired the access failure found by
  actual JWT testing; the local verifier now reproduces the original denied grants.
- TEST still uses `of_test_deploy.migrations`, with nine retained receipts:
  `openfolk_test_learn_bootstrap_v5`, `learn_launch_metadata_views_v1`,
  `learn_card_work_foundations_v1`, `learn_foundation_helper_access_v1`,
  `learn_rules_membership_v1`, `learn_scorecard_conflict_codes_v1` and
  `learn_measurements_reviews_v1`, `learn_work_capture_collectors_v1` and
  `learn_governed_work_actions_v1`.
  No standard migration ledger appeared. The original bootstrap source was not
  found in earlier targeted recovery; absence from a checkout or standard ledger
  does not imply an empty environment.

See [foundation source provenance](LEARN-TEST-FOUNDATIONS.md) and
[rules release and conflict repair](LEARN-TEST-RULES.md), and
[measurement/review release](LEARN-TEST-MEASUREMENTS.md), and
[work capture/collection signed-in acceptance](LEARN-TEST-WORK-CAPTURE.md).
The [governed action bundle](LEARN-TEST-ACTIONS.md) was installed at 21:23 UTC.
Its `work-transition` endpoint version 1 is ACTIVE with gateway JWT verification.
Real signed-in acceptance passed at 21:29 UTC, including staff actions, scoped
assignment/cover, revocation and actual handoff collection into a card. No full
browser or real-customer rollout is implied.

The catalog script deliberately continues to say `not_release_verified`: it cannot
prove source completeness, actual customer behavior, source connectors or the full UI.

Vercel's current Allkin project list has one entry:
`serviceos-dh` / `prj_XEuCp5gnEireW5WynUgkRp9QNiXa`; pagination reports no next page.
There is no separate TEST project in that scope. This inventory does not prove
domain ownership, deployment protection, capacity or configured frontend targets.
The existing production project must not be repurposed as TEST.

## Reproduce the read-only audit

```sh
LEARN_TEST_ALLOW_PROJECT_REF=saatxzwxvdvqevbnskxy \
  node scripts/verify/learn-test-readiness.mjs --existing-cli-login
node --test scripts/verify/learn-test-readiness.test.mjs
```

Alternatively provide the already-authorised `SUPABASE_ACCESS_TOKEN` through the
secure process environment and omit `--existing-cli-login`. Do not paste it into
commands, source, reports or chat. The macOS option reads only the CLI's documented
profile/legacy keychain entries into memory. It does not create a login or API key.

The script refuses production/unknown target allowlists, checks TEST's project ID,
organisation and current health before reading, and uses only fixed metadata
requests. Catalog and migration-ledger queries use Supabase's
[read-only query endpoint](https://supabase.com/docs/reference/api/v1-read-only-query).
Token lookup follows the installed CLI's
[credential-store implementation](https://github.com/supabase/cli/blob/v2.40.7/internal/utils/credentials/store.go).
Vercel metadata was checked through the saved CLI using the documented
[project inventory API](https://vercel.com/docs/rest-api/projects/retrieve-a-list-of-projects).

Four tests cover the real catalog snapshot, column-grant recognition, fixed TEST
request scope, no API-key requests, identity changes and incomplete/error results.
Seven additional catalog tests cover the restricted view/role contract and unsafe
privilege changes. The isolated PostgreSQL verifier exercises the actual catalog
query before/after installing the views, granting an extra transcript column and
granting application-role membership; both unsafe changes are detected.
Exit zero means the inspection completed; the report remains
`not_release_verified`. Even full catalog presence cannot prove policy semantics,
ordinary-user access, tenant isolation or connector acceptance.

## Concrete release work now required

The [restricted metadata release](LEARN-TEST-LAUNCH-ACCESS.md) was installed at
19:32 after a matching hosted rollback rehearsal, with an atomic checksum receipt.
The function deployed at 19:33, and signed-in synthetic acceptance passed at 19:38.
It verified owner/admin access, viewer/ops denial, tenant isolation, payload/error
redaction, private-source denial and role revocation through real Auth/PostgREST/Edge.
All fixture users and records were removed and absence verified. The broader
product foundations, frontend and providers remain incomplete.

1. Reconcile the deployed bootstrap and custom ledger. Recover its exact source if
   available; otherwise document the deployed definitions from read-only catalog
   evidence and compare a reviewed reconstruction. Never replay a blanket bootstrap
   merely because the standard migration ledger is absent.
2. Prepare an explicit additive dependency manifest against this partial schema:
   canonical customer/job/roster/graph/work foundations, then the local LEARN
   performance/capture/publication adapters. The successful local schema-clone
   tests used a different, fuller schema and do not establish TEST compatibility.
3. Extend appropriate read authority for the remaining card/work/roster surfaces.
   Preserve the now-verified launch metadata boundary and original ingestion
   protocol policies; no service-role fallback or blanket source grants.
4. Rehearse each remaining candidate against TEST's actual schema and repeat
   ordinary-user, foreign-tenant and no-JWT acceptance for its own contract. The
   launch-status result does not prove unrelated RPC or full application access.
5. Prepare a separate Vercel TEST project/candidate with TEST-only configuration,
   verified included capacity and deployment protection. Rehearse the full product
   build rather than deploying the synthetic browser harness.
6. Finish provider-specific setup and reconciliation: existing Gmail credentials
   with the intended TEST callback/consent, Slack's approved connection/channel,
   Birchills voicemail discovery, Commusoft and vehicle-source mappings. Neither
   project health nor database row counts proves working ingestion.

The audit remains read-only. The separately recorded metadata deployment and
synthetic acceptance cover one release slice, not complete LEARN acceptance.
The overall LEARN V1 goal remains active.
