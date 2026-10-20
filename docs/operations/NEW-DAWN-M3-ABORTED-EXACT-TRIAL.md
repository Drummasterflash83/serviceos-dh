# One exact Commusoft closure refresh · operator trial

This is a five-minute, one-use **read-only provider** trial for one reviewed Drummonds job. Its saved 13 October Commusoft list record says `aborted`; that is a selection cue, not current status, an uninvoiced finding, a completed visit or lost revenue. The trial neither changes the job card nor touches QuickBooks, client money flags or staff logins. It uses the already installed M2 permit, exact-job Edge route and signed-in OpenFolk operator button.

The helper pins tenant `00000000-0000-0000-0000-000000000001`, canonical job `ff774d9a-0ed6-4bf8-a3cd-fa735e9b7137`, Commusoft external ID string `13136`, saved source version `ecc0788e-ffb8-4361-bdfa-d93c9535a711`, connection `87d0d4fa-1097-4a73-80fd-61357edb1e5d`, and OpenFolk operator `ec84daae-b135-4547-a1de-794bfcd3fbf2`. It verifies the exact saved status/outcome, latest unambiguous reviewed source link, active operator grant, base inputs, OFF broad flags, idle source queue and shared credential gate, zero active manual reads or permits, installed permit functions and grants. The arm RPC rechecks its own tenant/job/actor/version/connection and writes the existing immutable audit; this helper verifies the permit and audit independently. Unknown write outcomes are read back once and never replayed.

Only arm when the release lead has confirmed that the **same operator is signed in** at the LIVE OpenFolk job preview, has opened this exact job, and can immediately use its offered button. The saved preflight is ephemeral: run it again immediately before arm. A queued import, lease, changed source, absent operator, existing permit or unexpected flag is a stop. The signed-in FOC review is independent; do not use its browser check as proof that this exact job button is ready.

```sh
export NEW_DAWN_M3_TRIAL_PROJECT=tgbnakbxwcqjeimygroz
export NEW_DAWN_M3_TRIAL_JOB=ff774d9a-0ed6-4bf8-a3cd-fa735e9b7137
export NEW_DAWN_M3_TRIAL_OPERATOR=ec84daae-b135-4547-a1de-794bfcd3fbf2
node scripts/verify/new-dawn-m3-aborted-job-trial.mjs --live-read-only
```

The expected read-only state is `exact_aborted_job_trial_ready_not_armed`. After signed-in readiness is verified, generate and record **one** UUID locally. Set `NEW_DAWN_M3_SIGNED_IN_CLICK_READY=1` only for that arm command. The five-minute permit begins when the arm RPC runs.

```sh
request_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
NEW_DAWN_M3_SIGNED_IN_CLICK_READY=1 node scripts/verify/new-dawn-m3-aborted-job-trial.mjs \
  --live-arm-once "--request-id=$request_id" \
  --reason="Bounded current Commusoft closure check for reviewed job 13136"
```

The signed-in OpenFolk operator then refreshes the exact job detail, confirms the one offered permit matches that job, and clicks **Check current Commusoft job details** once. If the route returns a classified `waiting` state, reuse only that request UUID before expiry; never arm another request to bypass the queue. Read back the exact immutable detail receipt and audit, including result version, source-version/hash and `checked_at`, before interpreting its bounded closure fields. A new `aborted`, free-of-charge or invoiced closure label is still a **Commusoft job classification**, not proof of an invoice, payment, cost or margin. If the result is unknown, inspect the receipt and queue; do not retry an uncertain provider GET blindly.

```sh
node scripts/verify/new-dawn-m3-aborted-job-trial.mjs \
  --live-receipt-read-only "--request-id=$request_id"
```

Only `state=complete` with `providerResultVerified=true`, the exact v5 receipt, matching source binding, hash and audit supports reporting the bounded closure class. `prepared`, `claimed`, `failed` and `not_started` are held states. The helper returns a category rather than raw provider text.

Disarm the same request UUID after the check, or immediately if the operator cannot click, the source changes, the queue becomes unhealthy, or the permit is no longer wanted. Disarm has its own append-only audit and does not erase the read receipt.

```sh
node scripts/verify/new-dawn-m3-aborted-job-trial.mjs \
  --live-disarm-once "--request-id=$request_id" \
  --reason="End bounded current Commusoft closure check for job 13136"
```

If either write reports `outcome_unverified_no_replay`, retain the request UUID and inspect the permit/audit read-only before any further action. The helper never makes the provider GET itself and must not be used for another job. The existing M2 permit expires within five minutes, permits one actor and one exact source version, and shares the Commusoft credential lease with the import worker. No broad exact-job or coexistence flag needs to be enabled.
