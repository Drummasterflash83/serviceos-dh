# QuickBooks Online input — implementation and handover

Updated 13 October 2026. Workstream: `codex/quickbooks-integration`.

## Scope and ownership

Chris confirmed QuickBooks Online and authorised using the Drummonds developer
account initially, with an eventual move to an OpenFolk-owned app. The connector
must be available to future ServiceOS clients. No Drummonds identity, realm,
credential or company-specific mapping belongs in shared code.

Arc shows an existing **Drummonds Dashboard** app, dated 02/03/2026 and labelled
“In production”. Chris explicitly chose **Create a separate ServiceOS app** on
13 October. Leave the existing app, callbacks, permissions and keys unchanged.
Created after explicit approval on 13 October: **OpenFolk ServiceOS**, in the
Drummond Heating Dashboard developer workspace. Intuit confirmed “Your app is
ready for testing”. Only Accounting was selected; Payments was not selected.

- App ID: `4ef4971d-2a39-4309-8c6c-46510d679c59` (identifier, not a credential).
- Developer workspace ID: `9341456295810067` (not a QuickBooks accounting realm).
- Status: development/sandbox ready; production credentials locked pending app
  details and compliance. No accounting company has authorised this app yet.
- Credentials remain hidden in Intuit; no keys have been copied to local or hosted
  storage. The existing Drummonds Dashboard app was not modified.

Keep these identities separate:

- **App registration:** owner, Intuit client ID, environment, exact callback and
  server-side secret reference. This is replaceable configuration.
- **Connection:** ServiceOS tenant, verified QuickBooks realm ID (a string), app
  registration, environment and encrypted token-pair reference.
- **Source identity:** tenant + provider + environment + realm + entity type +
  external ID. Changing app ownership must not replace source identities or erase
  captured history. Names or email matches alone cannot merge financial customers.

Do not promise that Intuit app ownership or OAuth tokens can be transferred.
Plan for creating an OpenFolk registration and each client reauthorising it. Keep
the old connection paused while verifying the new app reaches the same realm;
retain source IDs/checkpoints, reconcile overlap, then retire the old access.
Intuit's current transfer options still need verification in its portal.

## Working and verified — local only

- GET-only entity page transport for customers, invoices, payments, credit memos,
  sales receipts, estimates, vendors, bills, bill payments, purchases, vendor
  credits, accounts and items. Fixed Intuit hosts and bounded queries only.
- Tenant/connection/realm/environment credential checks, before/after authority
  callbacks, request-reservation interface, response size limits, pagination and
  sanitised rate-limit/authentication errors. No automatic HTTP retries.
- Pure OAuth state/URL/callback contracts: random 256-bit state with a ten-minute
  lifetime, exact app and redirect matching, duplicate-query rejection, opaque
  errors. These helpers are not a deployed authorisation endpoint.
- Token endpoint transport supports code exchange and refresh, fixed HTTPS
  endpoint, bounded responses, replacement token pairs and provider expiry fields.
  It never retries automatically after an uncertain exchange.
- Additive SQL now stores hashed one-use state, rechecks the recorded operator's
  active grant and login, binds callbacks to the selected tenant/app/connection,
  and atomically saves the token pair with connection metadata. Reauthorisation
  preserves the realm; another company cannot silently replace retained history.
- Callback reads CompanyInfo through the exact realm-bound endpoint. Its entity
  `Id` is not assumed to equal the OAuth realm. The operator must confirm the
  returned company; initial capture remains paused.
- Refresh leases fence overlapping requests. An expired uncertain exchange requires
  reauthorisation instead of automatically resending a potentially rotated token.
- Server start/callback endpoints and the OpenFolk QuickBooks connection panel are
  implemented locally. The panel can connect, refresh status, confirm a company
  and pause. The import panel now supports explicit module enable/disable, record
  type selection, bounded starts, continuation, counts and recent run diagnostics.
- 48 targeted TypeScript tests pass (including shared dispatcher and UI parsers). An isolated PostgreSQL run verifies grants,
  tenant isolation, callback races/replays, actor revocation/bans, expired states,
  company confirmation, pause and atomic rollback after a simulated Vault write.
  The actual TypeScript start/callback/confirmation/refresh flow also passes against
  those SQL RPCs with synthetic provider responses. Vault in that fixture is a
  transactional substitute, not evidence of hosted encryption configuration.
