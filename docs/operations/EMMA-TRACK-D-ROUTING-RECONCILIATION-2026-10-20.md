# Emma Track D — single-engineer candidate, review only

This is **source code for an isolated candidate**, not a release instruction.
Saved decisions now establish Monday–Friday 08:30–17:00 London office hours;
weekday after 17:00, weekends and confirmed holidays use the closed route.
An eligible urgent domestic call goes to Tony 105/+441794378097 once; an
eligible urgent commercial call goes to Rob 109/+441794378105 once; a caller
who explicitly cannot classify the site goes to Tony once. Serious safety,
welfare, essential-service or property risk establishes urgency; routine work
does not. A failed selected engineer returns to Emma for one shared mailbox
603 attempt, with intended notices to rob@drummondheating.co.uk,
tony@drummondheating.co.uk and a scoped Slack channel. Current Birchills
distribution to both emails is unverified because its mailbox setting exposes
one address. Chris owns launch. No provider route, message, call or LIVE
assistant is changed by this source candidate.

The candidate code and synthetic proof now reject second-engineer cross-cover,
require caller-grounded uncertain classification, and require one failed
selected engineer before a correlated 603 deposit. The existing 12-scenario
suite has a new revision; **no** fresh Vapi 12/12 result, real handset or
notification delivery receipt exists for this revision. The direct-number
bindings and main 01794 341600 route still need fresh provider readback.

## Evidence boundary at 20 October

- Published Emma was documented as Vapi v14 on 13 October, 100% traffic, with
  the existing voice and explicit `voice.speed: 1.05`. The 20 October 02:25 UTC
  read-only provider graph saw LIVE assistant `4eb2bee8-ac25-47c9-b962-409ed250ceb6`
  at configuration-hash prefix `4d5a4078`, while the saved isolated candidate
  `dcfc2e66-a438-43ab-b863-467f5a5089df` had prefix `a7300200`. The saved
  candidate and helper lacked LIVE voice alignment, and the helper still used
  the published shared emergency tool. Those are historical observations,
  not proof of the provider's state after Chris's reported launch.
- A fresh LIVE OpenFolk metadata check around 05:24 UTC showed workspace
  stage `Ready`, still bound to the above assistant, no recent mirrored CDR,
  no 603 intake, and no launch-promotion record. The customer-facing view said
  “Main number not activated” and showed zero Vapi calls today. These do not
  establish Birchills' present main-number route or identify any separately
  launched assistant. Obtain fresh provider identities and route readback.
