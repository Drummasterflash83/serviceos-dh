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

Before release, run the focused Node tests, `npx tsc --noEmit` and `npm run
build`. Rehearse the SQL with `node scripts/verify/new-dawn-m2-operational-facts-rehearse.mjs
--test-rollback-only`. It applies both exact-detail SQL sources and synthetic
cases inside one TEST transaction, then checks that transaction rolled back.
It makes no Commusoft request.

The exact migration installer pins SHA-256
`e82c5faf833818ef9d58f5117137cbc48a37357b57b9066f4b4a958f95db6707`.
It checks the LIVE project, the one-job permit migration receipt, the existing
exact-detail function version, absent candidate ledger row, zero active one-job
permits and both broad flags OFF. It installs only `20261107110000`, saves its
exact source in the Supabase migration ledger, and independently reads the v2
function and ledger back. An uncertain write is **never replayed**. The original
exact-detail function is installed on LIVE but its historical
`20261106120000` migration has no Supabase ledger row. The release therefore
checks the actual function definition for v1 and the later permit's exact
ledger identity; it does not invent or backfill the missing historical receipt.

The reviewed commands are:

```sh
NEW_DAWN_M2_ALLOW_PROJECT=tgbnakbxwcqjeimygroz node scripts/verify/new-dawn-m2-operational-facts-release.mjs --live-read-only
NEW_DAWN_M2_ALLOW_PROJECT=tgbnakbxwcqjeimygroz node scripts/verify/new-dawn-m2-operational-facts-release.mjs --live-install-exact
NEW_DAWN_M2_ALLOW_PROJECT=tgbnakbxwcqjeimygroz node scripts/verify/new-dawn-m2-operational-facts-release.mjs --live-read-only
```

The middle command is a LIVE SQL write and is **not part of this PR's candidate
testing**. Run it only after the release lead reviews this exact source and
preflight. Then deploy the matching Edge source and frontend while the permit
remains disarmed; verify their deployed versions before considering a later
one-job provider check. If any step cannot be confirmed, stop before arming a
trial.

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
- Exact LIVE installer unit tests pass for the pinned source hash, preflight,
  readback and uncertain-write no-replay behavior. Its LIVE install mode was not run.
- The LIVE read-only preflight returned `exact_operational_sql_ready` for
  `20261107110000`, with zero active permits, zero broad flags enabled and no
  provider request. It checked the permit's existing ledger source byte for
  byte against its reviewed file.
- No provider request, LIVE migration, release flag change or client publication
  was made by this candidate.
