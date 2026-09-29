# OpenFolk Notifications

Operator entry: `/openfolk/notifications?tenant=<authorised tenant ID>`.
This is not a client page. The parent route and the server independently require Chris's administrator authority; View-As cannot mutate settings.

## Connect and activate

1. In OpenFolk Slack, use a bot app with `chat:write`, `channels:read`, `groups:read`. Approve its installation; do not request message history or public-channel posting permissions.
2. Invite that bot to the intended **internal** channels, including `#ai-emma`.
3. In Notifications → Slack, enter its bot token in the protected setup form. It is transmitted over HTTPS and held encrypted in Supabase Vault. It is never returned, put in a URL, logged, or retained in browser storage.
4. Select a destination separately for Emma test reports, observations/responses and urgent feedback. Click **Send test & use this channel**. The route activates only after an exact Slack channel/timestamp receipt and a version-checked database save.
5. Submit a fresh practice report. Verify its queue row is sent, the receipt opens the correct Slack message, and the client report retains its saved/delivery status. A setup test alone does not prove the whole practice-report path.

Existing webhook delivery is retained until each route is activated. The legacy webhook's channel cannot be inferred safely from its URL. No old sent reports are replayed. In-flight messages retain their pinned destination.

## Delivery safety

- Every bot send rechecks OpenFolk workspace identity, channel membership and that the channel is not archived or shared externally.
- The queue pins route/version before transmission. There is no fallback from a failed bot route to the old webhook.
- Definitively refused sends retry with backoff, up to ten attempts. Ambiguous sends and crashed `posting` sends are held for operator review, not blindly repeated. The Notifications delivery list and existing operator health show attention required.
- A channel receipt is saved with each bot-delivered message. Legacy webhook delivery still has its original at-least-once semantics; the UI distinguishes its unverified destination name.
- Do not manually reset an uncertain send until checking the destination for its source reference/revision. No auto-retry button is exposed for uncertain messages.
- Email/SMS/WhatsApp, repeated urgent escalation and automatic Emma fixes are not implemented by this release.

## Verification and deployment

`node --test src/lib/*.test.ts scripts/brand-contract.test.mjs`

`node scripts/operator-notifications-proof.mjs` (local Docker database only; all fixtures and DDL roll back).

Run TypeScript, scoped lint, both changed Edge Functions through Deno check, and `VERCEL=1 npm run build`.

Apply only `20261023120000_operator_notifications.sql`, then deploy `operator-notifications` and `client-notifications`, then publish the Git/Vercel frontend. Do not bulk-push unrelated migrations. Until a real bot is connected, the route picker must remain setup-pending and legacy sends must continue.

The separate managed-care draft PR46 is **not** included. If later merged, reconcile its queue claim/worker definitions with the route-pinning, ambiguous-send hold and column-level grants in this migration. Do not overwrite these safeguards with the older draft.
