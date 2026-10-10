# Retained Commusoft job details

TEST release 047 was installed at 22:34 UTC on 10 October 2026 after a matching
rollback rehearsal. Its paired protected frontend is READY from Git commit
`e94944bc94573076aeed49f2970e85788a7f239d`. Production is unchanged.
Fresh signed-in hosted owner acceptance remains pending. See
[deployment](../DEPLOYMENT.md) and [release evidence](evidence/learn-job-details-test-2026-10-10.json).

## What the owner can inspect

The existing site/job/contact review now offers **Inspect retained job** beside
each selected source version. The view shows description, source status, priority,
customer reference, source business unit/user group, closure outcome and the
created/reported/completed/closed source dates. It identifies the property reference,
source version and latest observation time for that version. These details improve
visibility of already-captured jobs even when canonical linking remains held.

This is a source inspection, not canonical publication, identity confirmation,
provider coverage, staff assignment or a performance calculation. The existing
review request, linking controls and holds remain unchanged. In particular, an
unzoned completion date still cannot publish a canonical completion instant or
support an elapsed-time score. No new provider request is made.

[Commusoft's official job reference](https://developer.commusoft.com/list-jobs-24695917e0)
includes these source fields and zoned timestamp examples. The actual retained
Drummonds shape audit found unzoned completion values; this reader does not decide
whether they mean UTC or local time. That question remains in the existing unsent
[provider clarification draft](COMMUSOFT-DATA-SHAPE-QUESTIONS-2026-10-10.txt).

## Read and date contracts

`learn_commusoft_job_details(tenant, connection, version)` returns one exact,
observed, retained Commusoft job version. It uses the existing owner/admin review
boundary and OpenFolk module, connector and verified-connection controls. A foreign
company/connection, wrong collection, absent or never-observed version is refused.
A historical or ambiguous latest version stays readable but is explicitly marked
not current. The selected version is never silently substituted.

Only a fixed field list is returned. Raw payloads, contact details, financial
fields, provider links and arbitrary nested properties are excluded. Text is
bounded to 4,000 Unicode characters with an explicit shortening flag. Original
source rows remain intact. The internal date helper has no client execution grant;
anonymous and service callers cannot execute the detail reader.

Dates have four explicit states:

- `absent`: the source field is absent, null or empty.
- `timezone_required`: valid source wall-clock text without a timezone; no instant.
- `invalid`: an invalid date, unsupported value or malformed parent; no instant.
- `zoned`: valid explicit source offset, with its exact UTC equivalent.

PostgreSQL validates calendar dates and preserves microseconds. The client checks
scope, the exact field allowlist, Unicode bounds, date-state consistency and exact
microsecond equality between a zoned source value and its UTC equivalent. Raw
provider errors are not displayed. Failed reads offer retry. Closing/changing the
record scope invalidates pending display updates; refresh clears an earlier result
before fetching it again.

## Verification and release work

- Nineteen focused client tests pass across detail reading, work review recovery
  and source search. Detail checks include private/foreign/malformed responses,
  false UTC claims, microsecond mismatches, invalid calendar dates and Unicode.
- The isolated PostgreSQL verifier runs the existing source publication, linking,
  contact and search suites before the new detail checks. It verifies migration
  rollback, existing function/ACL preservation, owner reads, viewer/foreign denial,
  private helper access, module disable, same-session role revocation, stale and
  ambiguous source versions, date states, Unicode clipping and excluded fields.
- Source versions, canonical jobs, links and projection attempts retain identical
  fingerprints across detail reads. Held jobs remain unpublished. Actual SQL
  output passes the production client parser.
- App and preview TypeScript checks/builds pass; the app includes 47 prebuild checks.
- Actual local browser verification uses only synthetic fixtures. A denied read
  displays retry; retry shows job fields, UTC conversion and separate missing,
  unzoned and invalid states. Changing to sites clears the old job detail.

```sh
node --test src/lib/learn-commusoft-job-details.test.ts src/lib/learn-commusoft-work.test.ts src/lib/learn-commusoft-source-search.test.ts
python3 scripts/verify/learn-commusoft-permits.py --job-details
```

Synthetic preview: `&launch=1&jobDetails=retry`; select its synthetic connection,
then Jobs. `jobDetails=stale` shows the old-version warning. The fixture permits
only read operations and has no hosted/provider traffic.

The exact additive package was rehearsed against the installed 046 catalog, then
installed with identical existing function definitions, ownership and privileges.
All 88 monitored datasets were preserved, including assessment cancellations.
Four hosted HTTP checks confirm anonymous/service-role denial for the reader and
private date helper. Six release guard tests and 28 combined release/continuation
boundary tests passed. The protected frontend targets TEST; all three checked
routes retain Vercel protection, and the actual browser client route redirects to
the same-origin sign-in screen. These checks do not prove a signed-in owner read.

Next: fresh signed-in hosted owner acceptance of detail reading, retry, scope
changes and OpenFolk controls. Do not replay older release packages. The prepared
Commusoft continuation remains awaiting its existing approval, with zero requests
and zero active grants. Only its expected schema fingerprint changed to recognise
047; its identity, duration, request budgets and preservation baseline are unchanged.
