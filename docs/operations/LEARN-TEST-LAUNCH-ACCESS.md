# TEST launch metadata access and acceptance

Status: **installed on hosted TEST, with signed-in synthetic acceptance passed**.
Production remains unchanged. This is the launch-status read surface, not full
LEARN, frontend or provider acceptance.
This addresses the launch-status read gap recorded in
[the TEST readiness audit](LEARN-TEST-READINESS.md). It does not supply missing
card/roster/work tables, deploy functions, enable connectors or change stored data.

## Contract

`supabase/release/learn-test/001_launch_metadata_views.sql` is deliberately outside
the automatic migration directory. It requires the explicit TEST target session
setting, the source checksum, and the recorded bootstrap ledger name, project and SHA-256. An existing
reader role or disabled source RLS aborts the transaction for inspection.

The additive change creates eight security-barrier views owned by a restricted
NOLOGIN, NOINHERIT, NOBYPASSRLS role. No application role receives membership in
that role. The role receives only required source-column privileges. Source RLS
resolves the current authenticated user's profile and permits only that tenant's
owner/admin. Existing source grants, rows and ingestion policies are preserved.
The reader's temporary public-schema CREATE privilege is revoked before commit.
Hosted `postgres` is CREATEROLE/BYPASSRLS but not a superuser. It receives temporary
SET permission for view ownership transfer, with INHERIT disabled. View grants are
configured before ownership transfer; temporary SET permission is then revoked.
PostgreSQL 17's automatic ADMIN-only grant to the role creator remains, with both
INHERIT and SET false. This is accepted only for the existing `postgres` source
owner, granted by `supabase_admin`; application-role memberships remain forbidden.

Authenticated users receive SELECT on the views, with these projections:

| Source | Exposed information |
|---|---|
| Email messages | IDs, tenant, stored timestamp, fixed INBOX/SENT/DRAFT label flags |
| Calls | IDs, tenant, timestamps, provider/linked IDs, direction and duration |
| Recordings | IDs, tenant, stored timestamp and provider/linked IDs |
| Transcripts | IDs, tenant and status; no transcript text |
| Email accounts | Tenant and status; no credentials or account addresses |
| Workspace mailboxes | IDs, tenant, selected flag and status |
| Email/phone sync runs | Tenant, status, type, timestamps, count and redacted error presence |

The email `raw_payload` field is rebuilt from the three fixed labels; the original
JSON never passes through. Sync error prose becomes `[redacted]` while null and
empty remain distinguishable. Recordings' storage paths and audio are not exposed.

## Function configuration

The existing `learn-launch-status` function accepts the server-only environment
setting `LEARN_STATUS_READ_MODE=test_metadata_views` exclusively with
`SUPABASE_URL=https://saatxzwxvdvqevbnskxy.supabase.co`. It maps the fixed eight
source names to `learn_launch_*` views and refuses other names, modes or targets.
It continues to query with the caller's JWT. Service authority is used only by the
existing identity check, never as a data-read fallback.

The handler rejects non-owner/admin callers before starting metadata queries and
rechecks authority after them. An unavailable view remains unavailable, never an
empty count. Voicemail is outside this view contract and remains unknown.
Unset, empty or `existing` mode retains the prior function behavior.

## Local verification

```sh
node --test supabase/functions/learn-launch-status/handler.test.ts \
  supabase/functions/learn-launch-status/read-mode.test.ts
python3 scripts/verify/learn-launch-access.py
```

Fourteen handler/mode tests pass, including wrong targets, owner/admin gating,
unavailable sources, unchanged default mode and no source-table fallback.
The SQL verifier passes with synthetic data in a disposable, network-isolated
cached Supabase Postgres 17 container, without reading any existing database.
It reconstructs the recorded TEST columns, grants and policies for nine tables;
it does **not** restore all constraints, triggers or other functions.

The deployment portion now runs as a non-superuser `postgres` role, matching the
verified hosted capabilities and source-table ownership. SQL assertions cover
tenant isolation, owner/admin access, viewer/anonymous denial,
role revocation, no role membership, blocked source reads/writes, payload/error
redaction, original JSON preservation and unchanged prior policy definitions.
The SQL refuses an unscoped release before any lasting change.

The actual Edge entry point and shared authorization code also pass a local
strict TypeScript check against installed Supabase JS 2.110 types and a minimal
Deno declaration. This is not a Deno check against the pinned 2.45.4 remote module.

## Release history and evidence

### Hosted rehearsal evidence

At **2026-10-09 19:24:52–19:24:54 UTC**, the first reviewed SQL revision was executed on
`saatxzwxvdvqevbnskxy` in a transaction ending in ROLLBACK. The API acknowledged
the final marker confirming the new role and views were absent after rollback.
The post-rehearsal catalog/ledger fingerprint matched the pre-rehearsal fingerprint.
See the [retained result](evidence/learn-test-launch-rehearsal-2026-10-09.json).

The first hosted attempt at 19:19 returned HTTP 400 and left the audited catalog
unchanged ([initial result](evidence/learn-test-launch-rehearsal-initial-2026-10-09.json)).
Read-only inspection established PostgreSQL 17.11 and a non-superuser `postgres`
executor owning all nine source tables. Reproducing those privileges locally
exposed the missing SET permission and ownership/grant ordering, now corrected.
The cached local image also lost its connection for the direct CURRENT_USER role
specifier; the final SQL uses a quoted identifier through PostgreSQL `format('%I',…)`.

