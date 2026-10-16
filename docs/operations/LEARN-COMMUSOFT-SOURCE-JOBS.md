# Commusoft source job cards — 16 October 2026

## Working and verified

Chris clarified that Drummonds' income/material codes represent work types and
accounting allocations. Person/company classification is a separate concern.
Unresolved customer identity must not hide retained jobs. No customerType rule or
QuickBooks crosswalk has been inferred from the supplied reference images.

The additive reader is installed and its exact functions, privileges and migration
ledger verified in TEST and LIVE. LIVE readback at 15:15 UTC returns 12,656 retained
jobs, including 295 recorded open/pending/on-hold jobs. Of those, 25 reference an
uncaptured immediate customer/site and four have a retained site whose customer
source is missing. The other 266 have the source relationship available. Canonical
reviewed job links remain 1,004 across all statuses; visibility does not create links.
TEST contains 12,611 historical retained jobs, including 282 open-work records;
its real capture remains inactive and is not fresh provider acceptance.

The Jobs card view adds a captured-source option, preserving the existing linked
cards. Operators use explicit client selection, their own identity and an audited
reason through the existing facade. Tenant access reuses current owner/admin
review authority. Each read rechecks authority and records a minimal read audit.
The private helper is not executable by public, anon, authenticated or service_role.
No new business records, identities, scores or provider requests are made.

Cards show exact source text, source status and observation time. Company name and
primary contact are separate. Missing references, missing records and conflicting
observations have distinct states. Source status is not verified progress or
completion. Codes retain leading zeros; source job IDs remain separate identities.

32 focused tests, TypeScript, production build, isolated PostgreSQL authority,
pagination/conflict/preservation checks and real SQL-to-UI parsing passed. Local
synthetic browser checks cover visible unclassified work, leading-zero search,
empty search and honest details failure. This is not hosted acceptance.

[Timestamped evidence](evidence/learn-commusoft-source-jobs-2026-10-16.json).

## Needs finishing

Hosted frontend preview, authenticated TEST/LIVE acceptance and exact frontend
release remain pending at this checkpoint. Work-category settings and card rules
are a separate proposed configuration feature, not implemented by this reader.
Missing sources and ambiguous canonical identity/contact links remain unresolved.
No score policy is established by this release.

## Release and recovery

Immutable migration `20261104150000_learn_commusoft_source_job_cards.sql`:
`73a5e386e9a37fc33c0e249dd51be44a356ec3ac972cbafe2f8f1e98a2771b7b`.
Do not edit or blindly replay it. TEST uses `of_test_deploy.migrations`; LIVE uses
`supabase_migrations.schema_migrations`.

The release tool rehearses the exact baseline in a rolled-back transaction, checks
minimal grants, journals intent and verifies definitions plus ledger after apply.
Private journals and predecessor dispatcher definitions are retained under
`.verification-results/commusoft-source-jobs-20261016/`, excluded from Git.

Frontend rollback can leave the additive reader installed. If backend reversal is
needed, first remove the frontend dependency and compare the current dispatcher
against the installed expected definition. The private rollback SQL restores the
predecessor facade and drops only the two new functions; it does not remove source
or canonical data. Its ledger needs separately reviewed reconciliation before any
future replay. Do not blindly run rollback over a newer dispatcher release.

```sh
node --test src/lib/learn-commusoft-source-jobs.test.ts
python3 scripts/verify/learn-commusoft-source-jobs.py
node scripts/verify/learn-commusoft-source-jobs-release.mjs readback test
node scripts/verify/learn-commusoft-source-jobs-release.mjs readback live
```
