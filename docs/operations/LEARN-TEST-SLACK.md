# TEST Slack storage and setup release — 9 October 2026

Release `learn_slack_storage_setup_v1` installed in TEST at 22:06 UTC with source
SHA-256 `d4b762ace7c9ccecba29890649e40d7e1501aa5f6e1c2b711970fb55368d305e`.
TEST now has 87 public base tables and ten release receipts. Production and its
emails, calls, recordings and connections were not changed.

## Delivered and verified

Seven additive tables provide connector/account configuration, non-secret provider
metadata and audit, retained Slack messages/versions, and import approvals. The
release selects the recovered schema without its original Drummonds Simwood seed.
It creates no tenant configuration, secret, approval, job or provider traffic.
Existing source and queue definitions/privileges are unchanged.

The approval RPC now returns HTTP 409 for changed requests/connections instead of
manual SQLSTATE 40001, which caused PostgREST retry loops in earlier testing. It
takes the existing authority/preview locks before reading owner/admin permission
and refuses repeatable-read snapshots. Controlled concurrent SQL checks verified
both revoke-first and approval-first orderings, with no approval after revocation.

Sources, versions and approvals resist deletion/truncation; provider events are
append-only and connector records are retained through disabled/revoked states.
The page writer is a service-only definer function with a hardened search path,
so publishing a validated page does not require broad direct source/queue grants.
Its existing tenant, claimed-job, account, consent, connection and cursor checks
remain in force. Authenticated clients cannot invoke it or write source facts.

The exact bundle passed a disposable PostgreSQL 17 projection of the recorded TEST
schema, including injected receipt failure, complete rollback, prior catalog
preservation, existing email preservation and actual source/interaction publication.
The exact hosted rehearsal then rolled back successfully with identical catalog
fingerprints before and after. Installation matched the projected seven tables and
three function definitions and preserved the previous releases.

Actual Auth/PostgREST acceptance passed at 22:08 UTC using three synthetic users
across two marked companies. Owner approval and retries produced one approval/job;
changed request identity returned HTTP 409; viewer and foreign owner were denied.
A synthetic page supplied directly to the actual service RPC produced one message,
one retained version, one existing-engine interaction and its checkpoint. A stale
cursor and browser writer were denied; foreign-company reads returned no records.
No Slack token or Vault secret was created or used.

The test job is cancelled, its account/connector disabled and provider metadata
revoked. Synthetic Auth logins were banned/password rotated, roles downgraded and
old-JWT approval access denied. Actors and source evidence remain. Tenant-level
source read policy is unchanged; this does not prove immediate invalidation of all
old JWT reads. Subsequent checks must create new fixtures, not reactivate these.

Forty-seven focused transport/setup/release tests and both TypeScript checks pass.
The disposable full-schema exercise also passes retention and controlled races.
The local real-UI launcher/fixture helpers now validate release 009 before use.

Evidence: [rehearsal](evidence/learn-test-slack-rehearsal-2026-10-09.json),
[installation](evidence/learn-test-slack-installed-2026-10-09.json),
[signed-in acceptance](evidence/learn-test-slack-acceptance-2026-10-09.json),
[final schema](evidence/learn-test-slack-installed-schema-2026-10-09.json).

## Remaining work

This is not a live Slack connection. Vault broker/credential setup and durable
worker/queue deployment remain separate, as do actual workspace authorization and
provider acceptance. No worker is deployed in TEST; only launch status and work
transition endpoints are active. The local transport still supports a bounded
public-channel window and page budget; threads, continuous ingestion, multi-window
historical import and workspace-wide pacing remain necessary for the full input
objective. See [the transport contract and limits](LEARN-SLACK-INGESTION.md).

Reproduce the isolated check with:

```sh
node --test scripts/verify/learn-test-slack-*.test.mjs src/lib/learn-slack-setup.test.ts
python3 scripts/verify/learn-foundation-release.py --rules --conflicts --measurements --work --actions --slack
```

LEARN V1 remains active and incomplete.
