# Emma natural delivery — 13 October 2026

Chris authorised improvements to phone and in-app Emma, preserving her current voice and accent. Published configuration is ready for a recorded listening comparison; no measured speed or quality improvement is claimed yet.

## Published and verified

- Vapi assistant `4eb2bee8-ac25-47c9-b962-409ed250ceb6`, Emma – Drummond Heating: v13 published, 100% version traffic. This does not activate Drummonds' main number.
- Existing ElevenLabs voice, Flash v2.5, GPT-4.1 and Soniox RTv5 retained. Voice identity, speed, stability and accent unchanged.
- Response wait changed from 0.8 to 0.4 seconds in v12. This reduces the configured waiting component; it is not a measurement of complete response latency.
- v13 adds natural-delivery guidance: shorter ordinary replies, fewer stock acknowledgements, context-aware corrections, measured names/numbers, calm urgency and evidence-based claims. Existing business, routing, safety and consent instructions remain intact.
- Interruption settings: `numWords: 0`, `voiceSeconds: 0.2`, `backoffSeconds: 0.8`. No smart-endpointing provider change. Check real background-noise sensitivity during listening acceptance.
- Production `receptionist-practice` v12 → v13: retain the published speech plans and ElevenLabs streaming/SSML/auto/caching fields in isolated practice. Read-only knowledge and practice restrictions remain. Each new practice conversation fetches the current published assistant.
- All seven deployed source modules match the reviewed candidate after TypeScript erasure. The six previous modules matched the baseline. No unrelated endpoint changed during deployment. Existing gateway setting preserved; the function still requires a valid user and tenant access.
- 29 focused tests passed. Unauthenticated hosted request returned 401. Signed-in live Drummonds practice screen reloaded successfully and Test Emma is enabled.

## Listening acceptance

Start a fresh conversation at [live practice](https://www.openfolk.ai/client?tenant=00000000-0000-0000-0000-000000000001&section=receptionist&view=practice), using fictional details.

1. Routine boiler enquiry: short, relevant response and one sensible next question.
2. Interrupt with “Actually, that isn't what I meant”: she should stop and use the correction without restarting.
3. Give a postcode or phone number with a thinking pause: she should not rush or repeatedly prompt.
4. Ask for Heidi: practice must describe the intended handover without claiming a real transfer.
5. Compare the recording with a previous call for delays, clipped speech, background-noise interruptions and repeated wording.

No fresh paid calls were created by this change. Measured voice latency, real-call audio quality and telephone transfers remain separate acceptance checks.

## Preservation and rollback

Private evidence and full pre-change/candidate prompts are excluded from Git in `.verification-results/emma-natural-delivery-20261013/`. Do not commit raw provider prompts, credentials or call data.

Vapi v12 retains the response-wait change alone; v11 is the original full configuration. Inspect the version diff before restoring. Other candidate assistants and their drafts were not changed. Earlier assistant snapshots and rehearsal approvals do **not** establish acceptance for v13; refresh the comparison before any later candidate promotion so it does not overwrite this work.

The downloaded production practice v12 source is retained at `rollback-source/supabase/functions/` beneath that private directory, with `_shared` modules restored to their import locations and its original gateway setting in `supabase/config.toml`. Roll back only this endpoint through the established Supabase CLI path, then verify source, denied unauthenticated access and signed-in readiness again.

The deployment initially stopped because the source comparator treated formatting/transpilation differences as mismatches. A separate read-only AST comparison verified all six baseline modules, with negative controls for changed values, authentication and HTTP methods. Only then was deployment allowed. [Sanitised release evidence](evidence/emma-natural-delivery-2026-10-13.json).
