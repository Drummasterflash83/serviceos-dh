# Customer jobs to check — release review

This outcome adds a Customers tile and “Customers with jobs to check” section to the job-first Home. It groups only saved Commusoft On-hold and Pending jobs with one current source version, one exact current canonical job link, a tenant-matched customer and site, a site owned by that customer and matching the saved Commusoft property ID, and a nonblank customer name. Each job opens the existing exact-version audited detail read. Unmatched jobs remain outside the customer groups and are still visible in the paged job list and operator review queue. Source status does not establish customer impact, cause, responsible person, or a score.

The customer groups lead the detailed work. An optional review of the ten oldest saved On-hold records remains directly above the full paged list, using its existing first page with no extra request. A signed-in LIVE read showed that the oldest records include internal Accounts and office jobs; presenting them as the primary customer work would be misleading. The disclosure labels age as time since verified job creation, never time in the On-hold status, and warns that internal work can appear.

Until a company score has real evidence, the hero calls its numbers “Recorded open work” and explicitly says that saved statuses can include internal work and do not prove customer urgency or the next owner.

The same outcome adds an on-demand OpenFolk review of **all current unlinked On-hold/Pending jobs grouped by exact Commusoft parent customer property ID**. It pages the existing audited operator RPC through the entire attention prefix under one source snapshot, refuses mixed snapshots, duplicates or an incomplete prefix, and leaves the full 296-job-style queue below for Open work. A group is a review workload, not a proposed ServiceOS customer match. Collision and unknown person/company cases still require human review. The frontend never applies a group as a batch.

The MD Money strip and detail now label the saved P&L/A/R date coverage against the last completed UK day. An older pair says more recent accounts have not been verified; a current-day pair is labelled partial. This uses only the existing audited, saved report pair and makes no new QuickBooks request. `node scripts/verify/new-dawn-daily-money-readback.mjs --live-read-only` checks only the exact Drummonds daily policy and run state, without logging report contents, connection secrets or amounts. It can prove whether unattended capture is enabled and whether a day completed; the on-screen date label alone cannot.

The MD Money strip no longer waits for the expensive saved-job page to finish. Once job status totals have settled, a transient job-page timeout cannot hide already verified, dated accounts evidence.

The saved open-job page makes one automatic retry only when its request fails. A malformed response is still rejected and shown as unavailable. This follows a signed-in LIVE first-page failure that loaded on one manual retry; it does not remove the underlying query-timeout risk. The release readback must confirm that the paged job list loads without a manual refresh.

## Release order

1. Confirm the migration file hash and review its authenticated actor, tenant, feature-flag, exact-link and audit checks. Install `20261112220000_new_dawn_customer_blockers_home.sql` on LIVE before the frontend. It creates only one read-only RPC; it does not change jobs, customer links, flags, logins, or provider data.
2. As the authorised OpenFolk operator, read the RPC under an audited Drummonds reason. Confirm the response groups only On-hold/Pending jobs and that its count equals the sum of its groups. Try a wrong tenant and an ordinary unauthorised actor; both must be refused. Do not put customer names or private counts in the public PR.
3. Release the Git frontend and use the signed-in MD preview on desktop and phone. Confirm that linked customer jobs lead the detailed work, while the oldest saved On-hold records open only on request and disclose that they may be internal. Open a customer, then a job; the exact saved detail must load. Confirm that the section clearly excludes unlinked jobs and the Team and score tiles still withhold unsupported claims. The Money strip must say when its saved pair ends before the last completed UK day. In OpenFolk source review, use “Group On-hold and Pending jobs” once; confirm the result is complete for one saved snapshot, displays hold reasons and review actions, and does not claim that a source parent ID is a verified customer match.

If the query times out or a current link changes, the client shows “Linked customer jobs could not be checked”; it must never silently show a partial list. The main job list remains available. Roll back the frontend to the previous verified Git release first if needed. Once no deployed frontend calls it, the database rollback is:

```sql
begin;
drop function if exists public.new_dawn_customer_blockers(uuid,text);
commit;
```

The drop affects only this derived read; saved jobs, links, customers, sites, and audit rows remain intact.

## Verified before release

The exact SQL SHA-256 is `bc99225550f87cc2f585312aa7a1b533bb821f06a1262ce5a0a8071f10074c24`. The LIVE catalog showed the function and ledger absent. `node scripts/verify/new-dawn-customer-blockers-release.mjs --live-rollback-rehearsal` installed the function inside a rolled-back transaction, checked its grants, and confirmed the catalog returned to the original state. The integrated tree passed TypeScript, 16 focused customer/queue/Money/readback tests, and the production build with 48 prebuild tests. The exact read-only daily Money CLI returned only policy/run metadata; it neither enabled capture nor requested reports. The persistent migration and signed-in LIVE check are still pending.

## Chris's five-point signed-in check after release

Use `/client-md` on both desktop and phone, signed in as OpenFolk. This is an audited presentation preview, not a Drummonds staff login.

1. The page starts with jobs needing attention: On hold and Pending counts, a dated saved-source check, and a link into the full paged job list.
2. The money strip says when a newer completed UK day has no verified report. It has a report date and period; net profit appears only in this MD view, and a net A/R credit is not presented as debt.
3. The Customers tile opens “Customers with jobs to check.” Expand one customer and open one job. The customer, site, status, and source time should agree with the saved job detail.
4. The section says that unmatched jobs are excluded; no status is presented as a proven cause, urgency, engineer, or score. The Team tile still says what data is missing.
5. On the phone, the same actions work without horizontal scrolling, clipped buttons, or an operator banner covering the work list. Record any confusing wording or incorrect match before calling the layout accepted.
