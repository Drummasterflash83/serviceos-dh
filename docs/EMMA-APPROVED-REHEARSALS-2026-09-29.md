# Approved wording rehearsals

## Scope

The review now separates the client's requested improvement from existing-rule compliance. It returns one overall decision and a separate `unchanged` list. Contradictory no-change findings are rejected; old assessments remain readable without rewriting history.

The operator task desk compares a caller sentence after the original call's transcribed spoken welcome, using current instructions and the exact saved, approved proposal. The call is tenant/session bound and must have ended. Unresolved time-of-day greeting templates are refused. Vapi receives two transient text assistants, never an assistant PATCH. Tools, knowledge callbacks, phone transport, server URLs, hooks and destinations are excluded by construction. Only the existing OpenAI-backed Vapi model is supported initially.

## Safety and evidence

- Real `chris@openfolk.ai` account plus platform authority; View-As refused.
- Server-side approved proposal, optimistic version and actor validation under locks.
- One concurrent rehearsal per workspace, one-minute retry spacing, 30/day bound.
- Immutable approved snapshot, provider chat IDs, baseline/candidate replies, configuration hashes and source version.
- Provider version/hash rechecked after the comparison.
- Editing/reopening during testing supersedes the result rather than advancing the task.
- Completion is evidence awaiting human review, not a pass, release or resolution.
- The existing client progress projection queues Slack; the dispatcher includes both replies and original feedback/transcript in the configured OpenFolk route.

## Explicit limits

This is text-only testing, not voice synthesis, network quality, production routing or full regression coverage. Both comparisons disable tools and use a simulation instruction. The fixed first greeting itself is not rewritten by the proposal overlay. Human review, a recorded voice rehearsal, a reviewed exact production diff and explicit release approval still precede any live change. The live phone assistant is untouched.

## Checks before publication

- 34 targeted unit/security/notification tests passed.
- 23 rollback-only database assertions passed.
- 47 existing release-contract checks passed; production bundle built.
- Deno type checks passed for reviewer, rehearsal endpoint and dispatcher.

Production browser and Slack receipts are recorded after publication, not assumed from these checks.

## Approved voice handoff

The desk now offers a lazy-loaded approved voice rehearsal after a valid text comparison. It reuses the existing practice SDK/microphone/recording/feedback flow. The server requires real Chris authority, the current task version and approval, a matching completed v2 historical-opening text rehearsal, and an unchanged live assistant hash. A service-only transaction binds the reserved voice session to immutable proposal/approval/source/candidate-hash evidence before Vapi is asked to create the transient call. Failure refuses the call and releases its unused reservation.

The source instruction overlay is passed through the existing strict practice adapter; only approved read-only knowledge remains, and the final no-actions practice boundary remains last. The historical transcribed greeting recreates the reported scenario; it is not a change to production opening hours or greeting. Calls cannot transfer, book or mutate records. Voice feedback uses the existing verified Slack pipeline and is titled as an approved-change test. Related voice recordings are filtered to this task in the operator rehearsal history. Live production release/rollback remains unavailable pending actual recorded voice/regression evidence and separate release approval.

49 practice/voice/rehearsal checks, 27 rollback DB assertions, 47 release-contract checks, Deno check and build pass. These are not a claim of a real microphone conversation or candidate voice acceptance.
