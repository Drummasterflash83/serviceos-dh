# Emma Stage A candidate — handover and release checks

This track is separate from LEARN and the Service OS client interface. The
main Drummonds number is **not** being switched by this branch. Chris owns
Emma's launch and must give a specific go-ahead for each Birchills routing
change on the day.

## Source of truth and present evidence

- Branch: `codex/new-dawn-emma`, cut from verified GitHub `main`
  `a9ec20324ced248b60ee77ded3f8ad7fee21b890` and normally merged
  with current `main` `41d0aca8` at `f5050b92` on 19 October. Published
  history was preserved and there was no Emma-specific merge conflict.
  All 179 focused receptionist tests and the diff check passed after the
  merge. These are source-code checks, not provider or phone acceptance.
- The historical 2 October private package is
  `2. Ai/Openfolk OS   Pass-Over/Emma Unmerged Work 2026-10-02/` in Chris's
  Dropbox. Its patch applied cleanly to this branch. Its 80 focused tests
  passed locally; it was a development recovery package, not a launch result.
- The latest recorded Vapi observation in Git is 13 October: published Emma
  assistant `4eb2bee8-ac25-47c9-b962-409ed250ceb6`, v14, speed 1.05,
  100% version traffic. The candidate is
  `dcfc2e66-a438-43ab-b863-467f5a5089df`. This branch has **not** made
  a fresh authenticated provider read, so those values must be read back
  before any provider edit or paid test. See
  `docs/operations/EMMA-NATURAL-DELIVERY-2026-10-13.md`.
- Recorded Birchills state remains historical: main 01794 341600 uses
  IVR 501 in hours and 502 out of hours; extension 205 is the proposed
  Emma route. Mailbox 603 exists, but receipt by both engineers and a Slack
  alert have not been proved. Capture the current account-3950 routes and
  mailbox settings before any request or change.
- The last recorded isolated suite was **8/12**. Two emergency handoffs
  lacked an address, gas safety omitted the spoken number, and the Heidi
  handover lacked customer-facing wording. This branch does not relabel
  that run as a pass or start billable calls.
