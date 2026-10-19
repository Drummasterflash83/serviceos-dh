# M2 held source-user reference

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

Release sequence for review: merge the PR, verify the exact source head and
Vercel deployment, apply this one additive SQL migration to TEST and then LIVE
using the established migration ledger, and verify its hash and definition.
Leave the flag absent or false on both environments. A later controlled
operator trial may enable the flag for Drummonds and read one reviewed job with
an existing exact-detail receipt. If no `/users` page has been retained, the
correct result is `source_record_not_captured`; it does not authorize a `/users`
provider GET. A separate one-page `GET /users` import still needs its own
approved run and remains held from staff projection.

The rollback-only TEST rehearsal is:

```sh
node scripts/verify/new-dawn-m2-source-user-reference-rehearse.mjs --test-rollback-only
```

It creates one synthetic source-user reference inside a transaction, verifies
the absent flag, scoped operator read, unretained source state, audit, foreign
tenant and service-role refusal, then rolls back. It makes zero provider GETs.
To withdraw the candidate, leave the flag absent/false; no data removal is
needed. Dropping the RPC after reviewing callers is a separate cleanup.

**Outstanding M2 coverage:** a retained source user is not an engineer
attendance record. Verified visits, estimates, invoices, parts/costs and
job-cost calculations still require controlled source evidence and exact
tenant/connection/job mapping. No client score or person-specific task may be
inferred from this candidate.
