# Reviewed Slack job context on customer cards

Updated 13 October 2026. **SQL and matching capture-proof runtimes are installed in production; scheduled capture is verified and customer-timeline acceptance remains pending.** Frontend validator is live at Git `9b0c581`. One genuine Slack/job review is committed, with source and author preservation verified; its prior capture needs a bounded replay before derived customer display. Two automatically scheduled pages succeeded and retained 36 exact-version proofs by 12:57:50 UTC. No paid AI processing occurred.

[Production evidence](evidence/learn-slack-customer-context-production-2026-10-13.json). The first SQL attempt rolled back with 42501 because the deployment account could not replace the restricted-role-owned reader. The corrected transaction used its existing ADMIN OPTION and restored all original memberships before commit; the same non-superuser role passed the full-schema rehearsal. Reproducible apply/rollback artifacts are in `supabase/release/learn-production-patches/slack-customer-context-v1/`.

A reviewed Slack conversation can already point to a canonical job, but the customer communication reader sees only direct person/company attribution. This change derives customer context through the job's current, reviewed Commusoft ownership. The existing customer timeline receives the retained Slack excerpt. The Slack author is not relabelled as the customer, and communication direction stays unchanged.

## Scope and permissions

- Migration: `supabase/migrations/20261101910000_learn_slack_customer_job_context.sql`.
- `learn_card_slack_job_context(uuid,uuid,uuid)` is a bounded `SECURITY DEFINER` helper granted only to the existing restricted `learn_card_communication_reader` role. It independently checks the actual signed-in owner/admin profile in the requested tenant. There are no new authenticated, anonymous or service-role helper grants, raw reader grants, or RLS policies.
- The existing communication reader retains its owner, caller checks, direct scopes, draft/deletion filters, excerpt limits, ordering and 51-row bound. The frontend checks the optional `job_context` against the requested customer, exact related job, Slack source type and bounded UUID/hash provenance. Malformed or foreign scope fails closed.
- Two append-only, RLS-protected tables retain capture receipts and exact source-version associations. Neither clients nor service role can insert directly.
- One new service-only `slack_commit_attested_page` RPC wraps the existing fenced history/thread commits. It cannot enable a connection, create a job, grant access, alter consent or bypass the existing account, campaign, request-budget, pause, lease or checkpoint checks.
- Existing card/timeline presentation is unchanged. No richer card design is included.

## Source visibility is capture evidence

A C-prefixed channel ID does not prove public visibility. The credential-owning server already requests `conversations.info` during authorised capture. It now retains the explicit core flags and the optional private/DM/shared flags from its last successful observation, together with the exact workspace, channel and connection revision. No additional Slack request is made.

The atomic publication RPC derives the account and scope from the running job or thread approval and validates its claim/attempt and current provider connection. It checks the server's metadata against that scope, then calls the original page commit and records the receipt and its exact retained message-version links in the **same transaction**. A proof insertion failure rolls back the sources, interactions, checkpoint and original commit receipt. Exact uncertain-response replay is idempotent; conflicting replay is rejected. An already committed legacy page cannot acquire proof retrospectively through this RPC.

The receipt proves that this exact saved version was captured under authorised public scope. It has no arbitrary one-hour expiry: archived public history remains usable. It does not claim that the channel is still public today. A later private/DM/shared observation prevents new publication; a new version cannot borrow an older version's receipt. Existing sources without proof require an approved bounded worker replay. No inferred visibility, metadata polling or new schedule is introduced.

The reader requires the exact retained source-version proof and a currently configured, unrevoked Slack connection for the same tenant/workspace. The captured connection revision remains recorded; subsequent credential rotation does not erase the historical capture fact. Private-channel intake and its customer visibility model remain separate unfinished work. DMs stay excluded.

## Customer and job evidence

The canonical job must belong to the tenant and requested customer, carry the exact connection namespace and retained source-version metadata, and have a reviewed provider link matching the unique latest job source. Commusoft must remain configured and unrevoked. Current property, customer source/link/card and canonical ownership must agree. Site jobs also need current site provenance and unchanged customer ownership.

The interaction must have a genuine immutable committed operator review receipt for the exact interaction/job/source version. Its current work-context object must equal that receipt and be reviewed and enriched. Deleted/removed records and channel activity are excluded. Staff attribution and unknown direction are preserved. A stale source or changed ownership withholds the derived association without deleting the source or review history.

One recognised job number is only a candidate hint. In the real source review, the apparent job-13356 candidate was rejected because it was a StockBot summary covering several jobs/customers, including a JN reference. The parser now recognises JN and has a multi-job summary regression test. Canonical job publication does not by itself authorise linking a whole conversation.