- Full frontend TypeScript, Deno endpoint checks, 47 existing prebuild checks and
  the local production build pass using the existing local dependency installation.
  No real QuickBooks accounting data has been requested. No new code is deployed.
- Durable imports now reserve requests before HTTP, enforce a per-realm pacing
  gate, retain original JSON and immutable record versions/observations, and save
  each page and checkpoint atomically. Failed requests count against the budget;
  lost commit replies recover from the saved receipt without a second fetch.
- Exact monetary decimals reach Postgres as original JSON text. Same-SyncToken
  conflicting payloads are flagged; older versions cannot overwrite newer ones.
  Source identity survives app/connection replacement. No financial totals or
  canonical customer matches are published by this import.
- A dedicated worker is wired into the unfiltered infrastructure tick behind
  `LEARN_QUICKBOOKS_DISPATCH_ENABLED=true` and its own trigger key. Existing
  Slack/Commusoft activation does not enable it. No scheduler is enabled here.
- The actual TypeScript import worker passes against PostgreSQL RPCs and a
  synthetic provider, including exact decimals, lost replies, version conflicts,
  budget exhaustion, continuation and expired leases.
- Both migrations install and explicitly roll back under non-superuser postgres
  in a disposable clone of the local 257-table schema, after adding its two
  missing repository operator helpers. The real local Vault extension stores
  and retrieves a synthetic app secret. This augmented local clone is not proof
  of current hosted compatibility; hosted preflight remains required.
- Dedicated QuickBooks endpoints pass Deno checks. A full platform-worker Deno
  check is not complete: the existing `mailauth` npm dependency is unavailable
  in the local Deno cache and registry DNS lookup failed. Dispatcher tests pass.

Reproduce:

```sh
node --test supabase/functions/_shared/quickbooks/*.test.ts
node --test src/lib/learn-quickbooks*.test.ts supabase/functions/_shared/learn_input_tick.test.ts
python3 scripts/verify/learn-quickbooks-oauth.py
python3 scripts/verify/learn-quickbooks-schema.py
```

## Needs finishing

1. Complete configuration and production assessment for the created Intuit app.
   The portal shows App details 17% and Compliance 0%; these are provider progress
   indicators, not percentages of ServiceOS implementation completed.
2. Compare the current hosted schema with the OAuth/import prerequisites, then
   deploy matching SQL/endpoints to TEST. The augmented local rehearsal passed. Configure exact stable backend callbacks,
   `QUICKBOOKS_SITE_ORIGIN` and an explicitly selected `QUICKBOOKS_MINOR_VERSION`.
   Provision the app secret server-side and save its recovery copy securely.
3. Exercise real sandbox authorisation, token rotation and signed-in operator
   controls through TEST. Complete disconnect/provider revocation and recovery
   behaviour. Local tests do not establish real provider acceptance.
4. Obtain production app access and verify Drummonds' actual company identity
   through its authorised administrator. Never infer realm from a numeric
   JavaScript value or the developer workspace ID.
5. Verify the implemented durable request reservations, exact source versions,
   page receipts/checkpoints, bounded capture and uncertain-outcome recovery in
   hosted TEST. Exercise the new signed-in import controls and worker dispatch,
   including module disable, pause and revoked authority during a page read.
6. Reconcile offset-based backfill with subsequent changes/deletions before
   describing coverage as complete. Preserve exact raw financial values for
   decimal arithmetic; do not calculate money from rounded JS floats.
7. Map financial customers and transactions into shared customer/job context.
   Keep invoice balance, credits, payments, currency, report basis and as-of time
   explicit. Avoid counting a payment and invoice as two pieces of revenue.
   Costs need a supported allocation before claiming per-job margin.
8. Add logged OpenFolk health/recovery controls and the existing live-design
   client UX: imported counts, coverage, last successful sync, outstanding
   invoices and evidenced links to customer/job communications.
9. TEST provider acceptance, isolation/replay/refresh tests, preservation and
   recovery verification, then a separately verified production release.

