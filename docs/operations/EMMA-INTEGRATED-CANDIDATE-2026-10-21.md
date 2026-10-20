# Emma integrated source candidate — 21 October 2026

This is a **source candidate**, not a launched assistant or a provider test.
It combines the isolated speech-repair path from draft PR #88 with the
stale-candidate preparation guard from draft PR #323 and current `main`.
The one merge conflict in `receptionist-testing/index.ts` was resolved by
keeping the fixed-account `reconcile_isolated_voice` action before the
assistant read, while `prepare_candidate` reads the published Emma source.
The old isolated candidate is held for fresh graph reconciliation; it is not
silently reused or patched by preparation.

[Manifest v17](EMMA-SOURCE-CANDIDATE-MANIFEST-2026-10-21-v17.json) pins the
combined source at commit `f699098c17c8b7f1ae06496dc62209d7802cd29c`.
Its candidate-source SHA-256 is
`521060b463bdc9d1c16f974aff73f0be6ccf463b952c2fa1a7b172e7d7e98397`;
the manifest file SHA-256 is
`d921043d83a210d732d52c3e538b8fd5d3bf6bb96c5fbc2a9a21c9b9bc03d372`.
The 12 scenario definitions pass static preflight. They have **not** run as
provider conversations or handset calls. The manifest now pins the speech
reconciliation module and the service route as well as the original candidate
modules.

After the current-main merge, the combined source passed 216 focused
receptionist tests, TypeScript, `node --check` on the service route,
`git diff --check`, and the production build. Hosted checks on the final
branch head are still required before PR #88 can be treated as release-ready.

Remaining launch gates are a fresh full Vapi/Birchills graph and exact hashes,
verified 603 dialable destination and separate Rob/Tony email delivery, a
reviewed isolated candidate write and test-number binding, 12 provider
conversations against one frozen hash, real Rob/Tony handset answers, one 603
deposit, and correlated email and Slack receipts. The main DID remains
unchanged until those pass and Chris gives the separate day-of go-ahead.
