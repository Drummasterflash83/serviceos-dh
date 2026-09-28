# Emma care loop — implementation checkpoint

28 September 2026. **Local implementation, not a completed or deployed service.**

**Later checkpoint:** see [operator care acceptance](EMMA-CARE-ACCEPTANCE-2026-09-28.md)
for the durable worker, feedback, notification, menu and acceptance work completed
after this initial foundation. The verification counts and remaining work below are
historical, not the latest status.

## Approved outcome

Every call reviewed against approved rules; evidence-backed issues; an accountable
OpenFolk owner; tested proposals; human approval; controlled release; verified closure.
Customer language: received, picked up by OpenFolk, improvement approved, released,
checked. Never claim a fix from a model inference or a successful Slack send.

## Implemented in this checkpoint

- Dedicated operator review desk replaces the duplicated client improvements page.
- Feedback inserts atomically create an issue and history. Open historic feedback is
  backfilled; closed historic feedback is not silently reopened.
- Operator actions: take ownership, propose, approve, reopen. Optimistic locking,
  real authenticated actor, admin permission and View-As refusal enforced by SQL.
- Editing a proposal clears approval. Approval is explicitly **not deployment**.
- Both new RPC and legacy feedback status path refuse unverified closure.
- Client progress exposes only customer-safe state/message; internal evidence,
  proposals, route configuration and audit remain operator-only.
- Operator-owned versioned review rules, disabled by default. No caller content can
  become policy implicitly.
- On-demand Vapi call review endpoint: verifies real operator, tenant/assistant or
  bound practice-session identity, completed transcript, complete feedback population,
  hashes rules/evidence/model version, and stores assessment + issues atomically.
- OpenAI Responses structured review, store:false, no tools or audio, bounded inputs,
  exact quote validation, refusal/incomplete/error handling. Missing/oversized evidence
  refuses rather than truncates or reports healthy.
- Three configurable module Slack routes; saved changes reset verification. Verification
  checks the bot's workspace, configured OpenFolk team, exact channel, bot membership,
  non-archived/non-shared status; sends a non-sensitive routing test and stores receipt.
  This is a verifier, **not yet the new incident dispatcher**.

## External setup and observed blockers

- User approved new API key and processing Emma transcripts/feedback. Audio remains Vapi.
- Secure picker selected key name `Codex`, organization **Personal**, **Default project**.
  Key was securely written to the explicitly approved ignored `.env.local` in this
  worktree. Never copy it to source, browser variables or logs.
- Read-only API model-list authentication passed; gpt-4.1-mini is available.
- Synthetic review failed. Minimal follow-up confirmed HTTP 429,
  `credit_balance_exhausted` / `insufficient_quota`. No real customer evidence sent.
- No new key was installed in production. Deployment will use a server-only
  `OPENFOLK_REVIEW_OPENAI_KEY` and explicitly configured `OPENFOLK_REVIEW_MODEL`.
- Production secret-name inventory has the older receptionist Slack webhook, but not
  the new `OPENFOLK_SLACK_BOT_TOKEN`/`OPENFOLK_SLACK_TEAM_ID` connection. Existing
  automatic reports are still on the previously observed OpenFolk #dh route. Do not
  claim that the connector's manual #ai-emma posting fixes the app route.
- Chrome control failed to initialise (codex app-server). Earlier admin-policy access
  restrictions must not be bypassed using another surface. No Chrome walkthrough passed.

## Verification

- 24 local database assertions passed in one transaction; all schema and fixtures rolled back.
- 48 focused care/Slack/receptionist tests passed; production Vapi bundle proof passed.
- 43 existing prebuild checks passed; TypeScript and targeted ESLint passed; production build passed.
- Migration-order heuristic fails on four references to `public` in the unchanged
  `20261020120000_receptionist_practice.sql`. Its parser treats schema qualification
  as a table name; new migration executed successfully in the local SQL proof.
- No production migration, provider edit, routing change, message redirect or frontend deployment.

## Still required before this is the approved complete loop

1. Fund the selected API project or securely select a different funded project. Then
   run the synthetic reviewer and the approved exact real-call review; do not conflate
   transcript analysis with acoustic stutter diagnosis.
2. Durable review jobs with leases, idempotency and recovery; every-call ingestion and
   provider reconciliation, including practice calls. Stable pagination and explicit
   coverage/watermark; no hidden population cap or missed late-ended calls. Recheck
   changed rule/evidence versions. Add per-tenant workload/cost controls.
3. Persist diagnostic evidence references and available provider/network timeline,
   approved retention/deletion rules; independently verify or label unknown causes.
4. New alert outbox/dispatcher, recurring urgent escalation until acknowledgement,
   resolution deadlines after acknowledgement, deduplicated Slack threads, failed-send
   handling and an independently configured fallback. Verify actual OpenFolk #ai-emma
   delivery before changing the old dispatcher. No public recording URLs.
5. Secure Slack app connection provisioning, channel picker, least-privilege scopes,
   readable setup errors. Current route-ID fields are an operator foundation, not final UX.
6. Proposal test runner and immutable results bound to exact rules/provider version.
   Controlled Vapi deployment adapter, hash/precondition checks, release receipt,
   post-release retest and rollback. No model may grant itself release authority.
   Resolve only after passing evidence; auto-repair requires explicit pre-approved policy.
7. Group related occurrences without merging unrelated defects; detect recurrence after
   a resolution; provide issue history and evidence player in the operator desk.
8. Client progress, mobile/desktop, admin and ordinary-client proofs in Chrome.
   Simulate urgent incident, failed Slack delivery, stale approval, duplicate call events,
   cross-tenant references and a failed deployment/rollback.
9. Deploy only the verified migrations/functions and frontend through normal Git/Vercel
   process. Activate the scheduler deliberately; run real acceptance and report counts.

This checkpoint must not be described as self-learning running continuously, a verified
stutter fix, or a completed launch. It intentionally stops before changing Emma.
