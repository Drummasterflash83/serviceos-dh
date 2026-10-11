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
a card. The existing 500-observation history limit remains. No schema, permissions,
provider connections, source records, reviews or stored assessments are changed.

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
retain their original reader and are not reclassified or rewritten here. Equivalent
server-side validation at append/assessment save, signed-in hosted transport
acceptance and the paired frontend release remain to complete.

Receipt agreement does not independently establish every source item's identity,
historical assignment or calculation. Detailed retained item review and source
provenance remain necessary. Communications/job-outcome/driving adapters, complete
provider coverage and real staff acceptance remain outstanding; this checkpoint
establishes no real employee score or pay outcome.