- Draft PR [#88](https://github.com/Drummasterflash83/serviceos-dh/pull/88)
  contains candidate-only code and synthetic checks. Its v12 **source**
  manifest and 198 passing receptionist tests do not constitute a Vapi run,
  handset transfer, mailbox deposit, email delivery or Slack post.

## Prior conflicts reconciled in source (provider state still unverified)

| Area | Previous PR #88 rule | Track D direction | Candidate source change |
| --- | --- | --- | --- |
| Engineer sequence | `receptionist-launch-candidate.ts` and `receptionist-launch-review-policy.ts` say domestic Tony→Rob and commercial Rob→Tony after a failed first leg. | One class-based urgent engineer; missed calls proceed to shared voicemail. | Remove second-engineer cross-cover from the candidate continuation and all operational wording. Keep each engineer's personal line unchanged. |
| Uncertain class | `receptionist-emergency-intake-gate.ts` admits only `domestic` or `commercial`; its classification proof rejects uncertainty. | Uncertain urgent calls go to Tony. | Add a bounded, explicit `uncertain` path; do not fabricate domestic evidence. Preserve caller-sourced name, callback, location, issue and immediate safety advice. |
| Voicemail trigger | Candidate prompt, `receptionist-emergency-fallback-proof.ts` and candidate 603 receiver require **both** engineer attempts to fail before mailbox 603. | A missed class-selected engineer goes to shared emergency voicemail. | Require one failed or genuinely unanswered transfer, followed by one independently confirmed 603 deposit. Never treat ringing, a transfer request or an engineer's personal voicemail as acceptance. |
| Release gate | `receptionist-launch-promotion.ts` requires a three-destination helper graph and human-screened, returnable plans for **both** engineers, then exact old continuation text. | One selected engineer plus shared 603 fallback. | Retain three fixed destination identities as available choices, but validate that one call cannot dial both engineers; require a returnable failed primary leg and exactly one 603 fallback. Update exact prompt/hash gates and leave the published shared tool untouched. |
| Tests | `receptionist-launch-scenarios.ts` asserts Tony→Rob or Rob→Tony; current root simulations intercept the handoff. | Domestic, commercial, uncertain and missed-to-603 behavior must be observed. | Preserve the 12-scenario baseline on one frozen hash and add same-hash targeted simulations plus real handset tests; update the publication gate to require the revised suite. Static 12/12 alone is never a provider pass. |
| Opening hours | Review policy says Monday–Friday 08:30–17:00 and holiday closure; test clocks cover one ordinary closed time and Christmas. | Weekdays after 17:00 and weekends are explicitly in scope. | Verify London weekday boundary, weekend and holiday behavior. Morning-before-opening and holiday handling await Chris's answers; do not infer a new rule from this shorthand. |
| v14 preservation | Stored provider candidate predates the 13 October v14 speech change; current gate correctly requires LIVE/candidate/helper `1.05` and voice/transcriber equality. | Keep Emma's established voice and intelligible numbers. | Read current published identity, voice, transcriber, model and configuration hashes first; copy only reviewed fields into the isolated candidate. Freeze and fingerprint **one** resulting candidate before any paid scenarios. |

## One candidate and evidence plan

1. Resolve Chris's seven answers into a single written decision table: urgent
   eligibility, the 17:00 and weekend boundary, uncertain class, missing or
   unusable caller details, failed/busy/no-answer/voicemail behavior, shared
   mailbox recipients/Slack channel, and launch ownership. Do not substitute
   this draft for those answers.
2. Read LIVE Vapi assistant/version/phone bindings and Birchills account 3950
   main-number, IVR 501/502, extension 205, Rob 109, Tony 105 and shared 603
   routing. Compare the assistant identity with the saved 20 October hash and
   determine what Chris launched. If changed, stop and rebase the review on
   that state. Neither endpoint inventory nor OpenFolk's `Ready` badge proves
   the main-number route.
3. Prepare **one isolated candidate**, retaining v14 voice ID, model,
   transcriber, 1.05 speed, clear number/postcode delivery, immediate official
   gas-safety wording and automated/recorded disclosure at all hours. Use a
   candidate-only emergency tool and server-verified intake. No published
   shared tool edit. Freeze its full provider configuration, tool graph,
   scenario suite and phone bindings to one hash before the first run.
4. Run the revised root regression suite (at least the existing 12 cases) and
   targeted domestic, commercial, uncertain, weekend/boundary and missed-to-603
   cases against that **same unchanged hash**. Every scenario must pass with
   recorded transcript/tool evidence. Mocked handoffs cannot prove telephone
   delivery. Any candidate edit resets the run; do not combine old passes.
5. On a separately approved isolated test number, observe a real domestic
   Tony answer, commercial Rob answer, uncertain Tony answer, and one missed
   primary for each path that returns to Emma and deposits **once** in 603.
   Correlate Vapi/Birchills IDs, call audio, mailbox message ID, delivered
   email receipts and a posted scoped Slack receipt. A queued/submitted
   notification is not delivered. Choose Birchills-managed or OpenFolk dual
   email distribution to avoid duplicate notices; preserve personal 109/105
   mailboxes and caller privacy.
6. Only after evidence and Chris's **separate day-of go-ahead** may a reviewed
   Birchills main-number route change be considered, with a captured rollback
   to the previous IVR rule and a real inbound acceptance call. No automatic
   launch from a synthetic pass or source merge.

The PR remains **draft and not deployable** while fresh provider identity/route
readback, one-hash provider runs, real handset/603 evidence, dual email and
Slack delivery evidence, and Chris's separate day-of go-ahead are missing.

## Smallest supervised handset check (draft, no calls placed)

Use an isolated test number and one unchanged candidate hash. Record the
caller-side audio, Vapi and Birchills call IDs, selected destination, transfer
result and time, and the original route for rollback. Schedule the closed-state
checks after 17:00 London on a weekday or at a weekend; the daytime control
must be within normal hours. Both greeting branches must audibly say that
Emma is automated and the call is recorded. Never use the main number as the
test route without Chris's separate day-of instruction.

| Call | Expected outcome |
| --- | --- |
| Domestic urgent, Tony accepts | One transfer to Tony 105; a live person explicitly accepts. No Rob call or 603 deposit. |
| Commercial urgent, Rob accepts | One transfer to Rob 109; a live person explicitly accepts. No Tony call or 603 deposit. |
| Class genuinely uncertain, Tony accepts | Caller states uncertainty; one transfer to Tony 105. No invented domestic classification or Rob call. |
| Selected engineer deliberately unavailable | Exactly one selected-engineer attempt returns to Emma; exactly one recorded 603 deposit. Correlate its provider message ID to two **delivered** email receipts and one **posted** scoped Slack receipt. No claim of attendance. |

Repeat the missed case for the other class only if the first proves the route
and the reviewed spend/window allow it. Check one routine closed caller who
declines voicemail (no transfer), one weekend boundary and one daytime gas
control (complete 0800 111 999 safety advice before Mary) on the same hash.
Any edit to prompt, voice, helper, tool or route resets the evidence set.

### Birchills information request — draft, do not send yet

> For Drummonds account 3950, please provide a read-only configuration export
> showing the current route of 01794 341600, IVRs 501/502, Emma extension 205,
> Rob 109, Tony 105, shared Emergency Call-Outs mailbox 603, and each
> busy/no-answer/declined-transfer fallback. Confirm the exact supported
> phone/SIP target for transferring a Vapi test call to 603 and how we can
> distinguish a deposited message from a mere transfer attempt. Please show
> 603's current notification address and whether two independent recipient
> emails can be configured or whether OpenFolk must handle verified dual
> delivery after deposit. Please do not alter routing, mailbox settings,
> notifications or the main number in response to this information request.
