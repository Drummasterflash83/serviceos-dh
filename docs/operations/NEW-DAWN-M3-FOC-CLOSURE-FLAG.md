# M3 Free-of-Charge closure: private operator flag

This is a separate release step after the exact `20261109120000` FOC review function is installed. It enables only `new_dawn.m3_foc_closure_review` for the Drummonds LIVE tenant (`00000000-0000-0000-0000-000000000001`). It does not publish owner money, invoice status, GP, ARR or client-facing scores, and makes no Commusoft or QuickBooks request.

The switch accepts the current exact source only when one saved Commusoft v5 Free-of-Charge detail remains paired with the current reviewed job link and latest committed source version. It checks the installed migration hash, RPC hash and grants, tenant, client money flags, and append-only audit triggers. The enabling transaction writes one target flag and one audit record with the supplied reason. It refuses an already-enabled or cross-tenant flag. The OFF path stays available if the source later changes; it requires the exact Drummonds target to be ON and writes its own audit record. An uncertain write is read back once by flag and audit ID and is never replayed automatically.

Run from a clean, reviewed release checkout with the existing noninteractive Supabase CLI login. Confirm this PR is merged and the source/RPC hash still matches before any activation. The reviewer should inspect the printed preflight: `candidateCount` must be **1**, `operatorFlagEnabled` and `clientMoneyFlagsEnabled` must both be **false**.

```sh
NEW_DAWN_M3_FOC_PROJECT=tgbnakbxwcqjeimygroz NEW_DAWN_M3_FOC_FLAG=new_dawn.m3_foc_closure_review \
  node scripts/verify/new-dawn-m3-foc-closure-flag.mjs --live-read-only
```

Activation requires an explicit release decision and a concrete audit reason. The review should identify the Drummonds-only operator preview; it is not a client publication decision.

```sh
NEW_DAWN_M3_FOC_PROJECT=tgbnakbxwcqjeimygroz NEW_DAWN_M3_FOC_FLAG=new_dawn.m3_foc_closure_review \
  node scripts/verify/new-dawn-m3-foc-closure-flag.mjs \
  --live-enable-drummonds-operator-only --reason="Reviewed exact Drummonds FOC closure for private OpenFolk operator preview"
```

After an enabled readback, verify the signed-in OpenFolk operator view and its separate read audit. Do not use an ordinary client account for this preview. Withdraw with a new reason:

```sh
NEW_DAWN_M3_FOC_PROJECT=tgbnakbxwcqjeimygroz NEW_DAWN_M3_FOC_FLAG=new_dawn.m3_foc_closure_review \
  node scripts/verify/new-dawn-m3-foc-closure-flag.mjs \
  --live-disable-drummonds-operator-only --reason="Withdraw Drummonds private FOC closure preview"
```

The disable command does not delete the audit history. If any write reports `foc_flag_outcome_unverified_no_replay`, inspect the flag and audit read-only before deciding on another action; do not blindly rerun. The one-candidate gate is a release preflight, not a promise of ongoing source freshness. The RPC repeats its source checks on every operator read, and the preview must remain private while client money flags are OFF.

Verification before this PR: four focused unit tests; hosted TEST synthetic ON/OFF and audit in one rolled-back transaction; independent read-only LIVE preflight returned one current candidate with the flag and client money flags OFF. The TEST fixture does not constitute LIVE activation.
