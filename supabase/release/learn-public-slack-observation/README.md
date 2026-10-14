# Retained public Slack learning release

LIVE worker v77 and the exact functions in `manifest.json` are installed. The
tested executable is retained privately, with exact v76 rollback bytes, under
`.verification-results/learn-public-slack-runtime-20261014-1000/`. Deployment and
preservation acceptance is separate from committed real observation receipts.
See `docs/operations/evidence/learn-public-slack-live-2026-10-14.json`.

Only exact retained public, nonshared source versions with capture-time proof and
an unrevoked matching connection qualify. Staff/customer/job identity holds remain
unchanged. Private channels, DMs, withheld and unsupported sources are excluded.
The existing atomic observer checks the same proof again before commit and cannot
execute actions. Reviewed context keeps reserved capacity; newest proven sources
have their own reserve; remaining capacity advances oldest qualifying history.
The ordered candidate scans do not truncate unavailable history before eligibility.

## Readback and ordinary processing

```sh
node scripts/verify/learn-public-slack-live-release.mjs --readback \
  .verification-results/learn-public-slack-runtime-20261014-1000 \
  .verification-results/learn-public-slack-observation-scale-20261014-05 \
  .verification-results/learn-public-slack-live-release-20261014-04
node scripts/verify/learn-public-slack-observation-monitor.mjs \
  .verification-results/learn-public-slack-live-release-20261014-04
```

The first command retrieves the deployed executable and function authority and
checks every earlier source ID/canonical digest. New arrivals are permitted.
Gmail labels/history are mutable provider metadata; bodies, headers and identities
are protected independently. Phone/voicemail transcripts and actual storage or
recording pointers are checked. This does not verify remote audio bytes.

The monitor follows the exact selected IDs through their mapper-2 ledger, observe
job, stored observation and committed receipt. It reports success only with a
succeeded job, observed ledger, company-source/unresolved attribution, original
identity hold and zero actions. Do not manually restart or enqueue from a timeout
or queued status. Read-only counts, source fingerprints and runtime installation
alone do not prove the full history has learned.

## Rehearsal and guarded promotion

```sh
node --test scripts/verify/learn-release-source-preservation.test.mjs
python3 scripts/backup/rehearse_public_slack_observation.py \
  --output .verification-results/<fresh-name> --selection-rows 15000
```

The rehearsal uses the retained native database in a disposable offline container,
checks package target/digest/late-failure guards, full archived row/sequence
preservation, permission invariants, source/visibility rejection, duplicate
delivery and exact rollback/reapply. It exercises the same keyset SQL renderer
against all eleven archived datasets and proves that email body and voicemail
pointer/transcript changes fail the canonical digest checks. Private journals and
IDs/digests must not enter Git; only dated aggregate evidence is publishable.

`learn-public-slack-runtime-prepare.mjs` reconstructs the candidate from original
modules pinned by the throughput manifest, then independently matches the exact
hosted v76 executable. The private source-path map and compiled artefacts survive
the Mac restart. It copies only the three reviewed files onto that original
closure. Never substitute a whole-worktree deployment.

Use `--prepare` with fresh private output before a new promotion. `--deploy`
requires the exact schema/runtime/scale/keyset evidence and creates an exclusive
execution journal before mutation. The schema precedes its matching worker.
Supabase's diagnostic `/read-only` login lacks EXECUTE on service-only functions;
timing therefore uses the existing authorised admin connection inside an explicit
READ ONLY transaction. If the selection gate fails, exact schema rollback occurs
before worker replacement. After an uncertain mutation, inspect the recorded
state and use `--readback`; never rerun a started deployment blindly.

## Rollback limits

The private release directory contains `rollback.ezbr` and the pinned schema
`rollback.sql` in this directory. Runtime rollback uses the original v76 ESZIP
with its retained original entrypoint and false gateway-JWT flag; backend auth
remains secret/service-bound. Schema rollback requires the reviewed project and
source checksum settings and exact installed replacement functions/authority.
Rollback must not delete new jobs, observations, receipts or retained sources.
Queued source-only observations may need a forward repair or review with the old
observer, which requires enriched identity context. Preserve their lineage.

Hosted TEST remains v28 and lacks the original selector prerequisite. This
isolated LIVE package was not installed there. No frontend, capture schedule,
credential destination, provider write or client permission was changed.
