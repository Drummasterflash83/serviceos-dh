# Commusoft shared in-flight lease — first gate slice

This review branch adds a durable, credential-fingerprint lease to the existing
Commusoft request gate. It changes only source-page credential acquisition and
release. It does not enable exact-job or opportunity reads while the source
queue is active: their existing queue guards remain in force. Installing the
migration creates no job, flag, provider request or client action.

`learn_commusoft_acquire_page` still checks the exact tenant, account, connection,
approval, checkpoint, claim, credential and one-per-attempt permit before
releasing a key. It now reserves one 40-second in-flight owner under the same
fingerprint row lock as the 1,250 ms quota gate. The five-second send window and
30-second HTTP deadline bound a worker GET inside that lease. A page commit
releases its own owner in the same transaction as retained evidence; a failed
worker settlement releases it after the HTTP path returns. A crash leaves a
bounded expiry. Release is compare-and-set by owner, so an old completion cannot
clear a successor. A 429 extension to `next_allowed_at` survives lease release.

The helper also records one manual waiter, bounded to 60 seconds. A source worker
must yield one turn to that waiter when it is later connected to an authorised
manual read. The waiter is not yet reachable from the exact-job, opportunity or
connection-verification paths, so this branch does **not** claim safe manual
coexistence. Their current queue guards remain the release boundary. No LIVE
lease migration or provider GET was run during preparation.

Before turning on coexistence, the remaining review must connect every
Commusoft key-release path (`learn_commusoft_verify_acquire`,
`new_dawn_commusoft_job_detail_acquire`, and
`new_dawn_commusoft_opportunity_probe_acquire`) to the same lease and provide
matching finish/fail release. The worker's local lease wait must requeue its
same page without counting a failed attempt or imposing the current 60-second
retry backoff. Only then may a separate default-off coexistence flag narrow the
manual queue guards for one audited, bounded read. Tests must cover all four
flows sharing one key, same key across tenants, lease expiry, wrong-owner and
late release, 429, revoked authority, one-turn fairness, and crash recovery.

The network-isolated PostgreSQL fixture is
`python3 scripts/verify/learn-commusoft-users.py --shared-lease`. It checks
migration rollback, concurrent acquisition, one manual waiter, owner-only
release, expiry, preserved provider deferral, failed-job release, and a complete
synthetic source page with its lease released. No provider credentials or
customer records enter that fixture.
`node scripts/verify/new-dawn-commusoft-shared-lease-rehearse.mjs
--test-rollback-only` also applied the exact migration against TEST inside a
rolled-back transaction and confirmed the gate columns were absent afterward;
it made no provider request.
