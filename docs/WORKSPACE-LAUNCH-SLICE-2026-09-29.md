# Workspace launch slice — 29 September 2026

This deliberately separates client navigation and provider usage from draft PR 46's
undeployed care backend. Based on released main 5874080. No new migrations,
functions, credentials, paid services, schedules or notification cutovers required.

- Client: Home, AI receptionist, Modules, Invoices, Review & feedback.
- Operator: Client overview, AI receptionist, Modules, Invoices, APIs / Accounts & costs.
- Modules and invoice records retain existing RLS, optimistic editing and published data.
- Old Programme/outcome/investment links map to the replacement sections.
- APIs uses the existing authorised directory and receptionist-calls endpoint.
  Call cost and duration are grouped daily, weekly (Monday) or monthly in UTC.
  Pagination, missing costs/durations, undated calls and restricted assistant scope
  remain explicit. Costs are provider-reported USD call costs, not invoice totals,
  remaining credit, account-wide spend or external-provider charges.
- No screenshot figures or financial account identifiers are baked into public JS.
- Direct Vapi and AI billing links retain provider-owned cards and recharge controls.

Chris reported setting Vapi's trigger to $5 and retaining $10 reload. His earlier
screenshot showed $8.26 credit and 14 September minutes. These are observations,
not a live feed, and are not seeded as current production values.

The managed review desk, durable drafts and automated Slack/review worker remain
on PR 46 and are not activated by this slice. Existing call/practice/feedback
behaviour remains unchanged. No claim of a completed self-improving system.

Release requires fresh tests/build and authenticated preview smoke verification.

Local verification: 192 Node tests passed, including seven provider-usage tests;
46 prebuild navigation/branding/performance checks passed; Vercel-target build
passed. Authenticated browser acceptance and production promotion are outstanding.

Navigation follow-up: Chris reviewed the preview and reported seeing Vapi costs.
Accounts & costs now carries the selected client in URL state, retains the full
client menu and links back to that client's overview/modules/invoices/future tools.
Changing clients updates the menu and call scope together; inaccessible explicit
client references do not fall through to another client. Added three regression
checks; the complete Node set now passes 195 tests. TypeScript, scoped lint and
Vercel-target build pass. No production promotion or managed-care activation.

## Final release review — 29 September

Chris explicitly approved publishing this bounded release and confirmed the sole
human operator email is `chris@openfolk.ai` (not the mistyped openolk address).
Read-only production verification found exactly one effective platform grant:
that account's `platform.controlplane.admin`. Its profile matches the same Auth
identity. No legacy `role=openfolk` profiles exist. The grants table has RLS and
only an operator SELECT policy; ordinary authenticated users cannot grant themselves
authority. No permissions or identities were changed.

Read-only transaction-local SQL identity simulations against the deployed gate:
Chris can view/admin; an ungranted identity cannot view/admin and sees zero grants.
This is database-layer evidence, not a separate-user browser login test.
The parent `/openfolk` layout now also waits for server-verified admin authority,
limits the UI to Chris, and fails closed on denied, pending, timeout or failed
checks. Child reads/writes retain their independent backend gates.

Fresh verification: all 196 library/brand tests, 21 control-plane authority checks,
47 prebuild checks, TypeScript, scoped lint, Vercel-target build and diff checks pass.
Chris has reviewed the preview and reported actual Vapi usage visible. Automated
authenticated browser smoke remains incomplete: the browser tool refuses access
because its admin-enforced security policy cannot be verified. No bypass attempted.
Production publication is user-authorised with this testing gap explicitly reported;
do not describe this as a complete end-to-end handover sign-off.

Production receptionist workspace reads `Ready`; main-number activation is separate.
One feedback record is `New`, with one outbox row marked `sent`. That status alone
does not prove delivery to the approved OpenFolk #ai-emma destination. Managed-care
automation, automatic diagnosis and that end-to-end delivery proof remain separate.

Pre-release rollback target: `dpl_BMWdeNc3u1uzVnMwqCQTHN4SDGE9`
(`serviceos-8fcfsxbc9-allkin.vercel.app`, Ready production before this release).
No new backend migrations/functions, paid-service settings, phone routing or Heidi
invitations are included.