## Validation

- 119 Slack transport, request, binding, worker, candidate, frontend reader/card tests pass. They include no-proof failure, private conversion after fetch, connection/revocation checks, exact source scope, reply bounds, rate limits and unchanged provider request caps.
- An isolated complete production-schema restore plus 24 release packages and installed throughput/priority/voicemail-discovery baseline passes customer-context and existing source-reader, draft and operator-context journeys.
- Reader cases cover organisation/individual/site ownership, missing visibility proof, private C-prefixed channels, 30-day-old public capture evidence, revoked Slack/Commusoft connections, changed team/owner/source, foreign tenant, restricted helper ACL and unchanged attribution.
- Actual SQL writer cases cover history/thread commits, exact replay and duplicates, private/DM/shared/missing/stale proof, foreign tenant/claim, rejection of retroactive attestation on legacy pages, and injected proof-write failure rolling back the existing publication.
- Schema application preserves all 1,591,580 existing COPY rows across 396 tables and all seven exported sequences in the restored baseline; both new proof tables start empty. These fingerprints cover the archived baseline, not a claim about unchanged live counts while capture continues.
- All fixtures run in isolated database clones and roll back. No production, TEST or provider changes.

Evidence is in `docs/operations/evidence/learn-slack-customer-job-context-preparation-2026-10-13.json`; private rehearsal reports remain under `.verification-results/slack-customer-context-rehearsal-*`.

## Release order and acceptance

1. Release the backward-compatible frontend validator first. It accepts both the original response and the optional/null new field; old frontend validators reject it.
2. Apply the reviewed SQL with exact current function/ACL guards. Verify existing row fingerprints, original reader owner/grants/policies and empty new proof tables.
3. Publish only the matching `learn-slack-worker` and `platform-worker` closures, preserving other reviewed fixes. Install SQL before runtime: a missing proof RPC fails closed, with no fallback to an unproved write.
4. Verify a normally scheduled approved history/reply page creates matching source-version evidence, with provider request caps and schedules unchanged. Any already retained demonstration source needs a separately bounded authorised replay.
5. Through the existing logged operator review, accept one genuinely unambiguous source-to-job relationship with current canonical customer/job evidence. Verify the existing customer timeline, tenant isolation and unchanged author/direction. Also check direct email/phone/job views.

Rollback restores the previous worker artifacts and communication-reader definition before removing the helper. Retain the additive capture receipts and version associations as evidence; do not delete source data or proof history. Restore SQL before reverting the frontend validator. No new identity, schedule, paid AI or provider write is required.

## Prepared production artifacts

The exact SQL/runtime preparation is retained privately at `.verification-results/production-slack-customer-context-20261013/`. Read-only production checks matched current definitions/ACLs and live Slack worker v3/platform worker v62. Both immutable artifacts compile and reject missing authentication in a networkless boot; only the five Slack proof-path files differ from the live closure. The v62 voicemail repair is preserved.

The production SQL envelope and rollback passed an isolated full-schema rehearsal, including wrong target/digest, prior ACL drift, late failure, original-reader restoration and retained proof storage. The runtime executor requires verified SQL first, checks all function/auth flags and environment digests, preserves schedules and permissions, and stops on an existing uncertain journal. Exact original reader SQL and v3/v62 rollback artifacts are retained. The first schema apply was attempted and PostgreSQL rejected the existing-reader replacement with SQLSTATE 42501: the management `postgres` role has ADMIN OPTION for the restricted owner but neither inheritance nor SET permission. Authoritative readback confirms the entire transaction rolled back: both proof tables and both new functions are absent, and the original reader definition/owner/ACL remain unchanged. The original `apply_pending` journal is retained; it must not be replayed. Runtime has not been deployed.

The revised envelope passed a complete isolated restore rehearsal as the production non-superuser role. It uses the deployer’s existing ADMIN OPTION to add a transaction-only self-grant with INHERIT enabled, ADMIN and SET disabled, immediately before replacing the existing reader. It then revokes only that self-grant, preserving the original `supabase_admin` grant and comparing all memberships before commit. No other principal receives access, and no membership expansion survives commit or rollback. The full rehearsal ran with both session and current user `postgres`, reproduced the original failure, then passed exact application, reader rollback, and failures before grant restoration and before commit. All memberships, original reader ACL, 1,591,580 archived rows and seven sequences were preserved. The earlier superuser rehearsal did not expose this restriction. Existing production package 010 used the same temporary-membership maintenance pattern, with broader SET permission than this proposed repair.
