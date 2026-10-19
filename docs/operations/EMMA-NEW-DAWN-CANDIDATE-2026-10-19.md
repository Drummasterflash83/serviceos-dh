# Emma Stage A candidate — handover and release checks

This track is separate from LEARN and the Service OS client interface. The
main Drummonds number is **not** being switched by this branch. Chris owns
Emma's launch and must give a specific go-ahead for each Birchills routing
change on the day.

## Source of truth and present evidence

- Branch: `codex/new-dawn-emma`, cut from verified GitHub `main`
  `a9ec20324ced248b60ee77ded3f8ad7fee21b890`.
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
  It will **block** a stale candidate; it does not silently update provider
  voice settings.
- National Gas confirms the National Gas Emergency Service number is
  **0800 111 999**, 24 hours, for gas leaks and suspected carbon-monoxide
  emergencies: <https://www.nationalgas.com/nec>. The caller must receive
  immediate safety advice before intake or routing.

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
   voice ID/accent, all other model/recording settings and destinations.
   Review both open and closed first messages. Use an audited candidate-only
   patch and read back; do not patch the live assistant.
4. Inspect the candidate and handoff exact hash, then run the one-time
   intake installer. Read back the saved dynamic server configuration and
   verify the receiver on a controlled candidate call. Review ambiguous
   writes; never blindly retry.
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

Arrange a quiet pre-08:00 window with Rob, Tony and Mary, plus a controlled
caller. Use the Emma **test number only**. Agree a spend cap and test times.
Match each handset observation to the Vapi call ID, Birchills call record,
voicemail record and notification receipt. Do not infer a human answer from
an invoked transfer.

- One normal named-person call: hear AI and recording disclosure, one
  handover sentence, a person answering and two-way audio.
- Domestic emergency: collect concrete address and confirmed callback,
  give immediate safety advice; Tony 105 accepts first. Repeat with Tony
  busy and with no answer to prove Rob 109 cover, each once.
- Commercial emergency: same intake; Rob 109 accepts first. Repeat with Rob
  busy and with no answer to prove Tony 105 cover, each once.
- Both engineers unavailable: confirm one deposit in shared emergency
  mailbox 603, an email receipt to **both**
  `rob@drummondheating.co.uk` and `tony@drummondheating.co.uk`, and the
  approved `#ai-emma` Slack alert. Confirm message content is access
  controlled; a queued alert is not delivery proof.
- Gas-safety case: hear the complete **0800 111 999** digits before any
  handover. Check intelligibility at v14 speed. If someone is unwell or in
  immediate danger, hear the separate 999 instruction.
- Voicemail consent/refusal, busy/no-answer and a clear rollback rehearsal.
  Check that no route loops back to 01794 341600.

## Draft to Birchills — for Chris to review and send

> Subject: Drummonds account 3950 — readback and Stage A preparation
>
> Please confirm the **current**, timestamped routing for 01794 341600
> (office-hours rule/IVR 501 and out-of-hours/holiday rule/IVR 502),
> extension 205, Rob 109, Tony 105 and shared emergency mailbox 603. Please
> identify the supported busy/no-answer/voicemail behaviour and a reversible
> fallback to IVR 502 or the on-call mobile if extension 205 is unavailable.
>
> For mailbox 603, please confirm whether deposited messages can notify
> **both** rob@drummondheating.co.uk and tony@drummondheating.co.uk without
> changing their personal mailboxes. If only one address is supported, please
> describe the supported managed distribution option and its delivery
> evidence. Please also confirm a supported per-message ID/audio/notification
> feed or export so OpenFolk can verify receipt and trigger a scoped Slack
> alert. We will not treat a configured recipient as a delivered message.
>
> Please make **no routing or mailbox change yet**. We will arrange a test
> window and send Chris's specific change approval separately.

After a passed real-phone drill, Stage A is only the out-of-hours and holiday
rule to extension 205, with explicit fallback and a real main-number call.
Daytime IVR 501 remains untouched. Stage B requires a separate Mary/office
agreement and Chris's separate go-ahead. Rollback is the verified previous
IVR 502 route (or 501 for a later daytime stage).
