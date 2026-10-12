# Retained Drummonds email-to-card acceptance

This run uses the existing Drummonds TEST tenant and its previously approved,
already-retained email and Slack data. It exercises the goal's source-to-card
processing requirement without another provider import, AI processing, new data
destination, login, grant, schedule or production change.

## Scope and preservation

- Twenty existing emails: nineteen eligible messages and one unsent draft.
- Two existing Slack interactions; their direction is unverified, so identity
  processing must retain explicit review holds rather than fabricate attribution.
- Existing TEST `platform-worker` version 22, hash
  `126ee9d9a672efd3579740380d6fab2e89df15338b9e83d6250b990b1258a072`.
- One `interactions.sync` job restricted to email, followed by one
  `identity.resolve` job, both limited to 23 records with one attempt. Any
  unexpected continuation or existing processing job stops acceptance.
- The paused email input flag also guards retained-source projection. The runner
  temporarily permits this processing, while all mailbox/account capture remains
  paused and TEST has no cron catalogue. Only these two job types are dispatched;
  the existing email-provider continuation remains untouched. The flag is restored
  to paused in the runner's finalization.
- All 198 datasets are fingerprinted. Other tenants and unscoped records must
  remain identical. Existing queue rows and all source, credential, recording,
  capture-setting and account records must remain unchanged. Only the target
  tenant's listed derived records and processing receipts may change.
- The existing graph endpoint is absent in TEST. The identity handler's best-effort
  graph notification therefore does not establish business-graph acceptance.

## Rehearsal and recovery

`scripts/verify/learn-real-retained-card-rehearsal.mjs` executes the actual database
functions inside a rolled-back transaction. It produced nineteen email
interactions and nineteen card updates, and held both Slack interactions for
`direction_unverified`. All 198 datasets matched after rollback. There were no
provider or AI requests; no persistent flag or data change.

The initial worker HTTP request was denied with 403 before claiming its job.
Readback confirmed the exact retained job was queued with zero attempts and no
lease. The recovery path uses the existing `x-serviceos-internal-key` header,
reuses that same job and retains the original preservation baseline and denial.
Its one-use recovery journal prevents a blind repeat. Uncertain dispatch or an
unexpected durable outcome requires inspection, not a fresh run.

## Acceptance limits

A successful bounded run proves processing of the retained sample, not complete
mailbox history, continuous capture, AI understanding or the production release.
The draft must remain stored and absent from customer activity. Slack direction
holds require their own appropriate interpretation; they are not evidence that
Slack history is complete or that internal channel posts are customer emails.
The whole LEARN V1 delivery goal remains open.

## Hosted result — 12 October, 22:08 UTC

The same retained processing job completed nineteen email projections. The
identity worker then committed nineteen card deliveries and explicitly held two
Slack interactions for `direction_unverified`. Its job correctly ended with
`identity_review_required`, rather than claiming complete success. Nineteen source
links, matching person/card relationships, identity receipts and acknowledged
events were verified. One draft remains retained with zero draft interactions.

Only twelve expected derived datasets changed. Other tenants, unscoped data, all
source records and original queue rows were preserved; email capture is paused,
with no running worker. The existing signed-in OpenFolk operator loaded nineteen
customer cards on stable TEST, expanded a card and verified its summary/status/
activity/action fields, with no alert. This is operator-view acceptance; the
customer-facing card journey remains separate.

[Sanitized evidence](evidence/learn-real-email-cards-2026-10-12.json).
