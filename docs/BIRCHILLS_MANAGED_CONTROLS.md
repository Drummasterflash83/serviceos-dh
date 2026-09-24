# Birchills managed controls — release 1

Requested by Chris on 24 September 2026. This is a managed change-request surface, not a live PBX editor. Clients arrange proposed extension labels, group membership/order, ring strategy/time, fallback and working-hours instructions. OpenFolk applies and verifies the changes separately.

## Implementation and boundaries

- Receptionist workspace → Phones & call groups. Desktop drag/drop plus keyboard/touch-friendly member menus and move-earlier controls.
- No invented live roster. Empty proposals or explicit copies of previous submitted proposals only. Copying does not certify current state.
- Versioned, validated plan encoded in an immutable feedback body, category `routing`. Existing receptionist workspace RLS and insert privileges control tenant access. No new privilege, migration, provider credential or provider write.
- Existing durable notification trigger queues Slack notification. Queueing is not proof of delivery; existing observations view shows delivery status separately.
- OpenFolk reviews and responds under Make Emma better. Clients cannot update operator status/response. Existing optimistic version check protects operator edits.
- Request history paginates all routing requests; malformed envelopes are never interpreted as configuration. A request marked Resolved is not automatically represented as live.
- Drafts are in-memory only. Uncertain save prevents immediate retries until history has been reloaded. This is not a claim of server-side idempotency.
- No automated execution, pricing, delivery promises, invitations, account creation, call diversion or emergency-rule changes.

## Operator checklist — required for every actual change

1. Confirm the requesting tenant, request ID and authorised decision maker.
2. Read the current Birchills tenant/account and capture before-state, timestamp and provider references. Do not use a stale proposal as current truth.
3. Compare proposed changes with current state; resolve unknown extension identities, destinations and any conflict with newer requests. Confirm incoming numbers, ring-time semantics, time zone/daylight-saving and no-answer/busy/out-of-hours behaviour.
4. Confirm emergency calls, main-number routing and unlisted routes remain intact. Record a rollback plan. Changes outside the request require approval.
5. Apply the scoped changes through the supported provider interface. Future Mac mini computer control must use the same approval and verification process; it is not configured by this release.
6. Read back provider configuration. Perform authorised test calls for answered, busy, no-answer and out-of-hours paths; avoid unsolicited calls to staff.
7. Record operator, time, before/after evidence, test results and any outstanding issue in the response. Use Ready to test if client testing remains. Do not say live/verified on the strength of a save click.

## Remaining acceptance work

Import a verified current inventory so clients do not re-enter extensions; provide baseline drift checking and a dedicated server-governed approval/application ledger before unattended provider execution. Verify an authenticated client submission, persisted request, Slack delivery and operator response in the deployed environment before describing the whole managed workflow as end-to-end proven.

## Checks this release

TypeScript and production build pass. Six phone-plan contract tests plus eight existing receptionist/programme tests pass. Browser preview verifies adding/editing, accessible group assignment, review and no-send demo behaviour. Production invite and real telephone changes remain withheld.
