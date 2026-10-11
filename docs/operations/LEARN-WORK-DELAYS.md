# Evidenced delay approvals and reversals

Local owner review, backend/API and durable request-recovery candidate, 11 October 2026.
**Not deployed and not connected to working-time card collection.**
The owner screen is verified in the local synthetic browser preview.
TEST remains release 049; production and real
communications/capture are unchanged. This adds the governed exclusion evidence
needed alongside [company calendars](LEARN-WORK-CALENDARS.md).

## What an approval means

An actual company owner/admin can explicitly approve excluding one completed
interval on one work item, with a short label, a reason and selected captured
work-history references. Waiting/blocked states alone never approve exclusions.
An approval is a retained human judgement about that interval, not automatic
proof that its cause was outside a person's control or a decision about pay.

The server verifies the tenant and actual role, refuses View-As and holds the
profile lock against revocation. It locks the work item while the existing
read-only capture reader checks the source. The interval must have continuous
captured history; time before capture began is refused. Every selected evidence
ID must be in that object's returned history for the interval. The original
capture, review interval, label, reason, actor and server timestamp are retained.
No work state, communication, member, measurement or score is changed.

The first evidence contract accepts captured work-history IDs. Linking supporting
emails/calls/provider records directly into this review is not implemented by this
candidate; the owner reason must not be presented as independently corroborated
communication evidence. Existing communication records remain available separately.

## Immutable decisions and recovery

`learn_work_delay_events` contains sequential per-work-item approvals and reversals.
Recording requires the expected latest revision and an exact request ID. Concurrent
same-head decisions yield one next revision; a stale request conflicts. Exact
retries return their original entry even when later decisions exist. A reversal
references an original approval in the same tenant and work item, carries a new
reason/actor/timestamp and cannot be repeated or target another reversal. It does
not delete the approval or its source proof. The original approval interval and
label are copied into its reversal entry for review.

`learn_work_delay_cancellations` retains requests cancelled before recording. Both
recording and resolution share the request lock. A delayed cancelled request is
refused. Cancelling a request that already recorded reports its retained outcome;
it does not reverse an approval. Explicit reversal is a separate owner decision.
Request identity includes tenant, actor, object, expected revision, decision,
interval/approval reference, label, source IDs and reason. Scope or payload changes
cannot reuse an identity. Canonical request construction is shared by both RPCs.

Both tables are immutable, with owner/admin tenant SELECT policies and no direct
client/service writes, deletes or truncation. Four public RPCs are executable only
by authenticated callers and apply the actual-owner gate: `learn_work_delay_record`,
`learn_work_delay_resolve`, `learn_work_delay_read`, `learn_work_delay_evidence`.
Helpers and the collection snapshot reader remain private.

The client outbox has one slot per backend, actor, company and work item, shared by
approvals and reversals. It retains/read-checks the original descriptor before any
RPC, serializes tabs using the caller's Web Lock, checks authority and browser data
across async boundaries and clears only a verified terminal result. Check never
submits; retry uses the original descriptor; cancellation requires a server receipt.
Invalid/unavailable storage, changed authority, conflicting requests and uncertain
replies preserve intent or stop before transmission. This library still needs its
owner screen integration and actual browser acceptance.

## Pagination and calculation snapshots

Review pages contain 100 metadata entries, ordered by revision. The first page
returns a fixed head, and subsequent pages use that same head so newer decisions
cannot appear halfway through a review. Entry count, next cursor, revision sequence,
scope and ordering are validated. Complete original capture is fetched separately
for an exact approval, avoiding a page containing 100 large history payloads.

The private snapshot reader selects non-reversed approvals at its observation time
for an exact work item and completed calculation period. It clips and unions
nested, overlapping and adjacent intervals once, preserving gaps. This must happen
per work item before intersecting with its ownership and published calendar windows;
one item's delay cannot excuse another item's residence. Frozen collection receipts
must retain the snapshot, exact approval references and calendar/ownership evidence.
A later reversal affects new snapshots while existing measurement receipts remain
unchanged; corrected measurements still need the separate human review workflow.

Timestamp identity, snapshot unions and retained capture checks preserve PostgreSQL
microseconds. The existing general timeline/display and pure desk-time calculator
use JavaScript milliseconds; they must not be used to prove sub-millisecond source
coverage. The new approval-proof verifier checks precise boundaries and rejects
an otherwise invisible one-microsecond coverage gap. Future server collection must
retain exact source timestamps and apply its documented numerical precision.

