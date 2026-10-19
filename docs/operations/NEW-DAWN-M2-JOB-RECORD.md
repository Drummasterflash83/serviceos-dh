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

## Exact saved-job opening

The operator's job-first preview now opens the **selected canonical job**, rather
than taking a job-labelled button to the generic source browser. The new
`new_dawn_operator_job_source` reader requires a real OpenFolk operator, tenant,
exact canonical job ID and access reason. It looks up only a reviewed Commusoft
job link for that tenant and checks the link's effective source version against
the saved job's source-version metadata. A missing link is shown as unlinked; a
conflict is held for review. Neither case exposes source facts. A valid link
returns the existing bounded source detail with its observation time and current
or stale marker. Each read adds an operator audit record. The separate source
browser remains plainly labelled as a browser, not as that selected job.

At the read-only Drummonds check on **19 October 2026, 14:31 UTC**, 12,672
retained Commusoft jobs had a source observation that day, while only 1,004
canonical jobs existed and their latest update was **16 October 2026**. The
operator preview displays this dated coverage warning. Its twelve saved rows
must not be described as the current full workload. The retained job payloads
contained descriptions, statuses and property IDs, but no job-code or
appointment field. The newly displayed quote and completion user remain source
text, never proof of invoice value, payment or engineer attendance.

## Provider capability boundary

Commusoft's [published v2 jobs list](https://developer.commusoft.com/list-jobs-24695917e0)
contains these job fields. Its [concept guide](https://developer.commusoft.com/key-concepts-and-relationships-1985291m0)
distinguishes a job from its technician appointments. The published
[`/scheduledActivities` read](https://developer.commusoft.com/list-scheduled-activities-31575938e0)
is for office tasks, including callbacks associated with jobs; it is **not** a
diary/visit endpoint. The published [`/users` read](https://developer.commusoft.com/list-users-27669355e0)
can identify source users, but a name on a job cannot establish a technician's
appointment or an OpenFolk login. At this checkpoint, Commusoft's published API
navigation does not expose read endpoints for technician appointments/visits,
estimates, invoices, or parts/costs. Its separate
[opportunities list](https://developer.commusoft.com/list-opportunities-27673943e0)
and [assets list](https://developer.commusoft.com/list-assets-27811309e0)
are potential source collections, but neither is a proven accepted Further Works
quote, engineer visit or job invoice. These facets remain visibly unavailable
until their exact source relationship is verified.

The existing capture worker, stored approval and SQL permit gates are intentionally
limited to properties, property contacts and jobs. Extending capture to users or
office tasks requires a separate tenant-scoped import contract, explicit source
identity/relationship handling, rate-limit and continuation tests, and a reviewed
release. Do not add an endpoint to the transport allowlist alone. Before extending
to technician visits or job finance, establish a supported provider endpoint or a
bounded, authorised export and verify its relationship keys. Preserve Commusoft
job codes as strings and only link other providers on exact, evidenced identities.

## Exact current job detail candidate

Commusoft's documented [GET `/jobs/{jobID}`](https://developer.commusoft.com/jobs-24695919e0)
has fields absent from saved list pages: source pipeline/stage, expected
onsite/completion times and `usersCurrentlyAssignedToJob` entries with numeric
source IDs and names. An aggregate-only LIVE read on 19 October found none of
those keys across 12,759 retained versions covering 12,672 source job IDs. The route
in this branch prepares one operator-reasoned, exact reviewed-link GET for one
canonical job, uses the existing shared Commusoft credential rate gate, and
stores only bounded selected facts plus a response hash. It never updates the
saved card, maps a source user to an OpenFolk staff member or treats an expected
time as a visit. Source quote text remains neither accepted Further Works nor
invoiced or paid money.

The start and continuation predicates both refuse a read while the same tenant
has a `commusoft.source_sync` job queued, running or retrying. The continuation
is checked before the credential is released and after the GET; a scope change
withholds the result. A completed receipt cannot be updated, deleted or
truncated. The rollback-only TEST fixture exercises all three queue states and
these receipt protections.

The additive SQL and Edge route are installed on LIVE, but the UI action is
gated by the absent/off `new_dawn.exact_job_detail` tenant flag. Installation
starts no provider GET, and the queue guard blocks new requests while imports
are active. Keep the flag off until the queue is idle and the signed-in operator
preview is verified. A first real GET must
show the documented response shape, source/as-of labels and audited one-use
receipt in the signed-in operator preview. Wrong ID, lost actor grant, active
view-as, changed source link or missing connection fail closed. Seven focused
TypeScript tests, TypeScript check, build and rollback-only TEST SQL exercise
passed locally; no provider GET was made for this candidate.

## Concrete CSV fallback for unsupported facets

`scripts/commusoft/prepare-job-facet-csv.mjs` prepares a **local, private staging
artifact** from an authorised Commusoft export. It does not contact Commusoft,
publish a card, write to a database or match people. Every run requires a manifest
with exact tenant/connection IDs, source `commusoft_csv`, one facet and an export
timestamp with timezone. The facet must be `visits`, `engineers`, `estimates`,
`invoices` or `parts_costs`. The CSV header must match the selected contract
exactly:

| Facet | Required columns, in order |
| --- | --- |
| Visits | `source_record_id,job_id,job_code,starts_at,ends_at,engineer_id,status` |
| Engineers | `source_record_id,display_name,status` |
| Estimates / invoices | `source_record_id,job_id,job_code,issued_at,status,amount,currency` |
| Parts and costs | `source_record_id,job_id,job_code,description,quantity,amount,currency` |

For example, a private `scope.json` contains:

```json
{
  "tenant_id": "<Drummonds tenant UUID>",
  "connection_id": "<verified Commusoft connection UUID>",
  "source": "commusoft_csv",
  "facet": "visits",
  "exported_at": "2026-10-19T09:00:00Z"
}
```

Run `node scripts/commusoft/prepare-job-facet-csv.mjs --manifest scope.json
--csv visits.csv --out /private/path/visits-staging.json` with an output path
outside the repository. The output file is created once with mode `0600` and
contains the source fields, tenant-scoped record identities, export timestamp,
input hash, date states and row counts. The terminal receives counts and hash,
not row contents. The parser bounds input size and rows, rejects malformed CSV,
duplicate source IDs and wrong headers, and retains all job codes as strings.

`job_id` is the **Commusoft source job ID**, not a type/code. A present ID is
labelled `source_id_present`; it is not linked until a later governed import
checks that exact ID against the same tenant and connection's retained jobs.
Missing IDs are held even if `job_code` looks familiar. Engineer IDs similarly
remain source text without an OpenFolk team assignment. A timestamp without a
timezone is labelled `timezone_required`; no instant or duration is inferred.
Amounts stay source strings and cannot establish paid value or margin. Re-exports
are separately hashed so corrections can be reviewed rather than silently
overwriting earlier evidence. This stage is deliberately separate from LIVE
capture; a real export and import authority still need review before ingestion.

## Verification

`node --test src/lib/learn-commusoft-job-details.test.ts` and
`tsc --noEmit` pass. The isolated PostgreSQL permission suite
`python3 scripts/verify/learn-commusoft-permits.py --job-details` passes with
the v2 migration and exact audited source-link reader applied. It exercises
foreign-tenant and unknown-job denial, changed-link withholding, audit, rollback
and the SQL response through the application parser. `node --test
scripts/commusoft/prepare-job-facet-csv.test.mjs` passes the CSV contract.
This is local release evidence, not LIVE deployment or real-client acceptance.
