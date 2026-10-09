# Existing TEST environment: verified release gaps

Read-only checks on 9 October 2026 reused the saved Supabase CLI and Vercel logins.
No project, deployment, schema, grant, policy, provider configuration, API key or
customer record was created or changed. The Vercel CLI refreshed its existing local
session after a direct request using the old saved access token returned HTTP 403.

## Current evidence

Supabase project listing reports both known projects `ACTIVE_HEALTHY`:

| Environment | Project | Organisation | Region |
|---|---|---|---|
| Openfolk TEST | `saatxzwxvdvqevbnskxy` | `efqvhoxukklewruplpdp` | eu-west-1 |
| ServiceOS production | `tgbnakbxwcqjeimygroz` | `nmhqcjrjrtwsvlcvqqnh` | eu-west-2 |

Only TEST schema catalogs and its deployment ledger were queried. Production
database contents and schema were not queried during this audit.

The latest TEST catalog/function audit is **2026-10-09 19:01:25 UTC**. Its
[retained readiness report](evidence/learn-test-readiness-2026-10-09.json) identifies
the missing prerequisites. The earlier [catalog snapshot](evidence/learn-test-schema-2026-10-09.json)
at 18:57:35 UTC retains table/column definitions, policy expressions and function
signatures; these are schema metadata, not tenant data or credentials.

- 26 public tables; all have RLS enabled. Twenty-one have no policies.
- Of those public tables, only `profiles` has a table-level SELECT grant for
  `authenticated`. The audit also checks column-level SELECT privileges; none
  satisfy the eight-table launch status contract.
- Existing email account/checkpoint/receipt/run policies target
  `email_ingestion_protocol_owner`. They do not establish access for a normal
  signed-in application user. Preserve these policies and their service workflow.
- All required launch-status columns currently exist. The missing read authority
  is separate from schema presence; do not turn unreadable results into zero.
- `customer_cards`, `jobs`, `team_members`, `org_units`, `intelligence_objects`
  and `graph_nodes` are absent. `interactions` exists but lacks the required user
  read authority. The nine inspected LEARN scorecard/review/work/Slack setup RPCs
  are absent or not executable by authenticated users.
- No Edge Functions are deployed in TEST, including `learn-launch-status`.
- TEST uses `of_test_deploy.migrations`; no standard Supabase migration ledger
  appeared in the catalog. Its one retained entry is
  `openfolk_test_learn_bootstrap_v5`, applied **2026-10-04 20:12:22 UTC**. The
  source SHA-256 is preserved in the report. Its source file is absent from this
  checkout, and targeted searches of the older ServiceOS checkout, recovered
  OpenFolk source, Codex worktrees and task temporary files did not locate it.
  Absence from the checkout or standard ledger is not evidence of an empty TEST.

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
Exit zero means the inspection completed; the report remains
`not_release_verified`. Even full catalog presence cannot prove policy semantics,
ordinary-user access, tenant isolation or connector acceptance.

## Concrete release work now required

1. Reconcile the deployed bootstrap and custom ledger. Recover its exact source if
   available; otherwise document the deployed definitions from read-only catalog
   evidence and compare a reviewed reconstruction. Never replay a blanket bootstrap
   merely because the standard migration ledger is absent.
2. Prepare an explicit additive dependency manifest against this partial schema:
   canonical customer/job/roster/graph/work foundations, then the local LEARN
   performance/capture/publication adapters. The successful local schema-clone
   tests used a different, fuller schema and do not establish TEST compatibility.
3. Prepare the minimum intended authenticated read authority while preserving
   existing protocol-role policies. Review column exposure (including raw payload
   and sync error fields) and tenant/role semantics; do not silently substitute
   service-role reads or blanket SELECT grants.
4. Rehearse the candidate against an isolated representation of the actual TEST
   schema, retain a schema/ledger comparison, and test no-JWT, foreign-tenant and
   own-tenant paths with genuine signed-in users. Verify function signatures,
   helper authority and ordinary-user RLS, not just table/function names.
5. Prepare a separate Vercel TEST project/candidate with TEST-only configuration,
   verified included capacity and deployment protection. Rehearse the full product
   build rather than deploying the synthetic browser harness.
6. Finish provider-specific setup and reconciliation: existing Gmail credentials
   with the intended TEST callback/consent, Slack's approved connection/channel,
   Birchills voicemail discovery, Commusoft and vehicle-source mappings. Neither
   project health nor database row counts proves working ingestion.

This is a verified environment map and runnable preflight, not a deployment or
complete LEARN acceptance. No release decision or permission expansion is bundled
into running the audit. The overall LEARN V1 goal remains active.
