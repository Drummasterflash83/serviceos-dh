# Commusoft source job cards — 16 October 2026

## Working and verified

Chris clarified that Drummonds' income/material codes represent work types and
accounting allocations. Person/company classification is a separate concern.
Unresolved customer identity must not hide retained jobs. No customerType rule or
QuickBooks crosswalk has been inferred from the supplied reference images.

The additive reader is installed and its exact functions, privileges and migration
ledger verified in TEST and LIVE. LIVE readback at 15:31 UTC returns 12,656 retained
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
empty search and honest details failure. LIVE signed-in tenant acceptance now
passes: 295 open-work results, two disjoint
25-card pages, search, missing-source labels and retained job details. Codes `006`
and `001` remain exact text. The first hosted read timed out; a function-local
query-plan repair restored normal reads without raising timeouts or changing grants.

[Timestamped evidence](evidence/learn-commusoft-source-jobs-2026-10-16.json).

Both hosted frontend candidates built successfully, rendered the correct backend,
and were bound to their existing aliases with protection/redirects preserved.
LIVE is `92d937df7d646bfaac6d5de986aeb60d7d3aebbf` /
`dpl_EQn4vTFH6iXMV6conq4nsHM6taSd`; TEST is
`ff501a812d0c6bcedd1c0deacaa7996357f568cc` /
`dpl_5mwS1nGSEKQM9ibBgo3E5QByHSeZ`. Authenticated TEST acceptance is
not established: the saved sign-in was rejected. Chris explicitly directed
verification on LIVE instead; TEST login is not a release blocker.
LIVE operator acceptance also passes with explicit Drummonds selection and reason;
closing review removes the records.

## Needs finishing

Work-category settings and card rules are a separate proposed configuration
feature, not implemented by this reader.
Missing sources and ambiguous canonical identity/contact links remain unresolved.
No score policy is established by this release.

## Release and recovery

Immutable migration `20261104150000_learn_commusoft_source_job_cards.sql`:
`73a5e386e9a37fc33c0e249dd51be44a356ec3ac972cbafe2f8f1e98a2771b7b`.
The additive planner migration `20261104151000_learn_commusoft_source_job_plan.sql`
has SHA-256 `d60f22862c2a41fbad8ab94af5af6e5c00c12a3997d99a24b5ece6f1a0ea8018`.
Its setting is scoped to the private reader and restored when the function exits.
Both migrations are installed and exact-readback verified in both environments.
Do not edit or blindly replay either. TEST uses `of_test_deploy.migrations`; LIVE uses
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

Frontend predecessor rollback: LIVE `dpl_DR3tRETFxNGmCG7DdQLmjDxModpC`
(commit `a123d349d2e33e47a154d1871328c58659fc886f`), TEST
`dpl_7yGQFJ64Xk4e4JTTCH519Y8cWJAs` (commit
`42dbf90c6fd47a5512c8cad73a22dbb387b2a91d`). Rebind only the recorded
existing aliases after checking for a newer release; retain redirects/protection.

## Production Git pointer

Chris explicitly approved aligning `main` with the verified LIVE release.
Remote `main` is verified at `92d937df7d646bfaac6d5de986aeb60d7d3aebbf`.
Vercel's automatic production rebuild `dpl_4ukrhsZCMyPwHRoWWefvwqddx3dy`
is READY and serves all four existing LIVE aliases. At 16:01 UTC each alias
returned HTTP 200 with the LIVE backend and matching assets; the existing root
redirect and deployment protection are preserved. The earlier approval hold is
resolved. The rebuild uses exactly the frontend commit already accepted while
signed in on LIVE; no additional source changes were promoted.
