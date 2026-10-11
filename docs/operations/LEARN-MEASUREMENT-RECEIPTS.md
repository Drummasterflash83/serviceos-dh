# Work measurements bound to their retained receipts

Local candidate, 11 October 2026. Not deployed to hosted TEST or production.

The current card assessment reader previously checked measurement scope and
whether its evidence references had allowed table/UUID shapes. It did not read
those calculation receipts before scoring. A same-company receipt for another
person, period or rule revision could therefore be shown as supporting evidence
without checking that it actually matched the observation.

The reader now checks registered work sources against their retained receipts
before loading human reviews and evaluating a score. This covers member handoffs,
member/team elapsed ownership and member/team working-time measures, including the
three legacy collector shapes. It checks exact source, metric, subject, policy
revision, period, observation time, value and coverage counts. Resumable receipts
must also be completed with matching population, processed totals, run identity,
collector kind, unit and source snapshot. Time comparisons retain microseconds.
Unsupported combinations, missing receipts, denied reads, duplicate rows and
truncated responses stop the assessment with an explicit message.

The original source observation and receipt share an identity. A validated manual
numerical correction follows its retained predecessor chain back to that original
observation, so the old calculation is checked against its original value. The
correction does not invent a matching calculation for a new value. A source adapter
correction without a human correction receipt must have its own calculation.

Reads use the signed-in client and existing owner/admin RLS. Receipt summaries
select only required columns and JSON projections, in batches of 100 with exact
counts; full item proofs, rosters and source contents are not fetched to populate
a card. The existing 500-observation history limit remains. The client reader changes no schema, permissions, provider connections, source
records, reviews or stored assessments. The local database continuation below
adds constraints without rewriting retained records.

## Verification

- Nine focused tests cover all eight collector/table shapes, attribution/value/
  coverage mismatches, microsecond boundaries, equivalent timezone representations,
  missing/denied/duplicate/truncated responses, chained numerical corrections,
  unknown versus known-zero values and 500 observations in five batches.
- A test through the actual performance reader proves a mismatched receipt stops
  before human review confirmation can be read. Together with measurement,
  correction, review, scorer and resumable collection tests, 47 tests pass.
- An isolated PostgREST v14.5/PostgreSQL 17 check uses all three receipt table
  shapes and the installed client. Eight synthetic receipts pass via actual JSON
  projections; wrong values and one-microsecond period changes reject. Five GET
  requests make no source changes; fingerprints remain equal and containers are
  removed. This checks transport/types, not hosted authorization or collector SQL.
- Application and preview TypeScript checks and builds pass. The rebuilt local
  browser loads an existing synthetic 250-item completed collection as inferred,
  still unassessed; a deliberate wrong-person receipt hides the assessment and
  reports the mismatch. Returning to the valid fixture restores the observation.
  No console errors were recorded. An initial check used the older preview bundle
  and is excluded from this acceptance evidence.

Run `node --test scripts/learn-measurement-receipts.test.mjs` and
`python3 scripts/verify/learn-measurement-receipts-http.py`.
[Local evidence](evidence/learn-measurement-receipts-local-2026-10-11.json).

## Remaining integration

This guards the current card measurement-read path. Saved assessment snapshots
retain their original reader and are not reclassified or rewritten here. The server-side continuation below now guards new observations, confirmations and
assessment inserts locally. Signed-in hosted transport acceptance, target-schema
rehearsal and the paired release remain to complete.

Receipt agreement does not independently establish every source item's identity,
historical assignment or calculation. Detailed retained item review and source
provenance remain necessary. Communications/job-outcome/driving adapters, complete
provider coverage and real staff acceptance remain outstanding; this checkpoint
establishes no real employee score or pay outcome.

## Database enforcement — local continuation

Migration `20261101160000_learn_measurement_receipt_guards.sql` adds private
receipt validation and three transaction-deferred constraints. They check newly
inserted measurements, new confirmation decisions and new retained assessments.
They preserve the existing append, numerical-correction, review and assessment RPC
identities, definitions and ACLs. No public RPC or additional table access is added.

A transaction cannot commit a registered work observation without its matching
original receipt. Manual corrections follow their separate retained ledger and
validate unchanged attribution, coverage and source time through the original
observation. Checks are deferred because the existing correction RPC inserts its
measurement before the correction ledger within the same transaction. Missing or
forged correction provenance therefore rejects the whole transaction, including
any newly inserted calculation receipt. Chains exceeding 500 entries fail explicitly.

New confirmations require receipt agreement. Disputes remain possible for old
invalid evidence. New assessments verify the retained measurement fields in their
snapshot and validate each work measurement against its original receipt. Existing
mismatched observations and saved snapshots are preserved without edits or invented
repair. Retrying an already-recorded assessment still returns its original receipt;
that does not revalidate the old snapshot under this new constraint.

`python3 scripts/verify/learn-measurement-receipt-guards.py` clones only the existing
local schema into a disposable network-isolated PostgreSQL database. It copies no
source rows, storage, auth credentials or role passwords. Rehearsal/installation
and the real member/team working-time collectors pass, including frozen-source
concurrency checks, 410 paged item results and six full input arithmetic checks.
Real numerical withholding and chained corrections commit successfully.

Nine malformed new-receipt variants fail and roll back all their inserted rows.
A deliberately mismatched pre-migration observation remains unchanged and can be
disputed, but cannot gain confirmation. Prospectively published rules, a new
collection, confirmation and assessment save succeed; exact assessment retry
returns the original. Altered-value and old-mismatched assessment snapshots reject.
All prior measurement rows and existing RPC definitions/ACLs remain unchanged;
anonymous, authenticated and service roles cannot execute the private checker.

[Database verification evidence](evidence/learn-measurement-receipt-guards-local-2026-10-11.json).
This is local integration evidence, not deployment or hosted acceptance.
