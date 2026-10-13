# LEARN live release — 13 October 2026

## Working and verified

- The 24 pinned SQL packages and 37 compiled runtime functions were installed in production (`tgbnakbxwcqjeimygroz`). The immutable original journal reached paired backend acceptance, 69 steps verified.
- Original-column fingerprints matched across 28 source/access/storage sets before SQL, after SQL and after runtime installation: 79,802 rows. All 2,944 recording references still resolved. These fingerprints supplement the independent restore-tested backup; they are not a backup themselves.
- Positive caller checks passed against exact compiled artifacts offline: 28 scheduled cases and 63 changed-user cases. This is not proof of full provider coverage.
- A production-only acceptance failure exposed two expired, unended View-As contexts. The operator query now excludes expired contexts and limits the presence check to one current context. Any current or unbounded context still prohibits configuration. Four regression cases passed. No grants or history rows changed. The separately recorded `openfolk-control-plane` amendment published version 28, hash `4f8447f0de96c44e611cb68716b20d72cc2095b963aff7eb4c4dc0b72f428213`.
- Signed-in operator directory, Drummonds workspace, LEARN totals and an existing customer card/evidence timeline passed in the protected production preview. The stable live site subsequently displayed 19,116 emails, 4,399 calls and 2,944 recordings after a refresh.
- The final responsive frontend from Git `fc5fb67e38ab2d6781997b85b3cbb6ecaff44abc`, deployment `dpl_AFXGeu4hF9mYoMqNYtWUfupNuusg`, was verified on all four existing live aliases. Home text/status tiles wrap, the mobile phone header has appropriate spacing, and LEARN card tabs wrap onto two rows. Live Home, Modules, Phone and LEARN checks at phone width passed without horizontal page overflow; Home also passed tablet width. This is not exhaustive certification of every route and device.
- The nine original schedules were restored with their original commands/settings after signed-in live checks. The two-step continuation journal verified both promotion and restoration. Successful resumed capture included Workspace email, Simwood calls, recording metadata and audio downloads. At 08:49:56 BST the live screen showed 19,235 emails, 4,407 calls and 2,946 recordings: increases of 119, 8 and 2 respectively since the earlier live observation.

## Needs finishing

- Existing customer cards and evidence are readable, but a resumed customer-card sync retried with a required-data-read error. Existing cards were retained; fresh projection completion is not yet accepted.
- Two phone transcription and two analysis jobs succeeded, but two enclosing phone pipeline jobs failed. The remaining completion stage needs diagnosis before end-to-end phone processing is called healthy.
- Full production Slack/Commusoft history, canonical contact/card coverage and remaining AI/scorecard acceptance are unfinished. TEST import evidence must not be presented as production coverage.

## Blocked externally

- Three mailbox delegation failures remain recorded. Successful email capture for other mailboxes does not establish access for those accounts.

## Release amendments and limitations

- The original deployment journal and plan were not rewritten. A separate continuation binds the responsive frontend amendment and restores original schedules. Its plan hash is `4735b80d32e0be7687921888ab9911c0f5176b80d9f0139df4718fe61e6bb905`.
- The final LEARN tab-wrap promotion has its own verified one-step continuation, plan hash `5e0794156f84934badcc49fd46587506511cf1eaa793465ea6532fee9ea5a1a7`.
- SQL package 014 initially had an unconfirmed response. Its receipt and candidate objects were absent, its read-only guards passed, and no matching transaction remained after more than nine minutes. A reviewed, identical guarded transaction then committed once; the original journal reconciled its receipt. This is recorded privately, not treated as a successful initial request.
- Supabase omitted `import_map` on new compiled function metadata; the verifier now accepts absent or false, but still rejects an enabled/named import map and requires the exact compiled hash. A regression check passed.
- Vercel clears its transient alias job after completion. Promotion verification now accepts that state only when the project target, all four aliases, build identity and completed alias assignment match. Mixed or pending states remain unconfirmed. Eight frontend adapter tests passed.
- `LEARN_INPUT_DISPATCH_ENABLED` remains false. No new production Slack/Commusoft import approval, channel capture, login or grant was created by this release. Their production activation and complete coverage remain unfinished.
- The original all-gates release sequence and LEARN V1 goal are **not complete**. This is a verified live frontend/backend checkpoint with original capture schedules restored, not a claim of complete provider, AI, scorecard or recovery automation acceptance.
- Private evidence and credentials remain outside Git under `.verification-results` and the existing approved secret stores.
