# Drummonds ongoing Commusoft capture

## Readiness and cadence — 13 October 2026

Initial LIVE properties, jobs, customer contacts and site contacts have completed.
The existing account is active with its last cursor complete. Read-only inspection
found no recurring subscriptions and no active Commusoft source jobs across the
project. The existing `serviceos-worker` cron is active once per minute.

The original dispatcher invoked one page per minute. A 1,552-target customer
contact traversal alone would require more than 24 hours, exceeding its fixed
24-hour stage approval even without failures. Do not enable recurrence while
ignoring this cadence constraint.

The prepared runtime change drains at most ten successful pages per existing tick
within 45 seconds, waiting 1,500 ms between successful settlements. Each request
still goes through the existing dedicated HTTP authentication and SQL claim,
credential permit, scope/expiry, cooldown and atomic page/successor settlement.
Idle ends the sequence; a pause, retry, failure, timeout or uncertain reply ends it
without an automatic resend. Earlier successful pages never conceal a later
failure. A slow or delayed tick cannot start another call after its deadline.
This is a throughput ceiling, not a promise that all ten pages always complete.

Thirteen focused dispatch tests and TypeScript checks passed. The immutable
platform-worker bundle changes only `_shared/learn_input_tick.ts` against LIVE v67;
it booted offline and rejected missing authentication. The reviewed preparation
keeps Commusoft dispatch disabled, preserves other runtime/credentials/schedules
and includes the exact previous runtime for rollback. No schema change is needed.
At this preparation checkpoint the runtime is not deployed and capture is off.

## Activation sequence

1. Checkpoint the source and exact release evidence to GitHub TEST.
2. Publish the exact platform-worker artifact while dispatch remains disabled;
   verify unrelated endpoints, existing input preservation and voicemail controls.
3. Through Chris's existing signed-in OpenFolk controls, approve only Drummonds
   account `46644d30-4780-4855-956a-fabd0bcdd8cc`, connection
   `87d0d4fa-1097-4a73-80fd-61357edb1e5d` (provider account19136): 2,000 pages per
   stage,100records per page. Existing tenant capture switches remain unchanged.
4. Re-read all eligible Commusoft jobs/subscriptions and exact runtime/configuration.
   Refuse activation if unrelated work exists. Change only the existing project
   `LEARN_INPUT_DISPATCH_ENABLED` boolean from false to true, keeping the explicit
   Slack setting, secret values, schedules, access and other settings intact.
5. Observe the existing scheduler through real page capture and all four stage
   completions. Verify watermark advancement, a later fixed incremental cycle,
   deduplication and pause/re-enable preservation. Do not call recurrence accepted
   merely because the first page imports.

The recurring control remains active until paused/revoked and each stage has its
own bounded24-hour scope. The first recurring cycle is a complete traversal;
later job/contact stages use fixed update windows with five-minute overlap.
Captured sources remain separate from canonical customer/contact/job publication,
identity review, changed-source reconciliation and richer card coverage.

## Rollback and recovery

Pause the specific recurring control through the logged operator UI to stop new
capture while preserving receipts/checkpoints. For a dispatch-level incident,
restore only the prior false boolean after verifying the exact configuration.
The saved v67 runtime remains the binary rollback. Never rewind a completed page,
delete source history, force a watermark or retry an uncertain import blindly.
