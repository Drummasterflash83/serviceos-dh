# New Dawn M2 scheduled-activity source release

This release only installs the one-page, operator-only Commusoft scheduled-activity source probe from merged [PR #226](https://github.com/Drummasterflash83/serviceos-dh/pull/226). Commusoft [defines scheduled activities](https://developer.commusoft.com/list-scheduled-activities-31575938e0) as office/manager tasks. They are **not** engineer diary appointments, verified staff assignments, or OpenFolk work items. The flag `new_dawn.m2_scheduled_activity_probe` stays absent/OFF. No provider request is made by installation.

The release script pins merge `c117ee30c31977a7c361aa6b3d2661d02ea614d5` and the exact migration and three Edge-source file hashes. It gates each step on the current LIVE project, absent/installed schema stage, exact migration ledger source, private grants, route state, and OFF flag. An uncertain write is read back once and never replayed automatically. The Edge readback downloads its executable source and compares its syntax against the pinned sources. It stages only this function and its two shared dependencies; it does not deploy the worker or any other route.

## Current evidence (20 October 2026)

- LIVE exact SQL was installed and its migration-ledger readback passed. The Edge route is v1 `ACTIVE` with the flag still OFF. The installer initially stopped at downloaded-source verification because Supabase CLI used `functions/_shared/...` instead of the previously expected `work/supabase/functions/_shared/...`. The independently saved download at `.verification-results/new-dawn-2026-10-20/scheduled-activity-edge-v1/` passes the corrected full executable-AST verifier for all three pinned source files. The corrected read-only LIVE `--live-readback` passed: Edge v1 hash `1adccdeef1ab07fd35b82a90c71c6e4cd42404d98cfee459bce3e66313ee2acc`, exact pinned source closure, private grants, and OFF flag were confirmed.
- TEST exact SQL transaction: passed and rolled back against `saatxzwxvdvqevbnskxy`; migration ledger, probe tables, functions and flag returned to their prior state. Private RLS/grants were verified within the rolled-back transaction.
- Local release-script tests: four passed, including both known download layouts, ambiguity rejection, and deliberate source mutation. No Commusoft API request was performed.

## Exact commands

Run from the repository root with the saved Supabase CLI login. The TEST rehearsal, LIVE preflight, both LIVE installation commands, and the corrected read-only LIVE readback below have already been run. **Do not rerun either installation command.**

```sh
NEW_DAWN_SCHEDULED_ALLOW_PROJECT=saatxzwxvdvqevbnskxy node scripts/verify/new-dawn-m2-scheduled-activity-release.mjs --test-rollback-only
NEW_DAWN_SCHEDULED_ALLOW_PROJECT=tgbnakbxwcqjeimygroz node scripts/verify/new-dawn-m2-scheduled-activity-release.mjs --live-preflight
```

Recorded install and readback commands are:

```sh
NEW_DAWN_SCHEDULED_ALLOW_PROJECT=tgbnakbxwcqjeimygroz NEW_DAWN_SCHEDULED_SOURCE_SHA=c5d57b4cdbd0c46ffdb1ae3b48c457619ff5ce17593b02ac145c7279931e4ae2 node scripts/verify/new-dawn-m2-scheduled-activity-release.mjs --live-install-sql
NEW_DAWN_SCHEDULED_ALLOW_PROJECT=tgbnakbxwcqjeimygroz NEW_DAWN_SCHEDULED_CLOSURE_SHA=1c29a3c5e1e05b62225d8bad257cdeb432efbf24ea300b8451be175518fadbef node scripts/verify/new-dawn-m2-scheduled-activity-release.mjs --live-install-edge
NEW_DAWN_SCHEDULED_ALLOW_PROJECT=tgbnakbxwcqjeimygroz node scripts/verify/new-dawn-m2-scheduled-activity-release.mjs --live-readback
```

The SQL installer adds only `20261106193000_new_dawn_commusoft_scheduled_activity_probe.sql` and its exact Supabase migration-ledger entry. The Edge installer adds only `learn-commusoft-scheduled-activity-probe`. A missing receipt or mismatched state stops release; never rerun a write after an uncertain outcome without independent inspection. The v1 route has been independently inspected, so the next operation is readback only. Enabling the OFF flag or making a LIVE source read is a distinct, later decision.
