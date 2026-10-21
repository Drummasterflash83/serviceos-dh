# Emma isolated candidate: stale preparation gate and write review

This slice changes the service-only **preparation** guard. It does not install the New Dawn candidate, deploy an Edge Function, change Vapi or Birchills, bind a test number, place a call or send a notification.

## Current behavior corrected

Drummonds' saved test setting selects an old isolated Emma candidate, while `prepare_candidate` requires the published Emma source. The HTTP path fetched the selected candidate and therefore failed source identity before it could explain the stale state. If the published source were supplied, the existing prepared row would be returned unchanged even when its source hash predates the current LIVE voice. That result could be mistaken for a reconciled candidate.

The service-only manual action now reads the published assistant and computes its current assistant/tool hash. It returns a **409 review hold before any provider write** when the saved source hash differs, when a candidate is already prepared, or when a prior preparation is partial or uncertain. Only an identical-source, empty rejected row can follow the existing explicit preparation path. Other actions continue to read the selected test assistant. The hold response is an exact allowlist of fixed messages; it cannot echo provider payloads or credentials. This does not make the old candidate safe or ready.

## Separate provider-write review, still required

1. Use the founder-only read action to capture the current full configuration hashes for published Emma, isolated candidate and helper, candidate handoff, both shared tools and test-number binding. Record the exact before hashes in a private review, not in this public document. Verify the published voice and transcriber and explicit speed `1.05`; the current summary screen alone does not contain all of those hashes.
2. Prepare a before/after diff against **only** the isolated candidate, helper and candidate-only handoff/inline emergency tool. Preserve the published assistant, shared tools, ordinary routes, staff extensions and main DID. The candidate must retain LIVE voice/transcriber/speed, the approved one-engineer urgent paths, a single failed-engineer return to shared 603 and the reviewed disclosure/safety wording. Require exact expected-before hashes and audited operator identity; refuse drift or a partial prior mutation.
3. Review and separately authorize the exact provider PATCH and test-number rebinding. Read each changed resource back and compare the full after hashes. Freeze the complete graph, scenario suite and phone binding as one candidate version. On uncertain provider responses, inspect before retrying; do not make a blind second write. Keep the prior isolated-resource snapshots and test-number binding for a reviewed rollback. No main-number or Birchills route change belongs in this step.
4. Run all 12 revised provider conversations against that one unchanged hash. Then perform supervised handset checks for domestic/uncertain → Tony, commercial → Rob, and a failed selected engineer → one 603 deposit. Require separate delivered email receipts for Rob and Tony and a correlated posted urgent Slack receipt. Provider simulations and a transfer request do not prove telephone or notification delivery. Any candidate edit resets the evidence set.
5. Only after the physical evidence passes should an exact main-DID route and rollback be put to Chris for separate day-of approval.

The current old candidate, test-number binding and 603 notification state are recorded privately in `.verification-results/new-dawn-handback-stage/EMMA-CANDIDATE-RECONCILIATION-2026-10-20-2034.md`. The local guard is a prerequisite, not that provider-write approval or a launch.
