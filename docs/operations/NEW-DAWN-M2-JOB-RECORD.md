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
client-workspace preview says saved cards are incomplete and may lag Commusoft;
the technical counts stay in this operator handover. Its twelve saved rows
must not be described as the current full workload. The retained job payloads
contained descriptions, statuses and property IDs, but no job-code or
appointment field. The newly displayed quote and completion user remain source
text, never proof of invoice value, payment or engineer attendance.

A second aggregate-only read at **19 October 2026, 14:54 UTC** found **1,004**
reviewed job links and **11,668** unreviewed source jobs. Of the latter,
**11,666** point to a retained customer/site property whose identity has not
been reviewed; **2** have a reviewed parent but no reviewed job link. No job in
this retained population lacked a property ID or parent source. The projection
attempt ledger showed 1,007 successful `linked` outcomes, including replays,
and no recorded held outcome in that aggregate. The gap is primarily the
deliberate customer/site identity review boundary, not a failed automatic job
projection queue. This evidence does not authorize inferring a customer match
or publishing the unreviewed jobs as canonical cards.

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

The follow-on [visit source audit](NEW-DAWN-M2-VISIT-SOURCE-BOUNDARY.md)
inspected archived Drummonds diary exports without copying them into Git. They
have useful job-number and date evidence but no event-level source ID,
timezone-aware start/end fields, or verified equality to the current v2 job ID.
The visit facet therefore remains held under the CSV contract below.

The released capture worker and SQL permit gates cover properties, property
contacts and jobs. The next candidate adds the provider's documented `GET /users`
as an **explicit, opt-in source collection** through those same tenant-scoped
approval, quota, checkpoint and credential gates. The first approval is capped
server-side at one page of ten records. The paired bounded-resume migration
allows a later, separately reasoned continuation of exactly one more page,
still at ten records or fewer, only while the source-user flag is On. It retains
source user IDs and payloads under their original connection without publishing
them as canonical staff: source users are
not OpenFolk staff, account logins, assigned engineers or visits. No user import
is started by installation. The separate
`learn.inputs.commusoft.users.enabled` feature flag is absent by default and
must be explicitly true at approval, credential release and page commit. The
operator choice remains disabled until a separate release review. The existing
Commusoft import flag and active property/job/contact jobs are unchanged. The
documented response has not yet been checked
against a real Drummonds GET; the existing property-contact run was still active
at the 19 October 14:51 UTC read-only check, so a parallel credential request
was intentionally avoided. A bounded, approved one-page GET and source-shape
readback are the LIVE acceptance gate after that run settles. Before extending
to technician visits or job finance, establish a supported provider endpoint or a
bounded, authorised export and verify its relationship keys. Preserve Commusoft
job codes as strings and only link other providers on exact, evidenced identities.

### Exact source-user backend release

The [guarded release script](../../scripts/verify/new-dawn-m2-users-backend-release.mjs)
pins the existing LIVE worker v11 and the two migration files
`20261105180000_commusoft_source_users.sql` and
`20261105190000_commusoft_source_users_resume.sql` by hash. Its LIVE read-only
mode checks the worker version, four authority function hashes and grants, both
missing ledger rows, no active source-sync job, the configured connection and
the absent source-user flag. Download the LIVE worker with the Supabase CLI and
use `--verify-worker-bundle --path <download-directory>` to check its exact
`/users` route and one-page/ten-record cap. Run `--test-rollback-only` against
the isolated TEST database, then repeat the LIVE read-only checks on the merged
commit. Only then run `--live-install-exact --source-sha
bac767a835c1e8c97bc1e90d343cccfb2010893d3188ef04ad65c33610d5e501`
with `NEW_DAWN_M2_USERS_PROJECT=tgbnakbxwcqjeimygroz`. A second
`--live-read-only` must confirm both exact ledger rows and four post-install
hashes. Installation makes no provider request or staff/login assignment, and
leaves the source-user flag Off.

**Do not enable the source-user flag or run the LIVE provider trial while the
installed worker is v11.** That worker rejects a continuation after page one.
The reviewed candidate worker source now enforces the same cumulative
`maxPages = retained pages + 1` boundary as the SQL credential-release gate;
it must be compiled, released, downloaded and independently verified as a new
worker version before the first GET. The v11 pin above verifies only that the
default-OFF backend installer targets the existing baseline. An installed SQL
receipt alone does not make the source-user route ready.

The real one-page trial remains separate. An audited, tenant-only flag change
and saved operator approval permit a maximum of ten source records. Read back
only source counts and held status before any person or engineer matching. If
the first page reports more results, the new resume function, credential gate,
worker and UI allow one more page per explicit reason and check the flag again;
no automatic traversal or multi-page approval is enabled. Continuations are
held after 10,000 retained pages for a separate source review.

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

The additive SQL and Edge route are installed on LIVE. The absent/off
`new_dawn.exact_job_detail` flag hides the UI action but is **not** an Edge/SQL
authorization control. The existing queue guard blocks requests while imports
are active. The staged, default-off
[one-job trial permit](NEW-DAWN-M2-ONE-JOB-TRIAL.md) adds server-side exact
request scope and a short-lived queue exception without enabling tenant-wide
coexistence; it is not installed on LIVE merely by being in Git. A first real GET must
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

The follow-on [private held-facet review](NEW-DAWN-M2-FACET-REVIEW.md) reads the
same bounded CSV and manifest locally, reports row-level source-field and
freshness holds for visits, engineers, estimates, invoices and parts/costs,
and leaves every row unpublished. Its `ready_for_source_review` label is only
syntactic triage, not an accepted job link, visit, staff identity or money fact.

## Held job-context review candidate

`new_dawn_job_context_candidates` is a separate, default-OFF operator read for
one canonical job with exactly one reviewed Commusoft job link. It reads at most
21 already retained interactions to return a page of 20 or fewer from the last
90 days. A phone call, nondraft email or publicly attested Slack message can appear
only when it shares an explicitly reviewed customer person/company identity with
the selected job. Draft email, removed or already job-linked interactions,
withheld Slack and Slack without current public-channel capture proof are
excluded. It returns source IDs, occurrence times and customer-match evidence,
never message bodies or a newly accepted job link. The response labels every
row `job_identity: unverified`, reports source freshness as unverified, and holds
finance because no reviewed Commusoft↔QuickBooks job mapping exists. Multiple
jobs for one customer remain ambiguous. Reads require an audited OpenFolk
operator reason; no flag is inserted, provider called, link written or client
access granted by the migration. The disposable PostgreSQL fixture checks the
default-off gate, rollback, tenant and view-as isolation, source exclusions,
20-row bound and audit. This candidate is **not installed on LIVE**.

## Verification

`node --test src/lib/learn-commusoft-job-details.test.ts` and
`tsc --noEmit` pass. The isolated PostgreSQL permission suite
`python3 scripts/verify/learn-commusoft-permits.py --job-details` passes with
the v2 migration and exact audited source-link reader applied. It exercises
foreign-tenant and unknown-job denial, changed-link withholding, audit, rollback
and the SQL response through the application parser. `node --test
scripts/commusoft/prepare-job-facet-csv.test.mjs` passes the CSV contract.
The exact-source SQL and UI from PR #86 were subsequently merged, and the two
M2 job-detail migrations were installed on LIVE. The release lead verified the
signed-in desktop/mobile exact-source read and two corresponding audit entries.
The **new `/users` candidate is local review work only**: its synthetic
network-isolated fixture proves a one-page source read contract, exact credential
permit, immutable retained page, refusal of an unapproved resource, an absent/off
source-user flag at all three gates and no second credential release. It has not
made a real provider GET or been deployed.
