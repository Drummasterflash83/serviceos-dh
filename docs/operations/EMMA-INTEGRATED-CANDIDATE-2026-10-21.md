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
`git diff --check`, and the production build. Both Vercel builds passed on
integrated draft PR #88 head `768a1c6b47b230eb2d3477fc20f19e1fb4074b9a`.
The PR remains draft pending the provider and physical gates below.

The superseded draft PR #323 was closed after its entire head
`3f13197b99e2e9d9806d1c9680ad60e6a93498fd` was verified as an ancestor
of PR #88. Its complete Git history is archived in Dropbox `NEW DAWN/` as
`emma-v15-stale-guard-323-20261021.bundle` (SHA-256
`610a7b72927325be5d84a0cdbdecdfbe54aca8f192c4b7d817a2b666fd57a79c`);
the superseded remote branch was deleted. No published history was rewritten.

Remaining launch gates are a fresh full Vapi/Birchills graph and exact hashes,
verified 603 dialable destination and separate Rob/Tony email delivery, a
reviewed isolated candidate write and test-number binding, 12 provider
conversations against one frozen hash, real Rob/Tony handset answers, one 603
deposit, and correlated email and Slack receipts. The main DID remains
unchanged until those pass and Chris gives the separate day-of go-ahead.
