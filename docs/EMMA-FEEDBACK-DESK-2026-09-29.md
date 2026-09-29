# Emma feedback desk — 29 September 2026

## Scope

OpenFolk-only task queues: New, Reviewing, Needs approval, In progress, Ready to test, Resolved. Select a queue, then a report to review the original call, transcript, feedback, recommended change, test plan and customer progress. Default order is priority then newest; oldest/newest alternatives are explicit.

The dedicated OpenFolk project key has passed a small funded API request. Production uses OPENAI_EMMA_REVIEW_KEY, not the existing general-purpose OPENAI_API_KEY. The project remains within the Allkin organisation, as requested. No key is included in Git or browser code.

## Enforced boundaries

- Internal reads and actions require chris@openfolk.ai AND platform.controlplane.admin authority. Active client preview cannot edit.
- Call evidence is tenant-bound. AI assessment is read-only; source quotes must occur in the supplied transcript. Acoustic stutter cannot be diagnosed from text alone.
- The model cannot approve, release or resolve. Editing an approved proposal clears approval. Stale writes fail.
- Customer progress updates the existing feedback record and existing Slack outbox. Delivery follows the verified Notifications route.
- Thirty review attempts/workspace/day, one concurrent review and a one-minute per-report cooldown prevent accidental runaway spend. These are separate from practice-call limits.
- Automatic Vapi release, automated regression calls and continuous call scanning are NOT activated in this release. Resolution is blocked until a verified release adapter exists.

## Checks

- TypeScript, lint, production build and diff checks pass.
- Fourteen task-board/evidence unit checks pass.
- Twenty-four care-foundation assertions and fourteen desk/authority/outbox assertions pass against local Postgres with rollback-only fixtures.
- Only the two care migrations are applied to production, atomically with Chris-only hardening; unrelated migration backlog is excluded.

## Live acceptance

Use feedback 69aa728c-7022-4901-b6ba-15af576eb3f1 and its saved practice call. Claim, request a read-only review, draft a specific fix and test plan, and verify customer progress plus Slack delivery. Do not approve or alter live Vapi behaviour on Chris's behalf.
