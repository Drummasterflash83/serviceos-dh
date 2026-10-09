# TEST work capture and collection release

Release `007_work_capture_collectors.sql` installed at **21:01:09 UTC on 9 October
2026**. Signed-in synthetic acceptance passed at **21:01:34 UTC**, using the real
card timeline reader, work collection client and performance reader. TEST now has
79 public tables and eight deployment receipts. Production, real staff records,
source communications, stored recordings and provider activity were untouched.
No historical baseline or source backfill ran.

## What is installed

The existing `object_state_history` ledger gains paired before/after snapshots,
transition labels, capture kinds and sequence IDs. A trigger captures each new
intelligence-object insertion or relevant ownership/state/attribute change, including
background service writes. The same transaction preserves the source write and
its capture. A subject-only label edit creates no ownership event. Old history
rows remain unchanged with NULL capture fields; their status labels cannot establish
past ownership. Existing work items receive no invented baseline.

Structured history cannot be edited or removed. Its cascading object reference
also prevents deleting a captured object. A new statement-level guard prevents
truncating the history table, including legacy rows. The explicit baseline RPC is
service-only and was not called by deployment or hosted acceptance. Its documented
coverage starts at the actual baseline time, never at an old created/effective date.

The bounded owner/admin reader verifies capture continuity and current-state
reconciliation. Both work collectors use that reader and retained membership history.
They save an inferred measurement together with an immutable calculation receipt.
The receipt contains source event IDs, coverage, attribution and the calculation
proof. Its actor/member references must belong to the same company. Human review
is separate. Changed requests and duplicate cells return HTTP 409 (`PT409`), with
one winning observation/receipt under concurrent collection.

- `work.recorded_handoffs` counts a change from the selected member to a different
  resolved owner. Member/user aliases for the same person do not count twice.
- `work.owned_item_minutes` adds elapsed ownership intervals across retained work
  items, including waiting and closed states. Concurrent items add independently.
  This is not staff working hours, productivity or calendar-adjusted desk time.

Missing capture or potentially relevant unresolved identity withholds the aggregate
value; it is not silently converted into zero. Existing population/event/proof limits
remain enforced. Collection currently accepts company-wide member policies and
owner/admin callers; staff/team collection permissions and larger resumable
populations are still required.

The bounded RPC and performance receipts are owner/admin-only. Existing direct
same-company SELECT access to the operational history table remains as installed by
the foundation release. That legacy operational access is not a new employee
performance-report permission; it must be considered in the wider staff visibility
review. No communication table grants changed.

## Source provenance and compatibility

Five retained sources supply the release, with full and selected checksums:

- History columns/row guard from the recovered transition migration. The actual
  transition writer is deferred with action registries, authority and endpoint checks.
- Complete forward capture and bounded history reader.
- Handoff receipt table and collector, selecting around its older append replacement
  and older identity resolver.
- The newer identity resolver and elapsed item-minute collector.
- A follow-up for HTTP conflicts, whole-history truncation, actor references and
  explicit temporary-schema-last function search paths.

The installed performance append function changes only its evidence allowlist to
accept `learn_work_measurement_runs`. The earlier HTTP 409 and historical team-period
proof remain byte-for-byte unchanged. This avoids restoring the older handoff source's
current-row membership assumptions. The regular follow-up migration tolerates the
allowlist already being present in a full chronological replay; unexpected writer
or conflict-code contracts fail instead of being rewritten speculatively.

Release SHA-256: `d70e2cab5866488310f0907c203fb11796dc175ad3223640d3a2ecd437f64ff5`.
The manifest lists the two existing affected tables, one new receipt table, sequence,
eight new functions and single modified function. Preflight requires the installed
measurement release and exact pre-capture source definitions. Postflight verifies
all expected functions/tables/sequence privileges, the precise writer extension,
and preservation of every other recorded table/helper/privilege and prior receipt.

## Verification

The offline verifier uses a recorded TEST schema projection in a disposable,
network-isolated PostgreSQL container. It never reads the existing local database
or copies real customer rows. It verifies deployment as the non-superuser release
owner, receipt-failure rollback, unchanged older history/email data, no automatic
baseline, forward capture from real service writes, alias attribution, independent
elapsed-interval totals, partial coverage, role/company restrictions and retention.
Two concurrent database sessions save one observation and one matching receipt.

The hosted **20:58:12–20:58:15 UTC** rehearsal rolled back with unchanged catalog
fingerprints. Installation acknowledged the atomic receipt and exact expected
schema, including the sequence privileges. Twenty-five focused reader/collector/
release-tool tests, main and preview TypeScript checks, and the preview production
build passed. Existing preview bundle warnings remain.

Hosted acceptance created two marked synthetic companies and four Auth users.
The real timeline reader returned three captures for an alias/state change followed
by a transfer; a label-only update left the other object's capture count at one.
The performance reader returned one actual outgoing handoff despite two raw
reference changes, and elapsed time matched an independent SQL sum. Proof retained
closed-state intervals. Concurrent owner/admin collection saved one cell, separate
review confirmed only the selected observation, and an unresolved later identity
withheld value and source watermark. Viewer/foreign-company reads and collection,
View-As writes, same-JWT revoked roles, source deletion and proof deletion were denied.

The run deliberately retains two work items, five capture events, four measurements,
four calculation receipts, one human review, three memberships and four actor/profile
identities, all marked synthetic in TEST. The Auth users were banned, passwords
replaced and roles set to viewer; old JWTs could no longer read performance facts,
reviews or calculation receipts. No retention guard was disabled and no real account
was changed. The fixture manifest contains identities/counts but no credentials.

- [Hosted rehearsal](evidence/learn-test-work-rehearsal-2026-10-09.json)
- [Installation](evidence/learn-test-work-installed-2026-10-09.json)
- [Signed-in acceptance](evidence/learn-test-work-acceptance-2026-10-09.json)
- [Installed catalog](evidence/learn-test-work-installed-schema-2026-10-09.json)

```sh
python3 scripts/verify/learn-foundation-release.py --rules --conflicts --measurements --work
node --test scripts/verify/learn-test-work-*.test.mjs
LEARN_TEST_ALLOW_PROJECT_REF=saatxzwxvdvqevbnskxy \
  node scripts/verify/learn-test-work-acceptance.mjs \
  --retained-synthetic-test --existing-cli-login
```

The hosted acceptance command creates retained TEST evidence and disabled actor
identities intentionally. Earlier release acceptance tools expect earlier exact
schemas and cannot be reused unchanged after release 007.

## Remaining work

[Governed work actions](LEARN-TEST-ACTIONS.md) are now installed in TEST, and their
Edge endpoint passed real signed-in acceptance at 21:29 UTC. The actual card reader
collected a governed handoff once, while canonical capture and actor annotation
remained separate. Release 007's source collectors and definitions were preserved.
Source reconciliation,
communications/job adapters, staff/team visibility, calendars and approved exclusions,
team aggregation, numerical correction workflows, saved assessments and reviewed
reward decisions remain incomplete. There is still no verified TEST frontend
hosting/full browser acceptance and no production LEARN V1 rollout.
