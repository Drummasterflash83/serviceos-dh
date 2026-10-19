# M2 — source-backed job record

The first M2 slice expands the existing, audited Commusoft job-source reader. An
OpenFolk operator can open one retained source job version and see its description,
status, priority, customer reference, property reference, business unit, source
user group, quote text, named customer/site contacts, source completion/closure
users and the recorded created/reported/completed/closed times. The source job ID
remains a string. A historical or ambiguous version is explicitly marked not
current. No provider call, Commusoft write, canonical job link, assignment, score,
invoice or payment assertion is made by this view.

The new fields are returned by `learn_commusoft_job_details` under its existing
tenant/connection and operator review gate. Only fixed, bounded text fields leave
the retained payload. Email, telephone, raw payloads and arbitrary nested fields
remain excluded. The quote is text from the source, not a calculated cost or an
invoice. A source completion user is not an engineer appointment. The client
parser checks the exact v2 envelope, source version and tenant/connection before
display. The SQL verifier exercises rollback, tenant isolation, denied roles,
retained-data preservation and the actual SQL-to-client response.

## Provider capability boundary

Commusoft's [published v2 jobs list](https://developer.commusoft.com/list-jobs-24695917e0)
contains these job fields. Its [concept guide](https://developer.commusoft.com/key-concepts-and-relationships-1985291m0)
distinguishes a job from its technician appointments. The published
[`/scheduledActivities` read](https://developer.commusoft.com/list-scheduled-activities-31575938e0)
is for office tasks, including callbacks associated with jobs; it is **not** a
diary/visit endpoint. The published [`/users` read](https://developer.commusoft.com/list-users-27669355e0)
can identify source users, but a name on a job cannot establish a technician's
appointment or an OpenFolk login. At this checkpoint, Commusoft's published API
navigation does not expose read endpoints for appointments/visits, estimates,
invoices, or parts/costs. These facets remain visibly unavailable rather than
being inferred from job text or QuickBooks records.

The existing capture worker, stored approval and SQL permit gates are intentionally
limited to properties, property contacts and jobs. Extending capture to users or
office tasks requires a separate tenant-scoped import contract, explicit source
identity/relationship handling, rate-limit and continuation tests, and a reviewed
release. Do not add an endpoint to the transport allowlist alone. Before extending
to technician visits or job finance, establish a supported provider endpoint or a
bounded, authorised export and verify its relationship keys. Preserve Commusoft
job codes as strings and only link other providers on exact, evidenced identities.

## Verification

`node --test src/lib/learn-commusoft-job-details.test.ts` and
`tsc --noEmit` pass. The isolated PostgreSQL permission suite
`python3 scripts/verify/learn-commusoft-permits.py --job-details` passes with
the v2 migration applied. This is local release evidence, not LIVE deployment or
real-client acceptance.
