# M3 source-readiness metadata — exact LIVE release handoff

Status: **prepared, not installed**. This installs only
`20261106170000_new_dawn_money_source_readiness.sql`, SHA-256
`f9dba3316d3fc7a4438b201a0ab0f08638dda06eb4daefac2c2e2c15a67d3606`.
It adds an operator-only, count-and-field-presence RPC. It does not read QuickBooks,
create a report, publish an amount, grant client access or enable a flag.
Migration `20261106190000` and both owner report functions remain separate and held.

On 19 October the LIVE read-only preflight found the target migration and RPC
absent, one confirmed production QuickBooks realm for the active Drummonds
tenant, owner publication absent, and all five checked M3 flags absent/OFF.
The TEST readiness and owner-boundary rehearsals passed inside transactions
that rolled back; no provider request or financial value was returned. Recheck
these facts immediately before a release. The current backup recovery gate and
release-owner review remain prerequisites; this handoff does not waive them.

The exact installer is
`scripts/verify/new-dawn-m3-readiness-exact-sql-release.mjs`. From its reviewed
Git head, the release owner first runs:

```sh
NEW_DAWN_M3_ALLOW_PROJECT=saatxzwxvdvqevbnskxy \
  node scripts/verify/new-dawn-m3-readiness-exact-sql-release.mjs --test-rollback-only
NEW_DAWN_M3_ALLOW_PROJECT=tgbnakbxwcqjeimygroz \
  node scripts/verify/new-dawn-m3-readiness-exact-sql-release.mjs --live-read-only
```

The TEST step verifies the synthetic operator/ordinary-user denials and that
the RPC remains absent after rollback. The LIVE step checks the exact project,
active tenant, a single confirmed production realm, migration ledger, function
and grant state, absent owner publication, and unchanged OFF flags. It returns
no realm ID, financial row or amount. If either check fails, stop.

Only after the independent backup gate and source review, the release owner may
run exactly one installation attempt:

```sh
NEW_DAWN_M3_ALLOW_PROJECT=tgbnakbxwcqjeimygroz \
  node scripts/verify/new-dawn-m3-readiness-exact-sql-release.mjs \
  --live-apply-exact --version 20261106170000
```

The script uses one transaction, short lock/statement limits and an atomic
ledger receipt containing the exact reviewed SQL. It sends the Management API
write with `read_only:false`; then it reads the ledger, function security/grants,
tenant/realm binding, owner-publication absence and the same flag rows once.
An unknown write response is never replayed. If the result says
`m3_write_outcome_unverified_no_replay`, inspect the database and ledger
manually before any further action. Do not rerun the installation command on
an uncertain outcome. A successful installation still leaves the RPC dormant
because `new_dawn.money_source_readiness` remains OFF.

Rollback is to leave that flag OFF. The migration adds only a function and grant;
dropping it is not part of an automatic rollback and needs a separate reviewed
database change. Do not enable `new_dawn.owner_money`,
`new_dawn.owner_accounts_report`, `new_dawn.owner_report_review` or the
job-home accounts preview from this metadata receipt. Accounts gross profit
and net profit remain saved historical report evidence; field gross profit,
annual recurring revenue, actual job costs and cross-provider job identity
remain held pending their distinct sources and business definitions.
