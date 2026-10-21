# LIVE open-job reader filter · 21 October 2026

The signed-in MD Home briefly lost its job totals, customer groups and page during a database timeout on 21 October. It recovered without a write. This change is a bounded reader optimisation, not a proven fix for every concurrent timeout. The frontend last-good treatment is in the same PR.

## Exact change

- Project: `tgbnakbxwcqjeimygroz`; migration `20261112230000_new_dawn_open_job_status_filter.sql`, SHA-256 `beb0616c16646124cf34ca5d2ccf0eba827361c5659c9bc5ed72f3aa8f647205`.
- The existing `new_dawn_open_job_page_base` function already excludes rows without an open/pending/on-hold source status after materialising and sorting them. The migration adds the same four raw Commusoft statuses (`Open`, `ongoing`, `pending`, `on_hold`) inside its `open_source` CTE. It changes no source row, job link, score, provider setting, staff access or function grant.
- The exact prior function hash is `6c60217cc018c32a334a26b8851631ac4a56e19b272b5a7dba4ee3b6182a743e`; the candidate hash is `408a51b873f52f48ee5acad60d932b8d2c7ee4d1ba20fb0c8e698a6cb26307f8`. The release checks the prior hash and absent ledger row before a single transaction inserts the exact source and changes the function. A lost response is resolved by readback, never automatic replay.
- `supabase/release/new-dawn-open-job-status-filter/rollback.sql` checks the candidate hash and restores the exact prior function. The migration ledger remains as history if rollback is used.

## Evidence and limits

- A read-only LIVE plan at a pinned 21 October anchor returned the same 41 first-page rows and identical SHA-256 `6c9eb84e63a6e17646c6a81eb12b3b50fe1c006898a16578877bbb35d28cf9d4` for both selections. In one reverse-order warm comparison, the original plan took 723 ms and the filtered plan 525 ms. The original plan wrote 5,553 temporary blocks; the filtered one wrote zero. A prior cold-order comparison favoured the original because of cache warming. These are single-page plans, not a load or every-cursor proof.
- Cumulative `pg_stat_statements` showed 123 Home-page calls with 274 seconds total execution and 452,833 temporary blocks; other read and worker queries were also costly. The statistics do not establish a single cause for the transient incident.
- In a disposable local database, the exact guarded migration produced the candidate hash, the exact ledger-writing release wrote one row with unchanged private grants, a duplicate release was rejected, and rollback restored the prior hash. The actual production state remains unchanged until the reviewed LIVE install.

## Release and readback

Run `node scripts/verify/new-dawn-open-job-status-filter-release.mjs --live-read-only`. After the exact LIVE change is approved, set `NEW_DAWN_OPEN_JOB_FILTER_PROJECT=tgbnakbxwcqjeimygroz` and run `--live-install-exact` once. Then run `--live-installed-read-only` independently and open the signed-in MD Home: totals, confirmed customer groups, first page, next page and navigation back should remain usable with dated evidence. If the install outcome is uncertain, use only the readback; do not retry the write blindly. If a later issue requires rollback, compare the current candidate hash first and run the exact rollback in a separately recorded release.
