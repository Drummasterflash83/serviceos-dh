# LEARN observation delivery and recovery

LEARN delivery is restricted to observations, decision/audit records and verified
source graph relationships. It never creates automation actions. The tenant-wide
mode is still recorded truthfully, including its human-review requirements; a
client can use assisted mode elsewhere without blocking this evidence pipeline.

## 14 October release

TEST platform-worker v26 and LIVE v74 contain only the observation-handler change,
relative to their distinct published baselines. The executable, source and rollback
hashes are pinned in `supabase/release/learn-observation-mode/runtime.manifest.json`.
The actual downloaded artifacts match; both hosted missing-auth probes return 403.
No SQL function, grant, tenant mode, policy, schedule or provider configuration was
changed by this runtime release. A retained local compiled rollback can be published
with its original entrypoint and authentication flag, then verified by downloaded
artifact and inventory readback. Do not rebuild all unrelated pending code merely
to revert one handler. Local artifact retention is not an independent backup claim.

Reproduce the isolated native-schema checks with:

```sh
LEARN_WRITE_SYNTHETIC_FIXTURE=1 LEARN_FIXTURE_MODE=assisted node --test supabase/functions/_shared/worker_handlers/learn_observation.test.ts
python3 scripts/backup/rehearse_learn_observation.py --output .verification-results/learn-observation-fresh-rehearsal
```

Use a fresh private output directory. This uses the retained local native archive,
network isolation and synthetic fixtures; it does not change hosted environments.
The ordered first 21 production packages are the exact prerequisites of the original
observation delivery migration. Later unrelated packages are deliberately excluded
from this historical full-schema reproduction; current runtime readback is separate.

## Bounded recovery performed

Four terminal `learn_observation_mode_review` jobs for already-reviewed public
Slack context were recovered in one transaction at 01:11 UTC. Each original parent
is retained unchanged. Its identical payload stays inside the database and is
assigned to one fresh child with `parent_job_id` linkage. Only that unobserved
ledger's job pointer changes; a maintenance event records the batch and reason.
The actor is explicitly automation, never an impersonated operator or Slack author.

The session-local helper in `scripts/operations/learn-observation-mode-recovery.sql`
is a maintenance building block, not a published RPC. It rejects wrong tenants,
changed parents/payloads/sources, already-observed lineage and active competing jobs.
Repeated use of the same child/batch returns that child rather than creating another.
The exact original jobs, child IDs, source/parent hashes and submission journal are
retained privately under `/private/tmp/serviceos-learn-observation-mode-20261014/`.

Observe those exact child handles. Queued/running/retrying is not completion and
must not prompt another recovery. A missing observation after a transient read
failure is not permission to resubmit. Acceptance requires the committed receipt,
observed ledger, matching source and reviewed work context, the correct job graph
node, `can_execute=false`, empty action IDs and no automation intents for its decision.
Preserve failure records and source revisions throughout.

The prepared private cancellation transaction only permits an unstarted queued
child with zero attempts; it retains the child as cancelled and restores the old
ledger pointer. It has not been executed or separately rehearsed. Once a child
starts, inspect its authoritative state and use a forward repair; never delete a
committed observation or reset its source merely to undo this maintenance batch.

## Actual scheduled LIVE acceptance — 14 October, 01:58 UTC

All four original recovery children succeeded on their first attempt between 01:55
and 01:58 UTC. Their ledgers are observed; committed receipts match the source,
reviewed work context, observation and job graph node. Tenant mode is still assisted,
`can_execute=false`, action IDs are empty and no automation intents were created.
Original terminal parents, interaction hashes, identical payloads and audit lineage
remain intact. No repeated recovery or forced restart was used.

The existing signed-in LIVE customer card now displays all four observations and
four evidence links. One link was followed to its dated Slack interaction excerpt
and provenance. These sources date from 2022: their historical requests are not
proof of current outstanding work or ownership. The displayed rule confidence is
explicitly not confirmation of fact. A dedicated original Slack source reader is
still unavailable; the current interaction excerpt is accessible.

The identity-continuation release subsequently preserves this repair in TEST worker
v27 and LIVE v75. The original v26/v74 evidence above remains release history.
[Real-provider and signed-in acceptance](evidence/learn-observation-mode-live-2026-10-14.json).

## Remaining operator work

`retryPlatformJob` in the browser library remains an explicit unimplemented
placeholder. This maintenance recovery does not constitute a functioning operator
retry UI. A durable operator recovery workflow still needs an authenticated,
tenant-selected, logged action with current-source checks, bounded scope and an
idempotent receipt. Do not expose the maintenance helper as a broadly callable RPC.

The four-message acceptance is also not evidence of comprehensive Slack matching,
full history capture, performance scoring or automated recommendations.
