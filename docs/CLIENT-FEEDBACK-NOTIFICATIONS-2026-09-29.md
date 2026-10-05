# Client feedback and Slack notifications

## Client experience

- Submitted: original `received` stage.
- In review: reviewing, approval, approved and verifying. Publication is not resolution.
- Resolved: only the existing resolved stage.
- OpenFolk retains its detailed task board and release controls.
- Notifications is a new client-sidebar destination. Clients can connect their own
  installed Slack bot, choose internal channels for progress/resolved/urgent,
  send a test before enabling each route, pause routes and disconnect.

## Isolation and delivery

The customer endpoint requires authenticated membership in `client_portal_access`
for the requested tenant, or Chris's verified platform admin authority. View-As
cannot configure connections. This is a workspace-wide preference, not a personal
subscription. Receptionist-only access does not grant connection-management access.

Customer Slack has separate tables, Vault secrets and an outbox. OpenFolk's Slack
team is explicitly refused and its existing routes are never edited. A Slack team
can belong to only one customer connection. No message-history permissions needed;
setup uses chat:write, channels:read, groups:read and a bot invited to its channels.
Shared/archived/unjoined channels are refused. The token is verified against its
stored team before channel selection and every delivery, never returned to a browser.

Messages contain only a fixed client status and authenticated portal link: no
transcript, caller data, free-text feedback, AI diagnosis or operator proposal.
They intentionally do not claim the issue is resolved when merely published.

Only new client-visible stage transitions and priority changes enqueue; internal
transitions within In review do not send repeated updates. Urgent feedback uses its
own route (not an automatic outage detector). Resolved takes precedence over urgent.
Historical reports are not sent on connection. Configuration changes cancel queued
old routes; already in-flight sends can finish. Network-ambiguous sends are held for
review rather than automatically retried. Confirmed Slack refusal retries with
backoff; eight attempts surface Needs checking. Delivery history remains visible.

The existing authenticated, minute-scheduled `client-notifications` dispatcher also
processes the separate customer queue. A crash after claiming a send holds it as
uncertain on the next run. Disconnect disables routes and token retrieval; the user
must remove the Slack app to revoke the token at Slack.

## Validation and launch dependency

47 focused tests, 23 rollback-only local database assertions, endpoint typechecks,
frontend typecheck and production build passed. Migration and both endpoints deployed.
No real client bot has been connected or external client message sent. End-to-end
delivery into Drummonds Slack remains unverified until its Slack administrator
installs/authorises a bot and completes Send test & turn on in Notifications.

This initial release uses secure bot-token setup, not a one-click OAuth installer.
No Slack purchases or changes to Emma's live configuration are included.
