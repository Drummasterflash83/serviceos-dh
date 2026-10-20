# Daily Commusoft job-status observations

This slice records **real provider status checks**, one exact `GET /api/v2/jobs/{id}`
for each latest-saved open, pending or on-hold job per London calendar day. It
does not infer time in a status from job creation or from saved source-page time.
The response body is discarded after its status, provider update time and
SHA-256 have been extracted. Source version, connection and day are retained.

## Activation order

1. Apply `20261110210000_new_dawn_daily_job_status_observation.sql` after the
   previous migrations. It creates a private, RLS-enabled ledger and
   service-role-only functions. It creates no flag, schedule or provider request.
2. Deploy the exact `learn-commusoft-worker` revision from this PR. The existing
   unfiltered, one-minute infrastructure tick calls this worker; verify that the
   tick remains enabled and that ordinary source-page capture still succeeds.
3. Enable `new_dawn.daily_job_status.enabled` only for the reviewed Drummonds
   tenant through an audited operator/release action. The existing `learn.enabled`
   and `learn.inputs.commusoft.enabled` flags must also remain On. Without all
   three, the claim function is idle.
4. Observe the first full London-day sweep. Count eligible latest-saved open,
   pending and on-hold jobs separately from `state='observed'` rows in
   `new_dawn_job_status_daily`. Check no active claim is older than 40 seconds,
   no row has eight failed attempts, and provider rate limits have not crowded
   out ordinary source pages. A partial sweep is a failure, not a complete day.

The existing shared credential lease paces all Commusoft routes at no faster
than 1.25 seconds and admits one provider request at a time. The scheduler
invokes at most one exact status read per worker request; failures back off in
the database and uncertain settlements are not reported as success.

## Scoring boundary and rollback

Fourteen **complete, consecutive London calendar days** of provider-observed
status are needed before a minimum time-in-status measure can be published.
If the first complete sweep is 20 October, 3 November is the earliest possible
date. A provider-observed status change resets the lower bound. A missing day,
unknown provider status or partial sweep withholds that measure; it is never
scored as zero. Do not describe `createdOnDateTime` as status age.

To pause provider reads, turn the dedicated flag Off. Retain completed ledger
rows and their audit entries; do not delete or rewrite them. Worker deployment
can be rolled back independently after the flag is Off. No provider write,
staff login or client score is part of this slice.