- Draft [PR #88](https://github.com/Drummasterflash83/serviceos-dh/pull/88)
  carries this candidate. Vercel preview builds were reported ready for its
  earlier pushed head. The PR stays draft until its current head, provider
  state, same-hash scenario suite and real-phone gates are reviewed. No
  browser session or existing noninteractive key for a fresh Vapi/Birchills
  read was available in this worktree on 19 October; the historical values
  above must not be presented as current state.
- The 12 reviewed synthetic scenarios comprise five ordinary named/sales
  routes, four closed/holiday consent cases, two out-of-hours emergency
  classifications and one office-hours gas-safety case. The last provider
  run was 8/12 on an older candidate. Local tests of the release gate are
  **not** a new 12/12 run. Root simulations intercept the handoff and
  cannot establish that Rob, Tony or mailbox 603 received a real call.
- The current helper contract describes Rob/Tony cross-cover, but it does
  **not** establish a usable final 603 transfer or a Slack delivery route.
  `validateGraph` checks the emergency tool against the saved source and
  checks the helper/tool identities; it does not independently prove the
  two engineer destinations, the 603 destination, voicemail delivery,
  dual email or Slack receipt. A 12/12 root-assistant simulation could
  therefore pass while Stage A fallback remains unproved. Inspect the
  current provider graph and implement only a provider-supported,
  reviewed 603 route before real-phone acceptance; do not invent a
  mailbox number or claim an alert was sent.
- This branch now makes the **next candidate** say to try shared 603 once
  after both engineer attempts fail, and to disclose a failed/unavailable
  fallback honestly. The promotion check refuses the helper's candidate-only
  inline emergency tool unless
  its read-back has three distinct, labelled Rob 109, Tony 105 and shared
  603 destinations. It does not guess Tony's direct number or 603's number;
  their actual Birchills bindings and provider behaviour still need review.
  The promotion receipt explicitly leaves engineer acceptance, 603 deposit,
  both email receipts and Slack delivery `not_verified`. This is a source
  and structural guard, **not** proof that the path works or permission to
  change the existing shared tool. The saved current candidate cannot pass
  this new check until safely reconciled against a fresh provider readback.
- The helper currently references the same emergency transfer tool ID as the
  published assistant. Adding a 603 destination to that shared Vapi tool would
  also change a published resource. The source-snapshot guard blocks an
  unnoticed shared-tool edit, but the three-destination check alone does not
  make such an edit safe. Read the current graph first and design a
  candidate-only emergency tool, or obtain explicit approval for a reviewed
  shared-resource change. This draft is not permission to alter the shared tool.

### Candidate-only 603 design, prepared without a provider write

Vapi documents that a transferCall tool can be defined in an assistant's
`model.tools`, while reusable tools are linked through `model.toolIds`:
<https://docs.vapi.ai/tools/transfer-call> and
<https://docs.vapi.ai/calls/transfer-calls-with-api-lookup>. The revised
source creates future isolated helpers with an **inline copy** of the
published two-engineer emergency transfer tool. It strips the source's
provider identity and clones the configuration, leaving the published tool
untouched. The release gate now requires the helper to have no shared tool
ID, one inline emergency tool, the exact unchanged Rob/Tony destinations,
and one separately reviewed 603 destination. Editing the published tool or
reusing its ID fails before any live assistant update. The current saved
helper was created before this source change and must be reconciled on the
provider only after fresh readback and a separate approved candidate edit.

The 603 phone/SIP address, transfer-plan behavior, notification recipients and
Slack route remain **unknown** in this worktree. The current browser inventory
has no signed-in Vapi or Birchills tab, and no existing Vapi/Birchills key is
available to this process. Therefore no current provider inventory was
obtained and no 603 address was guessed. The next authorised provider read
must establish the published tool's current configuration, whether Vapi accepts
the isolated inline copy for this account, and Birchills' actual 603 target.
The provider may normalize inline tool fields; read-back must compare the
saved helper to the reviewed source before any paid run or promotion.

### Sequential cross-cover and greeting checks, source-only

Vapi's [Transfer Call tool guide](https://docs.vapi.ai/tools/transfer-call)
states that one invocation chooses **one** destination from its list; the
array does not call Rob, Tony and 603 in sequence. Its
[assistant-based warm-transfer guide](https://docs.vapi.ai/calls/assistant-based-warm-transfer)
describes how a failed destination can return the caller to the original
assistant when `transferPlan.mode` is `warm-transfer-experimental`, the
transfer assistant cancels voicemail/busy/no-answer/IVR and
`fallbackPlan.endCallEnabled` is `false`. The candidate-only release gate now
requires those fields and the exact human-acceptance/cancellation contract for
both engineer destinations. It allows their candidate-only transfer plans to
differ from the unchanged published tool, while retaining the same Rob/Tony
number and description. A blind or ending transfer cannot pass merely because
three destinations are listed. This is a structural check; only supervised
provider calls can prove that Vapi and Birchills actually return a failed
leg, ring the next engineer and deposit in 603.

The twelve root scenarios are now revision `fixed-clock-routing-v11`. Each
quality judge requires the **actual first greeting** in the transcript to
disclose that Emma is automated and the call is recorded, before intake or
transfer, including closed and holiday clocks. The existing source-text check
still requires both branches of the candidate greeting to contain those
disclosures. v10's saved provider results cannot be relabelled as v11; one
fresh captured suite on one unchanged candidate hash is required. The root
simulations still intercept the emergency handoff and cannot prove Rob/Tony
cross-cover, 603 deposit, dual email or Slack delivery.

## Candidate code now prepared

- The recovered candidate-only intake validator requires caller-sourced
  name, confirmed callback, concrete address/postcode, issue and
  domestic/commercial classification before the internal emergency handoff.
  The new HTTP receiver authenticates before parsing, bounds the body,
  verifies a current candidate call with Vapi, uses trusted London time,
  and records a fixed decision through the private, atomic RPC. No arbitrary
  tenant or destination can be supplied by a caller. An unavailable
  dependency fails closed.
- The new receiver is **not deployed**, and the dedicated
  `EMMA_TEST_INTAKE_TOKEN` has **not been provisioned** by this branch.
  The historical migration
  `20261028180000_emma_candidate_intake_check.sql` was already applied to
  the linked Supabase project on 2 October; do not replay it there.
- The one-time candidate installer now rejects a candidate/handoff edit
  between its initial inspection and reservation. It never modifies the
  live assistant, main number, phones or helper. Deploy/auth-test the receiver
  before installing the candidate's dynamic handoff.
- The candidate prompt patch requires full gas-number speech and a spoken
  named-person handover without a synthetic automatic goodbye. The release
  gate requires v14 speed 1.05 on live/candidate/helper, identical voice and
  transcriber, and AI/recording disclosure in both open and closed greetings.
  It also requires the dynamic handoff and a verified intake installation.
  It will **block** a stale candidate; it does not silently update provider
  voice settings. The 2 October saved source snapshot predates v14 and the
  later natural-delivery changes, so a reviewed candidate/source
  reconciliation is needed before the existing promotion gate can pass.
  The same gate now requires the exact reviewed helper continuation contract
  and all three labelled emergency destinations. These labels cannot verify
  actual telephone routing or notification delivery.
- National Gas confirms the National Gas Emergency Service number is
  **0800 111 999**, 24 hours, for gas leaks and suspected carbon-monoxide
  emergencies: <https://www.nationalgas.com/en/node/256>. NHS guidance says
  leave the affected building for suspected carbon-monoxide exposure and
  call 999 for severe symptoms: <https://www.nhs.uk/conditions/carbon-monoxide-poisoning/>.
  The caller must receive immediate safety advice before intake or routing.

## Current LIVE runtime metadata, 19 October

A read-only, aggregate Supabase check found the Drummonds receptionist
workspace at `launch_stage=Ready`, still bound to published assistant
`4eb2bee8-ac25-47c9-b962-409ed250ceb6`. There is no intake installation,
no recorded intake decision and no launch-promotion row. The existing
`receptionist-testing` Edge function is ACTIVE v55, while the candidate-only
`receptionist-intake-check` function is absent. No test run occurred in the
preceding 24 hours; the latest saved run was the isolated candidate's failed
run of 2 October. These are current **database and Edge metadata**, not a
fresh authenticated Vapi configuration read, Birchills route readback,
same-hash 12/12 run, handset transfer or mailbox delivery proof. No
credentials or caller data were read for this check.

An additional noninteractive access check on 19 October found no Vapi or
Birchills credential exposed to this worktree's process and no signed-in
Vapi/Birchills browser tab in the available browser inventory. The saved
Supabase management login provides database/Edge metadata, not a fresh
provider or PBX configuration readback. The deployed `receptionist-testing`
service has fixed, read-only `inspect_launch_graph` and
`provider_inventory` actions, but those require an authorised service JWT
and named actor that are not present in this worktree. Therefore the exact
current LIVE greeting, candidate/helper graph, Rob/Tony/603 number bindings, main-number
route and notification settings remain **unverified** against PR #88. Do not
substitute the historical snapshots above or three destination labels for
this readback; do not request Touch ID for a routine check.

`supabase/functions/_shared/receptionist-emergency-fallback-proof.ts` adds
a pure read-only contract for the later supervised D4/C4 calls. It requires
one correlated Vapi/Birchills call identity, two ordered failed engineer
attempts, a provider-confirmed 603 deposit, delivered receipts to **both**
engineer addresses, and a posted alert in the reviewed Slack channel, all
tied to the same mailbox message. Missing, queued, attempted, duplicated,
foreign-call or wrong-order evidence returns `not_verified`. Its synthetic
tests pass, but it has no live evidence or provider integration yet; the
collecting operator must independently authenticate each receipt's source.

The current immutable local source-candidate preflight is
`docs/operations/EMMA-SOURCE-CANDIDATE-MANIFEST-2026-10-20-v7.json` (SHA-256
`3b0ac93465e52669272955fd112d0d8a091096d4ddc5d758972a84660e22d65a`).
It pins 12 relevant source-file hashes to commit `6f0139f5`, the v11 suite
payload hash and each of the 12 scenario payload hashes. Running the
reproducible local checker twice produced identical bytes; all 12 passed
static clock/mock/rubric checks on that unchanged source. **No Vapi model
conversation was run:** every scenario's conversational and real-phone
outcome is explicitly `not_run`. This is not a 12/12 provider pass or a
hash of the unobserved saved Vapi candidate. The last real provider result
remains 8/12 on an older candidate. All 191 focused receptionist tests pass.
The earlier immutable v5 and v6 manifests remain for comparison. v7 also
corrects the 603 fallback explanation for a declined engineer call: Emma now
says neither engineer could take the call rather than falsely saying neither
answered. v2's candidate
prompt still allowed a bare postcode while the intake gate rejected one.
The initial manifest predates the location/CO safety fix.

The promotion preflight now compares each provider scenario's caller
instructions, fixed clock, action mocks and both judges with the twelve
reviewed definitions. An unchanged suite fingerprint alone could previously
certify a suite that was already altered before its run. This check rejects
that case before any live-assistant PATCH and repeats the comparison immediately
before publication. It is a source guard, not a new provider result. The v7
manifest pins this guard, the candidate-only emergency tool, the returnable
engineer transfer plans and the v11 greeting rubric.

The current code rejects a bare postcode as the complete emergency site:
the caller must supply a numbered street or named/numbered premises with a
postcode, grounded in their own words. It still does not geocode the address
or delay immediate safety advice. The CO wording now reflects the current
NHS distinction: suspected symptoms prompt NHS 111 after leaving, while
severe breathing difficulty, sudden confusion, unconsciousness, weakness
or chest/muscle pain require 999. The National Gas emergency line remains
0800 111 999. The candidate prompt now asks for premises detail when only a
postcode was supplied, matching the server gate without repeated full intake.
This is a candidate source correction, not a LIVE prompt or
real-phone result.

## Required provider sequence, no automatic launch

1. Read the current Vapi assistant, candidate, helper, handoff tool, test
   number, published version and paid-test allowance. Compare full voice
   identity/transcriber and v14 speed. Read current Birchills account 3950
   IVR 501/502, extension 205, Rob 109, Tony 105, mailbox 603 and current
   notification settings. Preserve before snapshots privately.
2. Set up one dedicated candidate-only inbound credential. Deploy
   `receptionist-intake-check` and verify wrong/missing credentials fail.
   Verify its installed-source hash and live authentication without a call.
   Do not reuse the service-role, scheduler or Vapi outbound key.
3. Reconcile the isolated candidate/helper to published v14 voice, preserving
   voice ID/accent and all other model/recording settings. Replace the helper's
   shared emergency tool reference with a candidate-only inline copy of the
   unchanged Rob/Tony destinations. Add 603 only to that copy after the
   Birchills binding and Vapi transfer behavior are reviewed. Never patch the
   published shared tool to satisfy this candidate gate.
   Review both open and closed first messages. Use an audited candidate-only
   patch and read back; do not patch the live assistant.
4. Inspect the candidate and handoff exact hash, then run the one-time
   intake installer. Read back the saved dynamic server configuration and
   verify the receiver on a controlled candidate call. Review ambiguous
   writes; never blindly retry.
   Separately verify the helper's Rob/Tony destination definitions and
   supported final 603 route against Birchills and Vapi; the root suite
   cannot do this. The dual-email and Slack path needs message-correlated
   delivery receipts, not merely configured destinations.
5. Create a **new** 12-scenario suite tied to that exact candidate hash and
   run it once within an authorised paid allowance. All 12 must pass on
   **one unchanged configuration**, with captured routing and wording
   evidence. The simulated handoff is intercepted; the receiver and actual
   engineer connection need separate checks.
6. Chris reviews the result. Publishing candidate behaviour to the live
   assistant is a separate release and readback. Main-line Birchills
   routing remains untouched until Chris's day-of go-ahead.

If the caller cannot give a usable location, or the server fails, do not
invent a transfer. The approved real-world fallback for such a case still
needs an operational decision before Emma can take the main line.

## Real-phone acceptance checklist

Agree a spend cap, controlled callers, distinct test windows, and Rob/Tony/
Mary's participation first. Use the Emma **test number only**. An ordinary
weekday **before 08:00** is for the eight closed-hours emergency calls below;
the two office-hours calls need a separate **after 08:30** window. The
caller supplies fictional but concrete test name, address and callback,
then confirms Emma's full number read-back. No real client details are needed.
For every call, match the Vapi call ID and audio to the Birchills call
record, handset observation and, when applicable, mailbox/notification
receipts. A transfer request alone is never human-answer proof.
For D2/D3/C2/C3, verify the failed first leg returned to Emma before a
**separate** second tool invocation; three destination entries are not a
sequential dial plan. Inspect the transfer assistant's `transferCancel` for
voicemail, busy or no answer, and `transferSuccessful` only after a human
accepts. A Vapi `forwarding` status or `assistant-forwarded-call` ended reason
shows an attempt, not an answered Birchills handset.

| Call | Controlled condition | Required observation |
| --- | --- | --- |
| D1 | Domestic, Tony available | Tony 105 answers first; two-way audio. |
| D2 | Domestic, Tony busy | One Tony failure, then Rob 109 answers; no loop or second Tony attempt. |
| D3 | Domestic, Tony no answer | One Tony timeout, then Rob answers; Tony voicemail is not acceptance. |
| C1 | Commercial, Rob available | Rob 109 answers first; two-way audio. |
| C2 | Commercial, Rob busy | One Rob failure, then Tony 105 answers; no loop or second Rob attempt. |
| C3 | Commercial, Rob no answer | One Rob timeout, then Tony answers; Rob voicemail is not acceptance. |
| D4 | Domestic, both unavailable | Exactly one deposit in shared 603; both email receipts and scoped Slack alert correlate to that message ID. |
| C4 | Commercial, both unavailable | Same 603 path and three receipts, independently correlated. |
| O1 | Office-hours named Heidi request | Open greeting discloses automated/recorded service; one spoken handover and an answered, audible transfer. |
| O2 | Office-hours gas-safety request | Hear complete **0800 111 999** before the Mary 103 transfer; hear separate 999 instruction if immediate danger is stated; check digits at v14 speed. |

All eight D/C closed calls must disclose automated/recorded service in the
closed greeting. The two O calls establish the open greeting. An approved
`#ai-emma` alert requires a delivery receipt, not merely a queued webhook;
mailbox 603 must remain separate from personal 109/105 and office 601.
Check voicemail consent/refusal from the unchanged 12-scenario suite,
and rehearse rollback to the captured previous IVR 502 route without
changing the main number during this test. If callers cannot provide a
concrete site or the intake server fails, the fail-closed branch must be
reviewed as an operational fallback before main-line launch; never assume
an engineer or mailbox took that call.

## Draft to Birchills — for Chris to review and send

> Subject: Drummonds account 3950 — readback and Stage A preparation
>
> Please confirm the **current**, timestamped routing for 01794 341600
> (office-hours rule/IVR 501 and out-of-hours/holiday rule/IVR 502),
> extension 205, Rob 109, Tony 105 and shared emergency mailbox 603. Please
> identify the supported busy/no-answer/voicemail behaviour and a reversible
> fallback to IVR 502 or the on-call mobile if extension 205 is unavailable.
> Can an isolated Emma test number reach extension 205 and exercise the
> Rob 109/Tony 105 cross-cover and final 603 path **without changing** the
> 01794 341600 rules? Please say whether the fallback is controlled by
> Birchills or by Vapi, including timeout and voicemail-answer detection.
>
> For mailbox 603, please confirm whether deposited messages can notify
> **both** rob@drummondheating.co.uk and tony@drummondheating.co.uk without
> changing their personal mailboxes. If only one address is supported, please
> describe the supported managed distribution option and its delivery
> evidence. Please also confirm a supported per-message ID/audio/notification
> feed or export so OpenFolk can verify receipt and trigger a scoped Slack
> alert. We need a stable message/call reference to match the two email
> receipts and the Slack alert to one deposit. We will not treat a configured
> recipient as a delivered message.
>
> Please make **no routing or mailbox change yet**. We will arrange a test
> window and send Chris's specific change approval separately.

After a passed real-phone drill, Stage A is only the out-of-hours and holiday
rule to extension 205, with explicit fallback and a real main-number call.
Daytime IVR 501 remains untouched. Stage B requires a separate Mary/office
agreement and Chris's separate go-ahead. Rollback is the verified previous
IVR 502 route (or 501 for a later daytime stage).
