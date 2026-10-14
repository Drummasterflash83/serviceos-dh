# LEARN worker processing capacity

On 14 October 2026, the normal one-minute worker was claiming three jobs per tick.
Email capture, identity continuation, cards and learning compete for that capacity.
The 05:26 UTC sample showed 30 due Workspace jobs and 39 due ingestion jobs; normal
runs were healthy at the HTTP layer but processing was falling behind arrivals.

The isolated release changes only the worker default from three to ten jobs per
tick. Explicit callers retain the 1–20 bounds, the 300-second claim lease and their
job-type filter. Authentication, capture gates, claims, handlers, operating modes,
schedules and separate Slack/Commusoft dispatchers are unchanged. It enables no
new input, permission, provider scope or paid-AI gate.

## Validation and release

- Separate retained TEST/LIVE source closures were checked file by file. Only the
  default constant changes in each deployed entrypoint. Every other file matches
  that environment's previous release; TEST-only differences remain separate.
- Both exact compiled artifacts passed a network-isolated runtime probe: missing
  authentication makes zero database requests; schedule and service authentication
  work; missing/malformed batch values, lower/upper bounds, fractional values and
  job filters behave correctly; ten synthetic unsupported jobs settle separately.
- TEST v28 and LIVE v76 were published after inventory/preservation checks. Exact
  hosted artifact download matches and missing-auth HTTP requests return 403.
  Source identities and retained Slack revisions, grants, tenant modes, connection
  configuration, schedules, claim/settlement functions and secret metadata match.
- The first normal LIVE tick at 05:43 UTC claimed ten jobs, completing nine and
  retaining one identity review hold. Eight ingestion jobs completed. No manual
  enqueue or restart was used. This is an initial observation, not proof that all
  historical processing is caught up or that sustained throughput is sufficient.
- The two reviewed public Slack messages completed ingestion at 05:31 and 05:38,
  before this deployment; their observation jobs were still queued at 05:43.
  Do not attribute those ingestion completions to this release.

[Exact runtime manifest](../../supabase/release/learn-worker-throughput/runtime.manifest.json)
· [Live evidence](evidence/learn-worker-throughput-live-2026-10-14.json).

## Normal scheduled monitoring

At 05:47 UTC, five consecutive normal ticks had each claimed ten jobs. Four batches
had fully settled: 35 succeeded, four identity review holds and one ineligible
mailbox. The fifth was still processing. Since release, 22 ingestion jobs and 12
Workspace jobs had succeeded; the oldest due ingestion moved from 05:10 to 05:35.
Observation jobs remained queued. Do not describe held identities or ineligible
mailboxes as successful capture. The first four recorded HTTP runs returned 200
in 29–41 seconds; the separate deliberate auth check returned 403. HTTP status
alone does not establish business success. Longer-term capacity remains open.

## Reproduce and rollback

Run `node scripts/verify/learn-worker-throughput-probe.mjs <private-artifact-directory>`
against a directory containing its verified `build.json` and compiled artifacts.
The harness uses the pinned edge image, network none, synthetic data and no host
ports. It records exact artifact/source-closure hashes and removes its container.

The release manifest identifies the prior exact TEST v27 and LIVE v75 ESZIPs,
compression hashes and entrypoints retained outside Git. If runtime failures or
unacceptable load appear, first verify current inventory and retain the current
artifact, then publish the prior runtime as a new version, preserving current
configuration and unrelated function inventory. Read back the artifact and auth
guard, and observe the next existing scheduled tick. Do not reset jobs or data.
There are no SQL, credential or frontend changes to reverse.

## Remaining acceptance

Observe consecutive normal batches and the two reviewed sources through committed
observation receipts with their existing job context, zero executable actions and
source preservation. The older graph-sync handle requires separate diagnosis;
its age alone does not authorise treating it as a failed lease. Broad historical
learning, identity review, customer coverage, scoring and operational acceptance
remain separate open requirements.

## Reviewed-source follow-through

The two reviewed sources subsequently completed their normal observation jobs.
Their committed receipts, current mapper ledgers, unchanged review context and
canonical job graph bindings passed at 2026-10-14T05:50:36.076Z. Both disallow execution and
contain zero action IDs. Source text, versions, speaker and direction are preserved.
This closes the two-source acceptance gate, not broad historical learning.
[Exact acceptance](evidence/learn-reviewed-slack-observations-live-2026-10-14.json).

At 05:50 UTC, eight ten-job batches had settled: 64 successes, eight identity
review holds, six ineligible-mailbox outcomes, one projection review hold and one
mailbox-discovery retry (`db_error`). The retry still needs diagnosis; do not infer
all connector health from the increased throughput. Historical backlog remains.
