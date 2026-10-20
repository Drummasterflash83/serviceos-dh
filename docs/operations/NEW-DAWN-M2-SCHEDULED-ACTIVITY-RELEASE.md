# New Dawn M2 scheduled-activity source release

This release only installs the one-page, operator-only Commusoft scheduled-activity source probe from merged [PR #226](https://github.com/Drummasterflash83/serviceos-dh/pull/226). Commusoft [defines scheduled activities](https://developer.commusoft.com/list-scheduled-activities-31575938e0) as office/manager tasks. They are **not** engineer diary appointments, verified staff assignments, or OpenFolk work items. The flag `new_dawn.m2_scheduled_activity_probe` stays absent/OFF. No provider request is made by installation.

The release script pins merge `c117ee30c31977a7c361aa6b3d2661d02ea614d5` and the exact migration and three Edge-source file hashes. It gates each step on the current LIVE project, absent/installed schema stage, exact migration ledger source, private grants, route state, and OFF flag. An uncertain write is read back once and never replayed automatically. The Edge readback downloads its executable source and compares its syntax against the pinned sources. It stages only this function and its two shared dependencies; it does not deploy the worker or any other route.

## Current evidence (20 October 2026)

- LIVE read-only preflight: `state=absent`, project `tgbnakbxwcqjeimygroz`, flag OFF, route absent, zero provider requests.
- TEST exact SQL transaction: passed and rolled back against `saatxzwxvdvqevbnskxy`; migration ledger, probe tables, functions and flag returned to their prior state. Private RLS/grants were verified within the rolled-back transaction.
- Local release-script tests: three passed. No LIVE installation or Commusoft API request was performed.

## Exact commands

Run from the repository root with the saved Supabase CLI login. Inspect each output before the next command. **Only the first two commands below have been run in this preparation; the LIVE install commands remain pending.**

```sh
NEW_DAWN_SCHEDULED_ALLOW_PROJECT=saatxzwxvdvqevbnskxy node scripts/verify/new-dawn-m2-scheduled-activity-release.mjs --test-rollback-only
NEW_DAWN_SCHEDULED_ALLOW_PROJECT=tgbnakbxwcqjeimygroz node scripts/verify/new-dawn-m2-scheduled-activity-release.mjs --live-preflight
```

After review, the separate install and readback steps are:

```sh
NEW_DAWN_SCHEDULED_ALLOW_PROJECT=tgbnakbxwcqjeimygroz NEW_DAWN_SCHEDULED_SOURCE_SHA=c5d57b4cdbd0c46ffdb1ae3b48c457619ff5ce17593b02ac145c7279931e4ae2 node scripts/verify/new-dawn-m2-scheduled-activity-release.mjs --live-install-sql
NEW_DAWN_SCHEDULED_ALLOW_PROJECT=tgbnakbxwcqjeimygroz NEW_DAWN_SCHEDULED_CLOSURE_SHA=1c29a3c5e1e05b62225d8bad257cdeb432efbf24ea300b8451be175518fadbef node scripts/verify/new-dawn-m2-scheduled-activity-release.mjs --live-install-edge
NEW_DAWN_SCHEDULED_ALLOW_PROJECT=tgbnakbxwcqjeimygroz node scripts/verify/new-dawn-m2-scheduled-activity-release.mjs --live-readback
```

The SQL installer adds only `20261106193000_new_dawn_commusoft_scheduled_activity_probe.sql` and its exact Supabase migration-ledger entry. The Edge installer adds only `learn-commusoft-scheduled-activity-probe`. A missing receipt or mismatched state stops release; never rerun a write after an uncertain outcome without independent inspection. Enabling the OFF flag or making a LIVE source read is a distinct, later decision.
