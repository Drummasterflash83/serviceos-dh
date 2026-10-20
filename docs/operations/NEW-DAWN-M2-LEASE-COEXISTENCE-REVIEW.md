# Commusoft source/manual coexistence — staged, off by default

This branch prepares one bounded manual Commusoft read to share a credential
with the rolling source worker. It does **not** enable the behavior. The new
`new_dawn.m2_commusoft_coexistence` tenant flag is absent by default, and the
existing queued/running/retrying import guards still reject manual work until
an explicit, separately reviewed flag change. No LIVE migration, Edge release,
provider GET or flag change is part of this PR.

The shared fingerprint gate now labels waits as `lease` or `quota`. A worker
that finds another in-flight reader verifies that no page was published, then
uses `learn_commusoft_yield_job` to requeue the same job within three seconds.
That transition keeps its attempt and error counts unchanged and bypasses the
normal 60-second failure backoff. It is bound to the exact tenant, job, claim
owner, attempt and live job lease; a page or permit prevents yielding. A crash
still leaves the 40-second in-flight lease expiry and the worker's existing
180-second claim recovery. One manual waiter can take one turn before the source
worker resumes.

Each committed source page belongs to a unique job. When more pages remain,
`learn_commusoft_finish_job` creates a distinct successor with `parent_job_id`
pointing to the completed page's job. The page and permit guard therefore
checks the currently claimed page only; a prior page on the parent does not
block yielding the successor. The TEST fixture covers that lineage.

The exact-job route keeps a long lease wait as a prepared request and returns a
bounded `waiting` response with a retry time. Reusing the same request ID
rechecks the actor, current source link, connection, flags and import guard.
Opportunity and connection-verification routes already return a waiting state.
The opt-in `/users` source collection follows the ordinary source-page lease;
its flag remains separate and off unless explicitly enabled.

For a provider 429, exact-job and opportunity reads pass a bounded retry time
to a retained request-specific failure RPC. The RPC extends the shared
fingerprint gate before checking whether the request has since failed or its
authority was revoked. Connection verification already has this behavior.
Only the service role can call these RPCs; raw provider data and keys are not
returned to the client.

Release order, only after separate review: first deploy the updated source
worker, which accepts both the old wait response and the new classified one;
then install unique M2 lease migration `20261106150000`, manual route migration
`20261106160000`, and this migration `20261106180000`; then deploy the updated
exact-job and opportunity Edge routes; finally run a supervised one-read flag
trial. The old `20261106140000` M2 filename must not be installed because
QuickBooks already owns that version in the LIVE migration ledger. An old
Edge release must never be treated as proof of coexistence. Leave the flag off
if any migration, Edge version or verification is uncertain.

An active source worker may briefly requeue the same job when a manual lease
or its one-turn waiter is present. Its row stays `queued` with the same job ID,
checkpoint, attempt budget and error count; it becomes eligible again within
three seconds, subject to the shared lease and quota. No source job is deleted
or replaced by the yield. To roll back an enabled trial, first set the
coexistence flag false so new manual starts are excluded, let any in-flight
read finish or its 40-second lease expire, and leave the lease-aware worker
deployed while queued jobs drain. The database migration itself is additive;
do not remove its columns or functions during active work.

Validation completed on the branch: network-isolated source-user/lease fixture;
rolled-back TEST application of all five relevant migrations, including
synthetic cross-kind contention, owner-only release, default-off flag, bounded
worker yield, late 429 preservation and release of the three manual routes;
focused Node tests for no-provider-read waits, 429 handling and worker yield;
TypeScript check. The TEST transaction left no schema or flag change and made
zero provider requests. A supervised LIVE source/manual overlap and post-release
runtime checks remain necessary before enabling the flag for a tenant.
