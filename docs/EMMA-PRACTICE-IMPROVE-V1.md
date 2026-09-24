# Emma — Practice & improve, 24 September 2026

## Knowledge adapter correction

### Confirmed legacy Google format (supersedes the unverified custom label)

A temporary service-authenticated, fixed-tenant diagnostic read the actual provider
configuration. Emma's model.knowledgeBase is `{provider: "google", fileIds: [one UUID]}`,
not a custom external server. No knowledgeBaseId; no inline tools; only a saved live
transferCall tool. Source updatedAt 2026-09-22T16:09:07.432Z. The prior generic label
misclassified this older Google file-retrieval format.

The adapter now converts that exact file set into an inline read-only Google query,
with an explicit practice instruction to use it. No file contents downloaded, no
provider configuration changed. Actual-source diagnostic: adapterPassed=true,
sourceFileCount=1, projectedFileCount=1, exactFileSetPreserved=true, tool types=[query],
saved action references=0, serverMessages=[], maxDurationSeconds=180.
15 practice tests / 67 broader focused tests, TypeScript and Deno pass.
Temporary diagnostic is removed after deployment; no actual voice call claimed verified.

Chris reported the explicit knowledge-adapter blocker. The previous implementation
rejected every inline query tool, including Vapi's supported read-only file-backed
knowledge configuration. The practice adapter now strictly reconstructs Google-backed
inline query tools with original names, descriptions, model and file UUIDs. Saved query
tool references continue to work. No provider configuration is PATCHed. External/custom
knowledge servers and malformed file setups still refuse with distinct explanations.
The training overview counts inline read-only knowledge tools too.

13 practice tests pass, including inline lookup preservation, multiple knowledge sets,
source immutability, callback/credential/action exclusion and invalid-file/custom-server
refusals. Broader focused checks: 65 pass (excluding the separate static-output suite).
Frontend TypeScript and backend Deno checks pass. Real signed-in/audible confirmation
is still pending; do not turn this into a claim of successful practice calls.
Reference: https://docs.vapi.ai/knowledge-base/using-query-tool

Built on released main 94610da, preserving the unified client workspace, approved
wordmark, tenant-safe company menu, Back to workspace and verified Chris-only admin link.

## Client experience

- Practice & improve: bounded browser conversation or welcome-only listening,
  scenario selection, mute/end, live final utterance, post-call summary/recording when supplied.
- Adjacent observation and requested-change fields; automatically bound to the practice
  session and provider call. Ambiguous saves retry the same submission key, not another note.
- Saved feedback, Slack delivery and OpenFolk's response are distinct. Previous notes
  include their text and reopenable practice evidence; OpenFolk can review the same evidence.
- Current assistant instruction sections/updated timestamp retrieved server-side;
  no old draft is substituted if the provider configuration is unavailable.
- Caller-experience cards show assessed/unknown populations and drill into matching flags.
  Provider estimates are not CSAT. Normal requests for a person are not failure signals.
- Journal briefs prefer provider summaries, then explicitly labelled caller excerpts.
  Fresh authenticated recording retrieval stays in the app, with failure/retry states.
- Phone system shows a verified snapshot and proposed edits, not invented live groups.
  No verified Drummonds snapshot is currently installed; the page reports that gap.

## Safety and release

Practice is a transient Vapi assistant using the installed tenant-specific private key
on the server. Strict allowlists retain conversation instructions/voice and verified
read-only query tools. Transfer/booking/custom action tools, servers, hooks, credentials
and forwarding destinations are not copied. Unsupported inline knowledge refuses practice.
No Vapi public/private key is returned to the browser. The browser SDK joins the server-created
Daily room; recordings and voice usage are disclosed before starting.

Max 180 seconds (welcome 25 seconds), one active reservation per tenant, 10 attempts per
person and 30 per tenant per rolling 24 hours. Database advisory lock, not process-local
quota. Failed/ambiguous creation consumes quota. No automatic paid call retry.
Only a provider-observed ended call or reservation expiry releases the overlap guard.

Migration 20261020120000 applied in a scoped transaction and recorded in migration history.
One-time runner scripts/client-portal/deploy-emma-v1.sql refuses an already-recorded version.
Drummonds changed Testing → Ready per Chris's confirmed testing, with main-number activation
explicitly separate. Browser practice enabled; no practice call created by this release.
Only receptionist-practice, receptionist-calls and client-notifications deployed.
Their application-level authentication is explicit; unauthorized POSTs all return 401.
Existing notification schedule verified active; no new Slack delivery proof claimed.

Backend rollback source preserved at /private/tmp/openfolk-emma-backend.KfLIne.
Frontend rollback: https://serviceos-5zzqurvzi-allkin.vercel.app (94610da).
No main-number activation, Birchills mutation, customer import or Heidi invitation.

## Verification and remaining acceptance

Focused Node/source checks, frontend TypeScript, three Deno function checks and
Vercel-target build pass. Rollback-only local SQL tests prove reservation/replay/overlap,
disabled tenant, browser RPC denial, own/stranger RLS, note idempotency, call binding,
single outbox insertion and failed-attempt quota. These are not browser or audible proofs.
Two targeted lint warnings: mixed hook/component export and mutable generation counter
in teardown; zero errors. Existing dependency advisories remain in build-tool transitive
dependencies (baseline-browser-mapping, browserslist, js-yaml, nanoid); no blanket update.

Signed-in visual/mobile acceptance, microphone/audio, real practice and actual Slack
delivery still need a normal authorised user check. Managed browser restriction was
not bypassed. Customer-card matching is not newly added; names are provider supplied and
same-number history is not an established customer/job link. No new provider sentiment
assessment configuration was installed: absent source assessments stay unknown. Call
history is the loaded population, not a complete business-wide aggregate.

Acceptance: sign in → Practice & improve → Talk to Emma → End → type a correction →
Send to OpenFolk → verify Slack delivery and linked evidence → OpenFolk response → retest.
Phone system remains awaiting a verified Birchills baseline, not ready for live PBX editing.
