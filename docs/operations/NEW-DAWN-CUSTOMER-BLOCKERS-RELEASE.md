# Customer jobs to check — release review

This outcome adds a Customers tile and “Customers being held up” section to the job-first Home. It groups only saved Commusoft On-hold and Pending jobs with one current source version, one exact current canonical job link, a tenant-matched customer and site, and a nonblank customer name. Each job opens the existing exact-version audited detail read. Unmatched jobs remain outside the customer groups and are still visible in the paged job list and operator review queue. Source status does not establish cause, responsible person, or a score.

## Release order

1. Confirm the migration file hash and review its authenticated actor, tenant, feature-flag, exact-link and audit checks. Install `20261112220000_new_dawn_customer_blockers_home.sql` on LIVE before the frontend. It creates only one read-only RPC; it does not change jobs, customer links, flags, logins, or provider data.
2. As the authorised OpenFolk operator, read the RPC under an audited Drummonds reason. Confirm the response groups only On-hold/Pending jobs and that its count equals the sum of its groups. Try a wrong tenant and an ordinary unauthorised actor; both must be refused. Do not put customer names or private counts in the public PR.
3. Release the Git frontend and use the signed-in MD preview on desktop and phone. Open a customer, then a job; the exact saved detail must load. Confirm that the section clearly excludes unlinked jobs and the Team and score tiles still withhold unsupported claims.

If the query times out or a current link changes, the client shows “Linked customer jobs could not be checked”; it must never silently show a partial list. The main job list remains available. Roll back the frontend to the previous verified Git release first if needed. Once no deployed frontend calls it, the database rollback is:

```sql
begin;
drop function if exists public.new_dawn_customer_blockers(uuid,text);
commit;
```

The drop affects only this derived read; saved jobs, links, customers, sites, and audit rows remain intact.

## Verified before release

The exact SQL SHA-256 is `fa794c6f9a0bfe8e55cfd8d00a8fe1f9fe1dc04846e5a0fac95c9f69557aa3b2`. The LIVE catalog showed the function and ledger absent. `node scripts/verify/new-dawn-customer-blockers-release.mjs --live-rollback-rehearsal` installed the function inside a rolled-back transaction, checked its grants, and confirmed the catalog returned to the original state. TypeScript, the focused decoder tests, and the production build passed. The persistent migration and signed-in LIVE check are still pending.
