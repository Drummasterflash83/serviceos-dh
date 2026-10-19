# M3 operator money-source readiness switch

This release changes one Drummonds tenant flag, `new_dawn.money_source_readiness`. It exposes a count-only source-readiness control in OpenFolk's operator area. It does not publish money to the client or owner, call QuickBooks, create a schedule, or infer field gross profit or annual recurring revenue.

The existing LIVE function is migration `20261106170000_new_dawn_money_source_readiness.sql`. The switch checks its exact migration body and grants, one confirmed production realm for the selected Drummonds tenant, the absence of owner-publication SQL, all client money flags OFF, and no operator readiness flag ON in another tenant. The already-enabled `new_dawn.report_summary_preview` is a separate OpenFolk-only saved-report reader: its SQL requires operator authority, and its job-home component also requires `new_dawn.job_home_accounts_preview`, which remains OFF. The switch pins that exact existing operator-report flag state rather than changing it. One uncertain write is read back once; it is never automatically repeated. The TEST rehearsal installs a synthetic ledger/function and changes a TEST connection and operator-report flag inside a single transaction, then rolls everything back.

The UI path is **OpenFolk → Drummonds → Modules → LEARN controls → QuickBooks accounting connection → Money source readiness · OpenFolk only**. It appears only with current operator write authority and this flag enabled. The RPC independently requires authenticated OpenFolk operator authority, exact tenant/connection scope, a reason, and writes an audit event. Its result contains counts and held reasons, never amounts.

From the repository root, the release owner runs:

```sh
node --test scripts/verify/new-dawn-m3-operator-readiness-flag.test.mjs
NEW_DAWN_M3_ALLOW_PROJECT=saatxzwxvdvqevbnskxy node scripts/verify/new-dawn-m3-operator-readiness-flag.mjs --test-rollback-only
NEW_DAWN_M3_ALLOW_PROJECT=tgbnakbxwcqjeimygroz node scripts/verify/new-dawn-m3-operator-readiness-flag.mjs --live-read-only
```

After review, the release owner may run the one exact write:

```sh
NEW_DAWN_M3_ALLOW_PROJECT=tgbnakbxwcqjeimygroz node scripts/verify/new-dawn-m3-operator-readiness-flag.mjs --live-enable-drummonds-operator-only
```

The returned state must be `drummonds_operator_readiness_only`, with `readbackVerified: true`, `clientMoneyFlagsEnabled: false`, and `providerRequests: 0`. If the write outcome is unverified, inspect the flag read-only and do not replay the write. The release owner must then use a signed-in OpenFolk operator session to check the exact Drummonds page and perform one reasoned, audited source-readiness read. Verify counts, source observation time, held field gross profit/annual recurring revenue labels, no amounts, and the audit record. A synthetic TEST role fixture is not signed-in LIVE UI proof.

To turn this operator control off, the release owner uses `--live-disable-drummonds-operator-only` with the same project allowlist. The script again requires exact before/after readback. Client money flags remain OFF throughout. Do not enable `new_dawn.owner_report_review`, `new_dawn.owner_accounts_report`, `new_dawn.owner_money`, or `new_dawn.job_home_accounts_preview` as part of this release. Do not change the separately enabled operator-only `new_dawn.report_summary_preview` flag.
