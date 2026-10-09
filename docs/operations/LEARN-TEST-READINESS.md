# Existing TEST environment: verified release gaps

Read-only checks on 9 October 2026 reused the saved Supabase CLI and Vercel logins.
Those initial audits changed no hosted state. The later **TEST-only metadata release
and subsequent card/work foundation installation** are recorded below; production remains untouched.
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

The latest retained TEST foundation catalog is **2026-10-09 20:11:24 UTC**.
The [installed schema observation](evidence/learn-test-foundation-installed-schema-2026-10-09.json)
includes the catalog-only readiness report. The earlier
[launch report](evidence/learn-test-readiness-after-release-2026-10-09.json) and
[original catalog](evidence/learn-test-schema-2026-10-09.json) remain historical
snapshots, not current descriptions of the installed foundations.

- 59 public base tables, all with RLS, plus eight restricted launch views.
  The 33 new foundation tables have authenticated SELECT and service-role DML.
  Existing raw communications grants and ingestion policies remain unchanged.
- `customer_cards`, `jobs`, `team_members`, `org_units`, `intelligence_objects`
  and `graph_nodes` now exist. Synthetic signed-in access and company isolation
  passed at 20:12:34 UTC. `interactions` still lacks ordinary-user read authority.
- The nine inspected LEARN scorecard/review/work/Slack setup RPCs remain absent or
  unavailable. Foundation installation does not complete their dependency chain.
- `learn-launch-status` version 1 remains ACTIVE with gateway JWT verification
  and TEST-only metadata mode. Its synthetic redaction, source-denial and authority
  checks passed again after the foundation installation.
- `current_tenant_id()` and `is_openfolk()` now explicitly allow authenticated
  execution; anonymous execution remains denied. Their bodies and source-table
  privileges were preserved. This follow-up repaired the access failure found by
  actual JWT testing; the local verifier now reproduces the original denied grants.
- TEST still uses `of_test_deploy.migrations`, with four retained receipts:
  `openfolk_test_learn_bootstrap_v5`, `learn_launch_metadata_views_v1`,
  `learn_card_work_foundations_v1` and `learn_foundation_helper_access_v1`.
  No standard migration ledger appeared. The original bootstrap source was not
  found in earlier targeted recovery; absence from a checkout or standard ledger
  does not imply an empty environment.

See [foundation source provenance, release checks and real JWT acceptance](LEARN-TEST-FOUNDATIONS.md).
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
