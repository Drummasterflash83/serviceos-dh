# Receptionist workspace — 22 September 2026

## Scope and current boundaries

`/receptionist` is the first client-facing operational review workspace, linked from `/client` and the OpenFolk operator shell. Drummonds' receptionist is Emma. The commercial programme remains available beside it. This release does not change Vapi instructions, tools, main-number routing or staff destinations. **No Heidi or Mary invitations, recovery emails or new memberships are sent/created by the receptionist bootstrap.**

The dashboard has a daily view, searchable/paged call journal, caller histories, call detail with summary/transcript/recording link and provider assessments, persistent call-linked or general feedback, operator responses, status progression and browser-local personal preferences. Unknown caller numbers stay separate. Metrics label their loaded-history scope and assessed denominator. Vapi success is never presented as customer satisfaction; sentiment, when provided, is labelled an AI estimate. Older calls are loaded explicitly in pages of 100.

Development-only `?demo=1` provides a conspicuously labelled synthetic design preview. Production ignores it and requires authentication. No demo write sends messages or saves feedback.

## Data and access

- `receptionist_workspaces`: immutable-to-browser provider mapping and display configuration. Uses a server secret **name**, never its value. The stored launch stage is a reviewed configuration label, not live phone-line health.
- The Emma overview and details display call-data availability separately from main-number routing. Before the Birchills cutover, `Testing`/`Ready` display “Main number not activated”. After an operator verifies the real main-number route end-to-end, record that approval by changing this workspace's `launch_stage` to `Live` (and updating `reviewed_at`/`launch_note`); the UI then displays “Main number marked active”. Do not infer activation from Vapi call records or change the stage before the verified cutover. `Paused` displays “Main number paused”.
- `receptionist_access`: an optional receptionist-only membership. This does not grant commercial programme or operational access. Existing client programme members can read their company's receptionist workspace; platform operators can review workspaces.
- `receptionist_feedback`: clients append their own observations; OpenFolk admins update only response/status. Original customer text and author are protected. Version checks prevent stale writes.
- `client_notification_outbox`: transactional events for receptionist feedback/updates, programme notes and programme changes. Browser users cannot dispatch or forge receipts. This is not yet a catch-all subscription to every ServiceOS event.

`receptionist-calls` authenticates the JWT, authorises the workspace through RLS, resolves its fixed assistant ID, and reads Vapi server-side. Every returned call is checked against that assistant; mixed-scope results fail closed. No API credential reaches the browser. This is a **read-only provider view**, not a second operational ingestion pipeline. Existing interaction/phone ingestion remains authoritative for ServiceOS processing.

## Integration setup remaining

The remote secret inventory had no Vapi or Slack delivery credential at build time. Configure through a secure secret store, not chat or client code:

- `RECEPTIONIST_VAPI_DRUMMONDS`: existing private Vapi API key with call-read access.
- `RECEPTIONIST_SLACK_DRUMMONDS`: Slack incoming webhook for the confirmed destination.
- `CLIENT_NOTIFICATION_DISPATCH_SECRET`: dedicated server dispatch gate.

`client-notifications` processes a durable outbox with atomic claims, backoff and a ten-attempt ceiling. Invoke by a trusted scheduler with `Authorization: Bearer <dispatch secret>`. It is not scheduled/enabled until the destination and secrets are configured. Existing Supabase Vault + cron scheduling conventions are documented in `docs/SCHEDULER_DEPLOYMENT.md`. Messages contain company, priority, event reference and a private workspace link; no transcript or recording is copied into Slack. Delivery is at least once, not exactly once: an ambiguous network failure can yield a duplicate carrying the same reference. Failed items can be requeued under controlled administration after fixing the destination.

**WhatsApp, outbound alert calls and automatic code/prompt changes are not enabled.** Define recipient, urgency criteria, quiet hours, retries and acknowledgement before adding escalation. The UI states this explicitly. The operator details panel links to the existing **Build AI receptionist KB** task (`019f69e0-4800-76d0-ad0e-faf017a29567`). Notes stay in OpenFolk as the shared record; no unattended task dispatch is claimed.

## Seed and deployment

`scripts/client-portal/receptionist-bootstrap.mjs --apply` creates configuration only for the already-verified production Drummonds tenant `00000000-0000-0000-0000-000000000001`. Existing configuration is preserved. Emma's assistant ID `4eb2bee8-ac25-47c9-b962-409ed250ceb6` and isolated test number come from the DH Works rollback/launch record. The displayed prompt version is explicitly historical and requires provider verification.

Only migration `20261017120000_receptionist_workspace.sql` belongs to this release. Use the isolated migration directory; do not push the pending operational migrations. Deploy only `receptionist-calls` and `client-notifications`, with gateway JWT checking disabled because each endpoint performs its own appropriate authentication. The frontend release branches from production main, not the broader backend foundation branch.

## Verification

- Unit tests: assistant scoping, unknown caller separation, recording URL validation, absent measurements, structured output interpretation.
- Local rollback SQL: tenant isolation, receptionist-only boundary, immutable author/body, operator-only responses, stale-write protection, durable notification creation, anonymous/dispatcher denial.
- Browser: desktop/mobile design; caller search; correct selected call; linked observation form; saved preferences after refresh; real synthetic reviewer login, note save/persistence and pending Slack state; disconnected Vapi state.
- Local API returns authenticated `not_configured` without a key. No real Vapi call-data contract or Slack delivery test is possible until credentials are connected.
- Production build and TypeScript checks run on the isolated release.

Official provider references: [call analysis](https://docs.vapi.ai/assistants/call-analysis), [structured outputs](https://docs.vapi.ai/assistants/structured-outputs), [call list SDK contract](https://github.com/VapiAI/server-sdk-python/blob/main/src/vapi/calls/client.py).
