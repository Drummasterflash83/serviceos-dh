# M2 exact job: source hold, SLA and contract references

This candidate extends the existing, one-use `GET /api/v2/jobs/{jobID}` read.
It does not introduce a collection scan, provider write, staff assignment,
appointment, invoice, cost or score. Commusoft's [official job response](https://developer.commusoft.com/jobs-24695919e0)
documents `isJobOnHold`, `onHoldReasonDescription`, `hasSLA`, `SLAStatus` and
`contractID`. The current public API navigation does not publish a technician
appointment, estimate, invoice or parts/cost read. `scheduledActivities` is an
office task collection, not a visit feed. See the [M2 source boundary](NEW-DAWN-M2-JOB-RECORD.md).

The SQL finish step now retains those five fields in the existing immutable
receipt as `source_operational_facts`, with `present`, `source_null` and
`not_supplied` kept distinct. Booleans remain booleans; the numeric contract ID
is represented as a decimal source string. Wrong types and oversized values
reject the response. The result is version 2; the client can still parse prior
version 1 receipts. The signed-in operator job detail labels these as Commusoft
facts, shows an on-hold value even when false, and does not promote contract ID
to a verified OpenFolk maintenance contract. Provider update time, checked time,
source version, exact job ID and audit ID remain attached to the existing read.

## Default-off release boundary

Installation of migration `20261107110000` and Edge route code makes **no**
provider request or client publication. `new_dawn.exact_job_detail` remains OFF;
the broad coexistence and source-job client-home flags remain OFF. A later
source check, if reviewed, must use a fresh five-minute one-use permit for the
same reviewed Drummonds canonical job, current source version, existing
connection and OpenFolk operator. The existing server-side queue, actor,
tenant, connection, source-version, lease and quota checks remain in force.
Do not enable a broad flag to obtain the read. The previous one-use permit was
disarmed and cannot be reused.

Before release, run the focused Node tests, `npx tsc --noEmit`, `npm run build`
and `node scripts/verify/new-dawn-m2-operational-facts-rehearse.mjs
--test-rollback-only`. The last command applies both exact-detail SQL sources
and synthetic cases inside one TEST transaction, then checks the entire
transaction rolled back. It makes no Commusoft request. Install the additive SQL
first, then deploy the matching Edge source and frontend while the one-job
permit remains disarmed. Verify migration hash and Edge source version. If either
step cannot be confirmed, stop before arming a trial.

For a later exact LIVE readback, check an operator-signed-in response for
`commusoft-exact-job-detail/2`, the exact tenant/job/source-version/connection,
one completed immutable receipt with response hash, four expected audit events
for arm/request/complete/disarm, and explicit source states for all five fields.
Compare only the returned presence/type and expected source fields; do not infer
that an absent hold reason means no hold. Re-read that the one-use permit is
disarmed, broad flags are OFF and ordinary Commusoft work is healthy. A source
response that lacks a field is a valid `not_supplied` observation, not proof of
its business absence. No further provider GET is part of this PR.

## Validation at candidate preparation

- 12 focused Edge/client tests passed; TypeScript and frontend build passed.
- Synthetic rollback-only TEST SQL fixture passed, including wrong provider ID,
  wrong hold type, absent/null/false distinction, queue and authority checks,
  immutable receipt and rollback.
- No provider request, LIVE migration, release flag change or client publication
  was made by this candidate.
