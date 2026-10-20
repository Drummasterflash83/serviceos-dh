# M2 held source-user reference and isolated users page

This candidate adds a **read-only OpenFolk operator check** for one reviewed
Commusoft job. It compares source-user IDs in the latest immutable exact-job
detail receipt with separately retained `GET /users` source versions from the
same tenant and connection. The response says whether each source record was
captured and shows both observation times and an audit ID. It does not create an
OpenFolk person, staff login, assignment, technician appointment or visit.

The [published Commusoft user list](https://developer.commusoft.com/list-users-27669355e0)
is a source directory. The [published job read](https://developer.commusoft.com/jobs-24695919e0)
can list source users currently assigned to a job. Neither proves who attended a
visit. The historical Drummonds diary exports also lack stable event IDs and
verified current job links; see [the visit boundary](NEW-DAWN-M2-VISIT-SOURCE-BOUNDARY.md).

`20261107130000_new_dawn_job_source_user_reference.sql` installs an RPC but no
feature flag. It refuses calls unless the tenant's
`new_dawn.m2_source_user_reference` flag is explicitly `true`, the caller has
current OpenFolk operator authority and an access reason, the job has exactly
one current reviewed Commusoft link, and a completed exact-job receipt matches
that source version. It rechecks the actor, flag and job link before the audited
response. The response contains at most 20 source IDs, no raw `/users` payload,
and marks identity and appointment `unverified` on every row. It makes no
provider request or source import. The UI button appears only for an operator
on a current linked job with this flag enabled.

`20261107160000_new_dawn_commusoft_isolated_users_page.sql` adds a separate
operator-requested, one-page `GET /users` route. It requires the default-off
`learn.inputs.commusoft.users.enabled` flag, an explicit tenant and configured
connection, and a reason. The route reads at most 10 source users through the
existing server credential and shared quota lease. It has no source-sync job,
approval, cursor or phase mutation, and takes no manual waiter priority that
would make recurring capture yield. It retains immutable, tenant-bound source
versions and an audit receipt. The held job reference can use these versions,
labelled as an isolated sample, without treating them as complete user coverage
or staff identities.

Release sequence for review: verify the exact source head; install the SQL
chain and Edge route in TEST, then assess a bounded operator trial before any
LIVE promotion. Leave both the reference and users flags absent or false until
that trial is explicitly configured. If no matching `/users` version has been
retained, the reference correctly reports `source_record_not_captured`.

The rollback-only TEST rehearsal is:

```sh
node scripts/verify/new-dawn-m2-source-user-reference-rehearse.mjs --test-rollback-only
```

It creates one synthetic source-user reference inside a transaction, verifies
the absent flag, scoped operator read, unretained source state, audit, foreign
tenant and service-role refusal, then rolls back. It makes zero provider GETs.
The new migration and its six prerequisites also compiled in a single
rollback-only TEST transaction through the existing Supabase management query
tooling. Grants were checked; after rollback, the candidate objects were absent
and the prior function hashes matched. No Commusoft request occurred. This is
SQL compilation, not a real provider or signed-in acceptance test.

To withdraw the candidate, keep both flags absent/false and disable the new
Edge route. Preserve retained evidence; dropping functions after reviewing
callers is a separate cleanup.

**Outstanding M2 coverage:** a retained source user is not an engineer
attendance record. Verified visits, estimates, invoices, parts/costs and
job-cost calculations still require controlled source evidence and exact
tenant/connection/job mapping. No client score or person-specific task may be
inferred from this candidate.