Limits: completed intervals of at most 366 days (2000 through 2200), 1–50 unique
source IDs per approval, 200-character label, 1,000-character reason, 32 KiB request,
2 MiB retained capture, and at most 1,000 active overlapping approvals per item
snapshot. Over-limit snapshots fail explicitly, rather than omit exclusions or
claim a partial set is complete.

## Owner review screen

Each card finding's **Ownership & time on this work** panel includes **Review
approved delays on this work**, available to actual company owners/admins. It
reads original capture timestamps and offers only known intervals. An owner can
select the whole interval or a shorter interval, enter a label and explain the
evidence reviewed. Shortening the end removes the later closing event from the
selected source IDs; the opening record still establishes the state. Current
directory names help identify owners, while captured references remain available.

Saved approvals and reversals use fixed-head server pages of 100, displayed in
groups of 20. New changes and active/reversed status require the complete current
history, including reversals on later pages. Page-read failure preserves earlier
decisions and retries the same cursor. Reversal requires a separate reason and
keeps the approval and its original proof. The proof viewer pages all retained
source events, including exact timestamps, sequence numbers and full recorded
fields.

Approval/reversal recovery persists the exact request before contacting the server.
Reload exposes check, retry and cancel controls. A cancellation after a committed
decision reports that decision; it cannot erase it. Capture-read failure does not
remove recovery or existing review history. Role/tenant/actor/work changes unmount
the review and stop subsequent request steps. Waiting alone is never an exclusion,
and the screen explicitly says working-time collection is still being connected.

## Verified locally

- Offline PostgreSQL 17 schema-only clone, synthetic fixtures, network isolation:
  rollback rehearsal and migration pass. No source rows or credentials are copied.
- Actual captured work → approval → exact retry → reversal → retained proof and
  earlier/current snapshots pass. Foreign/missing evidence, unknown history,
  future intervals, malformed descriptors, stale revisions, changed identities,
  repeated/cross-kind reversals and cancelled late requests are refused.
- Tenant/actor boundaries, owner revocation, View-As, four RPC denials for each
  no-identity role, helper/table privileges and immutable rows pass.
- Actual pagination crosses 100 entries; a later reversal stays outside pages
  pinned to the earlier head. Nested, overlapping, adjacent and disjoint windows
  produce the independently expected union. The 1,001-active-approval case fails
  with an explicit bound error.
- Concurrent database sessions test competing same-head approvals and recording
  versus cancellation for both approvals and reversals. Exactly one stable terminal
  outcome remains per request. Source-history and measurement fingerprints remain
  unchanged afterwards; normal lifecycle checks also preserve calendar/collection
  receipts.
- Actual SQL pages, proof, resolution and snapshots pass the production client
  parsers. Those exclusion windows feed the existing desk-time function: overlapping
  approvals exclude the interval once; the later reversed snapshot excludes none.
- Twenty-seven delay API/outbox tests pass; with calendar, work-history and scorer
  tests, all 72 focused tests pass. Application/preview TypeScript and both builds
  pass, including the 47 required prebuild checks.
- The offline SQL harness was rerun against the UI helpers. Actual SQL capture
  supplies review choices; the client-generated shorter approval is submitted to
  PostgreSQL in a rollback transaction. Its retained proof excludes the closing
  event outside that shorter window. Existing concurrency, access and preservation
  checks also pass.
- Local browser: whole/shorter approval, reversal with retained proof, lost approval
  reply and reload/retry without duplication, lost reversal reply and reload/cancel
  returning the recorded reversal, unrecorded check/cancel, 106-decision history
  with a page-read failure and a reversal beyond page one, proof-read retry,
  unavailable capture, current owner names and viewer restriction pass. No browser
  console errors were observed. These are synthetic checks, not hosted acceptance.

[Owner UI verification record](evidence/learn-work-delay-owner-ui-2026-10-11.json).

```sh
python3 scripts/verify/learn-work-delays.py
node --test src/lib/learn-work-delays.test.ts src/lib/learn-work-delay-outbox.test.ts
npx --no-install tsc --noEmit
```

## Remaining work

1. Connect frozen calendar and delay snapshots to a distinct resumable working-time
   collection contract. Preserve the meanings of existing elapsed-residence and
   handoff observations, and withhold incomplete ownership/calendar history.
2. Prepare a paired, pinned additive TEST release with data/access preservation,
   hosted owner acceptance and separately reviewed production promotion.