Intuit's Accounting OAuth scope is the requested scope; this build enforces
read-only accounting behaviour in its transport. Do not represent the OAuth
credential itself as a provider-enforced read-only credential. Payroll and the
separate payment-processing API are outside this first connection.

## Production app requirements

The original in-app browser failed to load **App dashboard** and **Workspaces**.
Arc/direct browser controls subsequently completed the approved app creation.
Production keys remain locked behind the portal's tasks:

- Review developer profile and verify email.
- Public end-user licence agreement and privacy policy.
- Host domain, launch, disconnect, connect/reconnect URLs; exact OAuth redirects.
- At least one app category, intended regulated industries and hosting geography.
- App assessment questionnaire (not accessible until industries are selected).
- The basic information form also requests a 100×100 JPG/PNG logo under 1 MB.

The questionnaire's inline settings link currently leads to a missing page;
the app sidebar Settings route works. No compliance declarations have been
submitted. Chris requested new drafts and instructed that this first setup use
Drummonds' company details. The [privacy draft](../legal/SERVICEOS-PRIVACY-POLICY-DRAFT.md)
and [end-user terms](../legal/SERVICEOS-TERMS-DRAFT.md) now cover Drummonds' deployment,
using verified DRUMMOND HEATING LTD. details. Chris clarified that this is an
internal Drummonds application which he supplies personally, and nominated
**Chris Drummond, chris@drummondheating.co.uk** for privacy/support/security
contact. OpenFolk ServiceOS remains the software name; no separate OpenFolk
company or transfer of software ownership is assumed.
See the [publication review](../legal/SERVICEOS-LEGAL-PUBLICATION-REVIEW.md)
for remaining factual, contractual and implementation decisions. No public routes
or policy submissions have been made, and drafts are not effective agreements.
Do not invent public URLs, certify unverified controls or treat the local tests
as evidence of a working hosted integration.

## Preservation and release

Checkpoint source, tests and this handover in `Drummasterflash83/serviceos-dh`.
The dedicated QuickBooks branch has automatic Vercel Git deployment disabled.
Do not overwrite the concurrent LEARN branch or stage its inherited dirty work.
Integrate the reviewed QuickBooks checkpoint into `codex/learn-v1-test` through a
normal, non-forced merge after reconciling its current head. A Git checkpoint is
not evidence of TEST deployment or live financial capture.

Recovery copies of real app credentials belong in the authorised **Openfolk
ServiceOS** 1Password item, with the owner, environment, app ID, callback, secret
location and rotation notes. The actual new credential storage/setup will be
reviewed before provisioning the created app. This checkpoint contains no real keys.

### OAuth candidate installation boundaries

`20261102000000_learn_quickbooks_oauth.sql` creates only new QuickBooks tables and
RPCs. It relies on the existing operator authority, tenants/profiles, Supabase Auth,
Vault and provider-secret broker. No application registration, credential, client
grant, import, module flag or schedule is seeded. Anonymous callers cannot invoke
its RPCs; the callback endpoint claims state through its server-only service RPC.
End users never receive a secret, token, claim ID or stored state hash.

The operator UI is mounted on demand inside the existing LEARN input controls.
Its data is scoped to backend, signed-in actor and selected tenant. The import
worker processes one page per invocation. Runs expire within 24 hours and never
become recurring captures implicitly; budget/expiry continuations are explicit.
Query traversal is labelled separately from reconciliation/deletion coverage. Hosted
signed-in/mobile verification is still required. Existing parent-workstream dirty
files are excluded from this checkpoint; the local build is not a release artifact.

## Primary references

- [Intuit official OAuth client](https://github.com/intuit/oauth-jsclient) —
  endpoints, Accounting scope, code exchange and token refresh.
- [Get started](https://developer.intuit.com/app/developer/qbo/docs/get-started)
  — app, sandbox and production developer setup.
- [Limits and throttles](https://static.developer.intuit.com/output_html/qbo/docs/learn/limits-and-throttles.html)
  — bounded query pages and rate limiting.
- [Webhook best practices](https://static.developer.intuit.com/output_html/qbo/docs/develop/webhooks/best-practices.html)
  — reconciliation for missed events; webhooks are not yet implemented here.