`scripts/verify/learn-test-launch-rehearsal.mjs` pins the reviewed source SHA-256,
checks TEST identity/organisation/health and the exact bootstrap ledger, sets
bounded lock/statement timeouts, and replaces COMMIT with ROLLBACK. It performs
one DDL request and a separate post-state audit; errors are never automatically
retried. It uses Supabase's documented [SQL query endpoint](https://supabase.com/docs/reference/api/v1-run-a-query)
for this transactional rehearsal, not its read-only endpoint. No customer-row
mutation, persistent permission change, provider call or API-key retrieval occurs.

The rehearsal command applies only to the not-yet-installed state and now refuses
the installed TEST role/views/receipt:

```sh
LEARN_TEST_ALLOW_PROJECT_REF=saatxzwxvdvqevbnskxy \
  node scripts/verify/learn-test-launch-rehearsal.mjs --rehearse --existing-cli-login
```

Four rehearsal tests cover fixed SQL/checksum, target/organisation rejection,
single-request behavior, error redaction and changed/unavailable post-state.
The isolated verifier executes this same rollback SQL before its persistence and
access assertions. Its final receipt-bearing revision was rehearsed again at
**19:32:08–19:32:09 UTC**, including rollback of the ledger insert
([final rehearsal](evidence/learn-test-launch-release-rehearsal-2026-10-09.json)).

### Persistent TEST release and signed-in acceptance

At **19:32:31 UTC**, `learn-test-launch-release.mjs` installed the views and an
atomic `of_test_deploy.migrations` receipt, `learn_launch_metadata_views_v1`.
The source SHA-256 is `5bbff33c4ece496cd6220a9beb1fc0d70cb31e205f2deaa4a10026e4a3e219aa`.
The runner requires matching project/organisation/health and a successful hosted
rehearsal less than one hour old with the same source and catalog fingerprints.
It performs one write, then verifies the receipt, view contract and preservation
of the old table catalog/policies/bootstrap entry. A repeat inspection returned
`writeAttempted: false`. See [release](evidence/learn-test-launch-release-2026-10-09.json)
and [repeat inspection](evidence/learn-test-launch-release-recheck-2026-10-09.json).

The isolated non-superuser verifier forces a receipt constraint failure and
proves the entire role/view/policy transaction rolls back. Five release-tool tests
cover successful installation, duplicate avoidance, stale/mismatched rehearsal,
unknown outcomes, drift and wrong targets. No blanket migration push was used.

At **19:33:03 UTC**, only `learn-launch-status` was deployed using the saved CLI
login and the explicit TEST project ref. `LEARN_STATUS_READ_MODE` is
`test_metadata_views`; JWT verification remains true. The uploaded source-file
hashes and hosted version/bundle metadata are retained in
[the function record](evidence/learn-test-launch-function-2026-10-09.json).

At **19:38:12 UTC**, real Auth password sign-ins, PostgREST reads and Edge calls
passed using five synthetic users and two synthetic tenants. Acceptance covered
owner/admin counts and recording-family links; viewer/ops, foreign-tenant,
machine-header, missing-JWT and invalid-JWT denial; raw email and transcript read
denial; projected labels and redacted sync errors; and role revocation with the
same still-valid JWT. Unavailable voicemail remained unknown rather than zero.
See [the initial acceptance record](evidence/learn-test-launch-acceptance-initial-2026-10-09.json).
The final cleanup safeguards were verified by a second complete acceptance run
at **19:42:16 UTC**, again passing and removing all fixtures
([final acceptance](evidence/learn-test-launch-acceptance-2026-10-09.json)).

The acceptance tool checks the recorded schema/trigger contract before fixtures,
reuses existing TEST project keys only in memory, creates no project key and sends
no email. It deletes only generated, marked fixtures. Source-row absence is checked
before tenant recovery markers are removed; uncertain creation/cleanup requires
inspection. Passwords and JWTs are never persisted. Cleanup verified absence of
all created users, profiles, tenants, email/call/recording/transcript/sync fixtures.
Normal authentication audit logs may retain synthetic activity.

```sh
LEARN_TEST_ALLOW_PROJECT_REF=saatxzwxvdvqevbnskxy \
  node scripts/verify/learn-test-launch-acceptance.mjs --synthetic-test --existing-cli-login
```

Twenty-three focused audit/rehearsal/release/acceptance-tool tests pass, alongside
the isolated SQL verifier and hosted acceptance. This does not verify actual
customer data, audio playback, provider ingestion, a naturally expired JWT, the
frontend, or the remaining card/work/roster features.

The readiness script now reports both the original direct-read contracts and a
separate `launchMetadata` assessment. It checks exact columns, view options/owner,
column-level grants, reader role capabilities/memberships and source RLS/policies.
Seven focused catalog tests and actual PostgreSQL privilege-drift tests cover
private transcript grants, application membership and malformed/unsafe evidence.
Even a conforming catalog remains `needs_semantic_and_user_verification`.
The original blocked base-table result is not a request for broad source grants.

If a TEST rehearsal fails, disable the candidate endpoint or revoke SELECT on
these new views and retain the evidence. Returning to `existing` mode is only
appropriate where the prior reader was verified; on the currently restricted
TEST schema it would report unavailable. Inspect before retrying a partially
recorded release. No rollback requires deleting communications or recordings.
