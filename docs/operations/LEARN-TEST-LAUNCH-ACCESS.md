# Proposed TEST launch metadata access

Status: implemented and tested locally; **not applied to hosted TEST or production**.
This addresses the launch-status read gap recorded in
[the TEST readiness audit](LEARN-TEST-READINESS.md). It does not supply missing
card/roster/work tables, deploy functions, enable connectors or change stored data.

## Contract

`supabase/release/learn-test/001_launch_metadata_views.sql` is deliberately outside
the automatic migration directory. It requires the explicit TEST target session
setting and the recorded bootstrap ledger name, project and SHA-256. An existing
reader role or disabled source RLS aborts the transaction for inspection.

The additive change creates eight security-barrier views owned by a restricted
NOLOGIN, NOINHERIT, NOBYPASSRLS role. No application role receives membership in
that role. The role receives only required source-column privileges. Source RLS
resolves the current authenticated user's profile and permits only that tenant's
owner/admin. Existing source grants, rows and ingestion policies are preserved.
The reader's temporary public-schema CREATE privilege is revoked before commit.

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

SQL assertions cover tenant isolation, owner/admin access, viewer/anonymous denial,
role revocation, no role membership, blocked source reads/writes, payload/error
redaction, original JSON preservation and unchanged prior policy definitions.
The SQL refuses an unscoped release before any lasting change.

The actual Edge entry point and shared authorization code also pass a local
strict TypeScript check against installed Supabase JS 2.110 types and a minimal
Deno declaration. This is not a Deno check against the pinned 2.45.4 remote module.

## Remaining release work

Before application, compare fresh TEST definitions and the custom ledger with the
recorded evidence, rehearse the full schema, retain the candidate checksum, and
integrate an additive release receipt with the existing custom migration ledger.
The session setting is an explicit target guard, not independent proof of database
identity; the release runner must verify the actual project and organisation.

Deploy and configure the function only after validating the views, then test real
signed-in owner/admin, viewer, foreign-tenant, expired-token and no-JWT requests
through PostgREST and the Edge endpoint. Verify view-owner privileges and profile
RLS in that environment. No hosted compatibility or full product acceptance is
claimed from the local privilege projection.

The current readiness script assesses direct base-table contracts, not these
views. Its blocked base-table result must not be treated as a request to grant
broad source access. Add a separate view/role/options audit before releasing this
mode; retain the original contract checks for the default reader.

If a TEST rehearsal fails, disable the candidate endpoint or revoke SELECT on
these new views and retain the evidence. Returning to `existing` mode is only
appropriate where the prior reader was verified; on the currently restricted
TEST schema it would report unavailable. Inspect before retrying a partially
recorded release. No rollback requires deleting communications or recordings.
