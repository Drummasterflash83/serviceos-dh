# M1 source-backed job home: TEST rehearsal

The candidate in PR #142 is **default-off** behind
`new_dawn.source_job_home`. It pages only canonical jobs with one exact reviewed
Commusoft link and a retained observation. It does not promote source-only jobs,
call Commusoft, assign people or publish a score.

On 19 October 2026, `node scripts/verify/new-dawn-m1-source-job-home-rehearse.mjs
--test-rollback-only` compiled the exact migration inside one TEST transaction.
The fixture exercised absent/off flag denial, tenant and anonymous denials,
operator access with an audit row, and the bounded response contract. It then
rolled back. A separate read confirmed that the function was absent and the
source-home flag count and fingerprint matched their preflight values. No
provider request or persistent TEST change occurred.

The qualifying TEST data yielded **one row from one reviewed link**, with an
**18 ms** database-side operator read. The returned row count was within the
24-job cap. TEST had no eligible enabled client owner/admin account for a
positive client-read fixture, so that path was checked statically and by its
negative foreign-actor/anonymous cases, but not accepted end to end. LIVE has
far more reviewed links; the one-row TEST timing cannot prove the 15-second
browser timeout will hold there. Keep the flag off until a representative
performance check and signed-in owner/client acceptance pass. The existing
12-job home remains active while the new flag is absent.
