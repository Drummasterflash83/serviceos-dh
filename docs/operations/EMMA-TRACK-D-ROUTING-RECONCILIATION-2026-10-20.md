# Emma Track D — routing reconciliation, review only

This is a **candidate plan**, not a release instruction. Chris's latest direction
supersedes the old Rob/Tony cross-cover proposal: out of hours after 17:00 on
weekdays and at weekends, an urgent domestic call goes to Tony, an urgent
commercial call goes to Rob, an urgent call whose class remains uncertain goes
to Tony, and a missed engineer call goes to the shared emergency voicemail
with email and a scoped Slack alert. Seven policy/operational questions are
already with Chris. Do not edit Vapi, Birchills, the main-number route,
provider messages, or the candidate until those answers are reconciled.

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

## Exact conflicts in the current candidate source

| Area | Current PR #88 rule | Track D direction | Required change after answers |
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

The current PR remains **draft and not deployable** while the seven answers,
fresh provider identity/route readback, revised candidate code, same-hash
provider run and handset/delivery evidence are missing.
