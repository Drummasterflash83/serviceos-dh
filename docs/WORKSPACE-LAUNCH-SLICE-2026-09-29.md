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
