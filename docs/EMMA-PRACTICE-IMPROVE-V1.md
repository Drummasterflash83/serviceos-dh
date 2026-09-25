# Emma — Practice & improve, 24 September 2026

## 25 September: direct-number launch path

The browser WebRTC path remains without audible acceptance and is no longer the
primary client test. Practice & improve now displays the configured Vapi test number
and a `tel:` action. The tester calls it from their own phone (or a computer with a
calling app), then enters the caller number to find only exact-number calls in the
latest Vapi page and previous 24 hours. UK national mobile format is normalised to
`44` format. Withheld numbers and calls outside the recent page cannot be linked by
this finder; no guessed association is made. The selected call becomes a reviewable
conversation with provider summary, transcript if supplied, and a fresh private
recording link. Its feedback stores the exact call ID; history reopens that call
through a tenant/assistant-scoped provider read. The main number and Birchills
routing are unchanged. Because this exercises live test-line behaviour, testers must
use fictional customer details: configured actions might run.

The former right-hand feedback panel is now inside the single practice flow and
appears after selecting a call or explicitly choosing to send an unlinked idea.
Typed feedback is editable and reviewed by OpenFolk. The existing Slack dispatcher
currently posts an ID/link pointer, not full call or feedback transcripts. Full
transcript delivery and dedicated voice notes require an approved private Slack
destination and speech-processing/data-retention design; they are not represented as
complete. Call recording and transcript availability remain provider facts to verify
with an actual signed-in phone test. The direct-number path is not a claim that
browser voice has been fixed.

## Browser media and reservation correction

The actual user attempt created at 2026-09-24T20:07:34.771266Z was confirmed through
a fixed-tenant, service-authenticated read: Vapi status ended, reason
`call.in-progress.error-assistant-did-not-receive-customer-audio`, start/end both
20:07:50.204Z. Database still said active. Tenant/session metadata matched. No
meeting token was supplied by this call, so a missing token was not the cause.
This proves no customer audio reached Vapi; it does not prove which browser event
prevented it. No extra paid call was created for this investigation.

The previous microphone preflight stopped its track before SDK join. Conversation
now passes the still-live acquired track directly to the SDK, stopping it on every
terminal/cancel/unmount path. Welcome-only mode supplies a generated silent track,
not the visitor's microphone (the installed SDK silently changes audioSource:false
to true, so false was not a safe listening-only contract). Optional noise-reduction
errors no longer cause our handler to hang up. A terminal lifecycle latch prevents
call-end followed by late join from resurrecting active state. Connection stages,
30-second join timeout and fixed safe end-reason guidance are displayed; prior
call evidence survives a rejected retry.

Before reservation, positively ended provider calls with exact web-call,
tenant/session binding are reconciled. Failed reads, absent calls and wrong bindings
do not release anything. The existing locked reservation RPC and rolling quota are
unchanged. Busy, daily limit, duplicate and infrastructure errors have distinct messages.
Eight focused tests cover these boundaries; browser/audible acceptance remains pending.
Reference: https://docs.vapi.ai/calls/call-ended-reason

## Browser-call route correction

Chris's start attempt reached the database reservation but stored no call ID. A single
bounded internal diagnostic reproduced HTTP 400 from POST /call: Vapi demanded a phone
number. The corrected POST /call/web with a server-only public-scoped HS256 JWT (60s)
returned HTTP 201 and a valid Daily room. The token is never exposed to the browser;
signing uses the existing private key and the verified assistant's orgId.

The one created internal diagnostic call 01a0d4c7-83ba-7aa9-9d88-b64f5c3ed70c was verified
as webCall, no customer/phone number, maxDuration 10s, metadata matched. It ended with
call.in-progress.error-assistant-did-not-receive-customer-audio (no browser joined),
provider cost $0.0011. This is call-creation proof, NOT audible browser acceptance.
No telephone dial, live assistant PATCH or transfer occurred.

Session/tenant binding is stored in transient assistant.metadata and verified there
on result/recording reads; this exact metadata persistence was verified on the diagnostic.
Known 4xx rejections mark the reservation failed (daily quota still counts). Timeouts,
5xx and ambiguous failures retain the lease. UI now reads governed invocation error
responses instead of replacing every rejection with a misleading generic five-minute wait.

Four added tests cover JWT signature/scope/expiry, invalid signing inputs, definitive vs
ambiguous failure classification and tenant/session/web-call evidence binding.
Temporary diagnostic endpoint removed after release. Source references:
https://docs.vapi.ai/customization/jwt-authentication and @vapi-ai/web 2.7.1 API contract.

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
