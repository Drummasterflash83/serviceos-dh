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

`20261108150000_new_dawn_commusoft_isolated_users_page.sql` adds a separate
operator-requested, one-page `GET /users` route. It requires the default-off
`learn.inputs.commusoft.users.enabled` flag, an explicit tenant and configured
connection, and a reason. The route reads at most 10 source users through the
existing server credential and shared quota lease. It has no source-sync job,
approval, cursor or phase mutation, and takes no manual waiter priority that
would make recurring capture yield. It retains immutable, tenant-bound source
versions and an audit receipt. The held job reference can use these versions,
labelled as an isolated sample, without treating them as complete user coverage
or staff identities.

The original users-page filename had the same `20261107160000` version as the
already published job-closure migration. Its contents are unchanged, but its
filename is now `20261108150000` so the ledger cannot conflate them. The
follow-on release controller in
`scripts/verify/new-dawn-m2-isolated-users-page-release.mjs` pins the source
hash, six pinned ledger prerequisites, the published closure-version
owner, before/after shared-lease and source-user-reference function hashes, the
default-off flags, runtime executable and JWT setting. It reads the active
recurring job's resource plus account/cursor fingerprints without logging the
cursor or source-user payload. It never asks that job to pause or yields its
lease for an isolated sample.

As observed on 20 October 2026, LIVE has the exact older users and shared
lease ledger hashes, and closure owns `20261107160000`. It has one active
recurring `propertyContacts` job and no users flag. The
`20261107130000` source-user-reference ledger/function is absent, so the
isolated SQL gate correctly stops. The prerequisite must be installed and
independently read back through its own reviewed release before running the
isolated installer. No LIVE SQL, Edge deployment, feature flag or Commusoft
request was made for this follow-on.

The exact nine-file SQL chain compiled in TEST with `ROLLBACK`; after the
transaction the candidate tables and function were absent. To repeat that
rehearsal, run:

```sh
node scripts/verify/new-dawn-m2-isolated-users-page-release.mjs --test-rollback-only
```

The local Edge candidate is built with the pinned runtime image by
`new-dawn-m2-users-page-edge-prepare.mjs --prepare-only`; its reviewed source
closure SHA-256 is `367e6d167d638b0e4c8b853fe0d723accbd6c19f311f5d15dce8ac051962909c`,
and compiled transport SHA-256 is
`51958f3b08a5d99b001310760bb320c5493124c3cb89ce6e77aa70f3410149d5`.
The private artifact is ignored by Git. Once the prerequisite passes, the
release operator uses separate read-only, SQL install/readback and Edge
deploy/readback modes; writes require the exact source/artifact hash and an
explicit LIVE project variable. An uncertain SQL or Edge response triggers
one independent readback and no automatic replay. Do not turn on the users
flag or invoke the route as part of installation.

If the SQL transaction fails, it rolls back. After a committed install, leave
the users flag absent and withdraw the Edge endpoint if necessary; preserve
the retained tables, versions and audit history. Confirm the exact ledger and
runtime state independently before any retry or cleanup. The held reference
still reports `source_record_not_captured` when no matching `/users` version
exists. A retained user is a source identity, not proof of an appointment or
visit.

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
