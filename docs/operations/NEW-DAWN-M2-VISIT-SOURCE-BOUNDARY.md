# M2 job visits: source capability and private export boundary

The current Commusoft v2 [concept guide](https://developer.commusoft.com/key-concepts-and-relationships-1985291m0)
describes appointments as children of jobs or opportunities. Its published API
navigation has no appointment, diary or technician-visit GET. The documented
[`GET /scheduledActivities`](https://developer.commusoft.com/list-scheduled-activities-31575938e0)
returns manager/office tasks, including callbacks that may carry a job ID. It is
not a technician appointment feed. The documented
[`GET /jobs/{jobID}`](https://developer.commusoft.com/jobs-24695919e0)
provides expected onsite/completion times and current source-user names, but
not appointment records. Neither source can truthfully populate a completed
visit or assign an OpenFolk engineer. No Commusoft provider read is included in
this review.

## Retained Drummonds export audit

The private DH Works archive contains five original Commusoft diary exports
(`FILE-331`–`FILE-335`, dated April 2025–August 2026) and a later normalized
analysis CSV (`FILE-194`). The original `.xls` files are HTML tables, all with
the same 24-column header. Relevant source columns are `Type of Event`,
`Record number`, `Diary Date`, `Engineer Name`, `Time`, and `Engineer Status`.
The normalized CSV has eight additional **derived** analysis columns, including
`Job event flag`, `Completed visit flag`, and `Diary Date parsed`; those are not
Commusoft source authority. The files stay in the private archive and are not
copied into Git.

The aggregate-only local audit of `FILE-194` found 8,889 rows: 5,147 marked
`Job`, with 3,169 distinct nonempty `Record number` strings. Of those job
rows, 3,906 were marked completed by the **derived** analysis flag. A separate comparison
with archived normalized `jobs.csv` found 4,615 `Job` diary rows whose `Record
number` exactly matches an archived `Job number` string. This is useful
candidate linkage, not proof that either field equals the current v2
`GET /jobs/{jobID}` ID under the reviewed LIVE tenant/connection. Repeated
record numbers are expected across diary events and cannot serve as unique
visit IDs. The files contain `Diary Date` and free-text `Time`, but no
timezone-aware start/end column or individual event source ID. The oldest
exported evidence is historical and cannot establish current visit status.

`python3 scripts/commusoft/audit_diary_export.py <private-file>` audits either
the original HTML `.xls` or the normalized CSV locally, emits only schema,
counts, a file hash and explicit hold states, and writes nothing. It does not
print names, job numbers, row content, or a claimed match. Synthetic tests cover
both formats, derived flag isolation, changed headers and size limits.

## Exact next source requirement

Use the existing private `visits` CSV staging contract in
[`NEW-DAWN-M2-JOB-RECORD.md`](NEW-DAWN-M2-JOB-RECORD.md). Request one bounded,
authorised Commusoft appointment/diary export with the following source
fields and provenance:

1. A stable **event-level** appointment/visit ID, plus an explicit parent job
   ID whose equality to v2 `GET /jobs/{jobID}` can be verified on an already
   reviewed tenant/connection job link. Keep the displayed job code as a
   separate string; do not use it as a unique ID.
2. Source visit start/end instants with timezone or a documented source
   timezone conversion rule, source status/cancellation and last-updated time.
   A date-only or free-text slot remains source evidence, not an exact instant.
3. Source engineer/user ID, if present, retained only as a provider reference.
   It does not create a staff login, team assignment or confirmed person.
4. The export time, covered date window, account/connection identity, file
   checksum and field dictionary. The source owner should confirm whether the
   export is complete for that bounded window and how corrections appear.

After the owner provides that source, prepare it outside Git with the existing
CSV tool, then compare one event's parent ID to an exact reviewed job link.
Only then design an immutable, tenant-scoped retention receipt and a held-by-
default operator readback. A client visit card remains off until real source
shape, date semantics and cancellation behavior pass that review. No generic
`scheduledActivities` task is to be relabelled as a visit.

## Current export staging contract

The existing private CSV preparer now accepts a stricter **v2 visit export**
manifest for a current source export. Its exact columns are
`source_record_id,job_id,job_code,starts_at,ends_at,engineer_id,status,cancelled_at,updated_at`.
The first seven legacy columns still parse as historical, unproved v1 evidence.
The two new columns make cancellation and correction times explicit; blank or
unzoned values remain held, never inferred from an export date.

For v2, set `contract` to `commusoft_visit_export/2` and provide
`visit_export` with `source_account_ref`, zoned `covered_from` and `covered_to`,
IANA `source_timezone`, `coverage` (`complete_window` or `partial_window`),
`event_id_semantics` (`event_level_appointment_id`), `job_id_semantics`
(`v2_jobs_id`), `correction_policy` (`same_id_newer_updated_at`,
`full_replacement` or `unknown`), and the SHA-256 of the source field
dictionary. These are **source-owner declarations**, not verified facts. A v2
review always remains held with `export_scope_unverified` until the account,
event ID and parent job relationship are independently checked against an exact
reviewed Drummonds job. Partial windows and unknown correction behavior are
explicit source-field gaps. The export instant must follow the covered window;
events outside that window or updated after export are held for correction. No
real current export has been supplied or staged.

Both CSV CLIs now reject output inside a Git checkout, including a worktree or
symlinked parent; private records can only be written to a separate private
location with file mode `0600`. The terminal still emits only counts and hashes.
