# M2: one reviewed Commusoft job trial while imports run

This is a **staged, default-off** release candidate. Installing
`20261107010000_new_dawn_commusoft_one_job_trial_permit.sql` creates no permit,
changes no feature flag and makes no provider request. The existing
`new_dawn.exact_job_detail` flag controls only the client button; it does not
protect the Edge route. The new database permit protects start and continuation
for **every** exact-job request, including direct Edge calls. Leave both
`new_dawn.exact_job_detail` and `new_dawn.m2_commusoft_coexistence` absent/off
for this trial.

The sole candidate is LIVE Drummonds tenant
`00000000-0000-0000-0000-000000000001`, canonical job
`31c65c2c-1729-4d2c-abcd-7649c7caa894`, reviewed Commusoft source job ID
`13164`, source version `fce709aa-ed65-426f-9de2-9c7edc2d7531`, connection
`87d0d4fa-1097-4a73-80fd-61357edb1e5d`. Treat `13164` as a string and
recheck all four IDs immediately before activation. The retained source was
last observed 13 October 2026 at 16:20 UTC; this is not a fresh provider result.

The release service identity may arm **one** random request UUID for this exact
tenant, job, current source version and a confirmed signed-in OpenFolk operator
ID, for at most ten minutes. The arm RPC rechecks the operator, reviewed link,
latest retained version and connection, and records an audit entry. The request
ID is fixed before arming. The signed-in operator then makes one direct POST to
the existing `learn-commusoft-job-detail` Edge route using that same UUID, job
and tenant, with a reason. The source queue may remain active: only this route's
queue guard accepts the permit. Connection verification and opportunities keep
their existing queue guards. The shared fingerprint lease still serialises the
provider call with the import worker and allows one manual waiter turn.

The permit is consumed on first prepared request. A retry may reuse the **same**
request UUID only while its receipt remains prepared, its actor/source binding
is unchanged and the permit has not expired or been revoked. Another request,
job, actor, tenant or source version is denied. Expiry automatically makes
start/current false, including the post-GET continuation; the service-only
disarm RPC revokes earlier and audits the stop. Neither expiry nor disarm
requires a worker or scheduler. No second permit may be armed for the tenant
while one is active.

Before installing, verify the current LIVE worker and exact-job Edge release,
the successful backup, the exact migration hash/version and source queue/lease
health. Install only this reviewed migration; do not use broad `db push`.
Re-run `new-dawn-m2-exact-trial-preflight.mjs` read-only and confirm the exact
job, source version, connection, actor grant, base input flags and no active
manual receipt. An active import or lease is expected; an unhealthy worker,
unbounded quota wait, changed reviewed link, changed credential, absent operator
or any other manual request is a stop condition. Arm for five minutes and make
at most one GET. If the Edge route returns `waiting`, reuse the same request ID
within the permit deadline; never arm a new one to bypass a wait. Read back the
immutable receipt/audit and worker queue state after completion. Stop and
disarm on 429, provider error, changed authority/source, unexpected worker
backoff, unknown result, expired permit or any missing readback. Do not print
credentials, raw response or private provider logs.

The rollback-only TEST rehearsal
`node scripts/verify/new-dawn-m2-one-job-trial-rehearse.mjs --test-rollback-only`
proves default denial, one exact armed start over an active synthetic source
job, one-use consumption, wrong scope denial, other-route isolation, explicit
revocation and expiry. It leaves no TEST schema/data change and makes zero
provider requests. A successful TEST rehearsal is not a LIVE provider result.
