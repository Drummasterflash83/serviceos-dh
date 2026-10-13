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
- Development credentials were provisioned after explicit approval as recorded
  below. The existing Drummonds Dashboard app was not modified.

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

## Job-code authority — Chris, 13 October 2026

For Drummonds, **Commusoft is the source of truth for current job codes**.
Chris gave `001`, `008` and `016` as examples and cautioned that QuickBooks may
still contain older codes such as `15b` and `13a`. This is a source-precedence
rule, not a verified mapping between those examples.

- Preserve codes as strings, including leading zeros. Do not convert `001` to `1`.
- Retain QuickBooks' original codes on financial source records and their history;
  never silently rewrite them or use them to replace current Commusoft codes.
- Link financial records to jobs only through an explicit, evidenced,
  tenant-scoped crosswalk. Hold missing or conflicting mappings for review.
- Verify the field's meaning before matching: a job/service-type code is not
  necessarily a unique individual job number. Code equality alone is insufficient
  to merge jobs, customers or financial records.
- Present the current Commusoft code on matched job cards and retain the original
  QuickBooks reference as source context. Other clients' source precedence remains
  configurable; these Drummonds examples must not become shared hard-coded rules.

This records the agreed integration contract. It does not establish that a
crosswalk has been implemented or that QuickBooks LIVE import is complete.

## Working and verified — local only

- GET-only entity page transport for customers, invoices, payments, credit memos,
  sales receipts, estimates, vendors, bills, bill payments, purchases, vendor
  credits, accounts and items. Fixed Intuit hosts and bounded queries only.
- Tenant/connection/realm/environment credential checks, before/after authority
  callbacks, request-reservation interface, response size limits, pagination and
  sanitised rate-limit/authentication errors. No automatic HTTP retries.
- Pure OAuth state/URL/callback contracts: random 256-bit state with a ten-minute
  lifetime, exact app and redirect matching, duplicate-query rejection, opaque
  errors. Hosted TEST endpoint verification is recorded below; no company has
  authorised the application yet.
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
- 58 targeted TypeScript tests pass (including disconnect, shared dispatcher and UI parsers). An isolated PostgreSQL run verifies grants,
  tenant isolation, callback races/replays, actor revocation/bans, expired states,
  company confirmation, pause and atomic rollback after a simulated Vault write.
  The actual TypeScript start/callback/confirmation/refresh flow also passes against
  those SQL RPCs with synthetic provider responses. Vault in that fixture is a
  transactional substitute, not evidence of hosted encryption configuration.
- Full frontend TypeScript, Deno endpoint checks, 47 existing prebuild checks and
  the local production build pass using the existing local dependency installation.
  No real QuickBooks accounting data has been requested. Hosted TEST deployment
  has since progressed as recorded below; there is no QuickBooks production release.
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
- All four migrations install and explicitly roll back under non-superuser postgres
  in a disposable clone of the local 257-table schema, after adding its two
  missing repository operator helpers. The real local Vault extension stores
  and retrieves a synthetic app secret. This augmented local clone is not proof
  of current hosted compatibility; hosted preflight remains required.
- Dedicated QuickBooks endpoints pass Deno checks. A full platform-worker Deno
  check is not complete: the existing `mailauth` npm dependency is unavailable
  in the local Deno cache and registry DNS lookup failed. Dispatcher tests pass.

### Customer finance — 13 October, 16:55 UTC

The customer-card finance section is implemented in the existing business-context
component, so it is available to both the client card and the logged OpenFolk
customer view once that frontend is released. It loads on request, clears on
actor/tenant/card/backend/environment changes and when the tab is hidden, and
expires after one minute. Its frontend build and TypeScript checks pass; signed-in
finance-card browser/visual acceptance remains outstanding. The frontend is now on stable TEST as recorded below.

- Explicit operator review links a captured QuickBooks customer to an existing
  tenant-owned card. No fuzzy matching, automatic parent/subcustomer roll-up or
  app-registration-dependent identities. Revision checks prevent overwriting
  concurrent decisions; corrections/unlinking retain the audit and source history.
- Identity changes or source conflicts withhold a customer's financial figures
  until reviewed again. Balance-only changes do not invalidate identity review.
- Captured invoices, payments, credits, sales receipts and estimates are separate.
  Invoice balances are not reduced a second time by payments/credits. Amounts
  stay exact decimal strings from PostgreSQL through browser formatting. Totals
  are grouped by provider company, currency and entity; unknown currency or
  missing amounts withhold the affected aggregate. No profit claim is made.
- Ordinary reads require the existing tenant owner/admin authority. Cross-client
  reads and matching require an existing active OpenFolk admin and logged reason.
  Every finance read/link decision is audited; direct table access is revoked.
- Coverage remains **retained, unreconciled records**. This is not a current
  statement of account or evidence that deleted/missed transactions are reconciled.

Installed only in TEST: `quickbooks_customer_finance_v1`, receipt time
`2026-10-13 16:55:24.359864+00`. The exact migration passed a hosted rollback
rehearsal first. Readback matched all six function bodies to local source and
verified RLS/grants plus missing-identity, anonymous, service and direct-table
denials. TEST still has zero app registrations, connections, imported records,
customer links and finance events. No provider calls or credentials were added.
See [finance verification evidence](evidence/learn-quickbooks-finance-2026-10-13.json).

One initial local OAuth fixture run rejected timestamp validation before reaching
finance checks. A clock probe and the subsequent complete run passed; the cause
of that isolated failure is not established. The fixture now reports database-clock
and lifetime assertion failures explicitly. Production validation was not relaxed.
Check this again during real OAuth acceptance rather than treating a passing rerun
as proof that the original failure was fixed.

### Disconnect and reconnect — local verification, 13 October

The fourth additive migration and dedicated `quickbooks-disconnect` endpoint are
implemented and tested locally, and have now been **installed in hosted TEST** as
recorded below. Neither is installed in LIVE. The existing start/callback/worker
source closures are unchanged. The frontend now requires the disconnect status
RPC; that prerequisite is present in TEST but must be installed before any LIVE
frontend release.

- An authenticated OpenFolk admin's logged request stops the selected connection,
  pauses queued/running imports and preserves retained pages/source history.
  Only a single-use service lease releases the token for Intuit's revoke endpoint.
- A successful HTTP 200 receipt clears the saved token pair. Timeout, rejection,
  expired lease or lost settlement reply cannot be reported as confirmed revocation
  or automatically trigger another provider request. Status distinguishes stopped
  capture, pending revocation, confirmed revocation and operator review.
- Unsettled disconnects prevent reauthorisation of that connection and new OAuth
  exchanges for the same app (whose target company would not yet be known).
  Existing other-company captures remain available. Shared-company grants and
  uncertain exchanges require coordinated operator review, not blind revocation.
- Explicit recovery supports resuming an unclaimed queued request, or recording
  a provider-side removal after review. An operator review is labelled separately
  from Intuit's API receipt and cannot settle while another shared connection is
  active or an exchange is still within its lease. It never enables capture.
- Operator controls include a disconnect confirmation, saved status, reconnect
  blocking while unresolved, and a recorded manual-review path. These controls
  pass frontend checks but still need signed-in browser/mobile acceptance.
- Actual TypeScript against disposable PostgreSQL verifies stop/revoke/reconnect,
  duplicate requests, uncertain results, manual recovery, shared-grant isolation,
  expired leases and source preservation. Two concurrent service acquisitions
  release credentials once; an ended operator grant prevents subsequent access.
- The exact migration installs and rolls back in the augmented 257-table local
  schema under non-superuser postgres. This is not hosted compatibility or real
  Intuit acceptance. The provider responses in lifecycle tests are synthetic.

See [disconnect verification evidence](evidence/learn-quickbooks-disconnect-2026-10-13.json).

Hosted TEST release `quickbooks_disconnect_v1` installed at
`2026-10-13 17:33:23.508781+00`, following an exact transaction/rollback rehearsal.
The eight function bodies, owners, security-definer/search-path settings,
user/service grants and both trigger bindings match the implementation. Runtime
denial probes passed without creating identities or retained data. The initial
preflight caught the hosted Vault helper's five-argument signature (with defaults),
which differs from the disposable fixture; the prepared guard now uses the actual
hosted signature.

`quickbooks-disconnect` is ACTIVE version 1, artifact
`a2d49119783e3b6b35fee7ac6e55f10b4ab28543b986747bbaca04de41574990`.
Downloaded runtime readback matched all four source modules. HTTP checks returned
204 for the allowed-origin preflight, 401 for an unsigned request and 403 for a
foreign origin. All other TEST endpoints were unchanged. The foundation audit
still passes with 15 private tables and **zero apps, connections, imports, pages,
source records and disconnect requests**. This is hosted deployment evidence, not
successful signed-in/provider revocation acceptance.

Reproduce:

```sh
node --test supabase/functions/_shared/quickbooks/*.test.ts
node --test src/lib/learn-quickbooks*.test.ts supabase/functions/_shared/learn_input_tick.test.ts
python3 scripts/verify/learn-quickbooks-oauth.py
python3 scripts/verify/learn-quickbooks-schema.py
```

## Working and verified — hosted TEST, 13 October

- Read-only catalog checks completed for TEST `saatxzwxvdvqevbnskxy` and production
  `tgbnakbxwcqjeimygroz`: all nine prerequisite functions exist, expected referenced
  columns/indexes match, and neither initially contained QuickBooks objects.
- The exact additive TEST bundle passed a hosted transaction/rollback rehearsal,
  then installed at **16:28:26 UTC**. Its receipt records both source hashes.
  Twelve private tables (including the release receipt) have RLS and no anonymous
  or authenticated direct-table access. Operator/worker RPC grants match scope.
- Three new TEST endpoints are ACTIVE at version 1: `quickbooks-oauth-start`,
  `quickbooks-oauth-callback` and `learn-quickbooks-worker`. Other TEST endpoints
  were unchanged. The existing platform-worker has **not** been redeployed here.
- Downloaded source closures match the reviewed local modules: seven for start,
  seven for callback and eight for worker. This is actual runtime readback,
  in addition to deployment metadata and public HTTP checks.
- Verified HTTP results: allowed-origin preflight 204; unsigned start 401;
  foreign-origin start 403; invalid callback 400 with no-referrer/no-store and
  stable TEST return; unconfigured worker 503. The worker trigger is not provisioned.
- Hosted rollback probes deny missing identity, anonymous and client worker/raw
  table access. The service worker returns idle and releases no credential.
- Only non-secret `QUICKBOOKS_SITE_ORIGIN=https://test.openfolk.ai` and
  `QUICKBOOKS_MINOR_VERSION=75` were configured. The latter is an explicitly
  pinned test version documented in [Intuit’s SDK release history](https://github.com/intuit/QuickBooks-V3-PHP-SDK/releases).
- **Zero apps, connections, import runs, pages or accounting source records.**
  No provider credentials, new users/grants, schedules, capture or production
  changes. Real sandbox/company OAuth and signed-in browser acceptance remain.

Evidence: [hosted TEST release](evidence/learn-quickbooks-test-foundation-2026-10-13.json).
The first runtime attempt stopped after settings were saved because Supabase
returned an empty success body. An independent inventory confirmed those exact
setting hashes and zero endpoints before continuation; the response parser now
accepts empty success bodies and skips already-matching settings.

### Provider diagnostics — hosted TEST, 13 October 18:03 UTC

All four QuickBooks TEST endpoints are now v2 with sanitised Intuit trace logging.
The fixed read/token/revoke transports preserve responses and retry behaviour;
logging excludes credentials, company identifiers, URLs, query strings and bodies.
Logging failure cannot repeat a provider request. The change follows Intuit's
[transaction-ID troubleshooting guidance](https://github.com/intuit/oauth-jsclient#debugging-oauth-errors).
All 55 transport/frontend-contract tests and four Deno endpoint checks pass.
Downloaded executable closures match; all eight unauthenticated/CORS/idle probes
pass. No QuickBooks credential, company, import or worker key is configured.

The first release check reported a secret-metadata mismatch. Investigation found
Supabase-managed `SUPABASE_*` timestamps matching the deployment time; custom
secret timestamps predate it, configured QuickBooks values match and two later
reads have equal value fingerprints. The script made no secret writes. Because
its initial fingerprint included timestamps, exact before/after value equality
for every secret is not proven. Preserve this limitation and the initial journal;
future checks now fingerprint names/values separately. Other endpoint artifacts
and QuickBooks counts are unchanged. No production or real provider request occurred.
[Release evidence](evidence/learn-quickbooks-test-tracing-2026-10-13.json).

### Protected frontend candidate — 13 October

The clean managed release worktree is now
`/Users/chrisdrummond/.codex/worktrees/quickbooks-test-release/ServiceOS`.
An ordinary merge of LEARN `92834cd` and QuickBooks `7a5f2cd` produced
`769aace2e8f5c971deb1bda94c342d4c6381a0d9`, backed up and verified on
`codex/quickbooks-integration`. It preserves paced Commusoft draining and independent
QuickBooks dispatch. All 89 combined tests, TypeScript and the local build passed.
The original d322 worktree and its inherited uncommitted changes remain untouched.

The initial protected preview `dpl_4XaKvd6y88DBwo21pqZBcnVv3N6H` was not
promoted because TEST lacked the newer optional Slack recovery helpers. That gap
is now resolved by explicit backend capability metadata, rather than installing
unrelated Slack capture changes. Existing campaign permissions, pagination and
rows are unchanged. Unsupported advanced controls are withheld and explained.

### Stable TEST frontend released — 13 October, 18:22 UTC

Git `b46cb2dc0fd133c773d236e532fa74db8d732a68`, deployment
`dpl_5agREx9pF4kCMmC52BLmDzo8t31w`, now serves both `test.openfolk.ai` and
`serviceos-learn-test-allkin.vercel.app`. Vercel reports READY, the TEST project
retains `all` protection, and both HTTPS login routes redirect anonymous requests
to Vercel authentication. Chris's existing signed-in session survives the release.
The rendered build badge confirms `b46cb2d`, Preview, and TEST backend
`saatxzwxvdvqevbnskxy`.

Signed-in Drummonds TEST acceptance verified the QuickBooks connection and import
panels: no app registration, no connected company, no captured records, disabled
input, and disabled connect/start controls. Slack campaign status loads and says
advanced recovery is unavailable in TEST, while preserving ordinary controls.
No console warnings/errors were observed on these checked routes. Opening the
client overview also showed an unresolved report-status check; this observation
is not an all-clear for the broader workspace and was not attributed to this
release without a baseline comparison.

The 78 combined QuickBooks/Slack tests, TypeScript and frontend build pass.
The exact optional-capability migration passed isolated SQL checks and hosted
rollback/install checks with permissions and unrelated functions unchanged.
No credentials, provider calls, new grants, captures or production changes were
made. Real sandbox OAuth/import/refresh/disconnect, finance-card visual acceptance,
mobile acceptance and the production release are still open.
[Release evidence](evidence/learn-quickbooks-stable-test-2026-10-13.json).

## Needs finishing

1. Complete configuration and production assessment for the created Intuit app.
   The portal shows App details 17% and Compliance 0%; these are provider progress
   indicators, not percentages of ServiceOS implementation completed.
2. TEST foundation and four standalone endpoints are installed and checked above.
   Provision the development app secret server-side and save its recovery copy
   securely. Add the exact TEST callback to the development app registration.
   The signed-in frontend is released; configure the independently gated
   worker dispatcher only for an explicitly defined sandbox import scope.
3. Exercise real sandbox authorisation, token rotation and signed-in operator
   controls through TEST. Disconnect/provider revocation and recovery are now
   installed in hosted TEST; exercise them against the real sandbox.
   Local tests do not establish real provider acceptance.
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
- App assessment questionnaire (now unlocked; not yet completed or submitted).
- The basic information form also requests a 100×100 JPG/PNG logo under 1 MB.

Chris explicitly approved the regulated-industries declaration **None of the
above** on 13 October. It was saved and verified in Intuit: the Save button became
disabled and Compliance's Start questionnaire became enabled. The previous
automatic approval-review block for that declaration is resolved. The assessment
is now open in Arc; no questionnaire answers have been saved or submitted.
The extension connection subsequently stalled; native Arc accessibility controls
can read the questionnaire. The temporary extension viewport still needs resetting
when that connection recovers.

Chris requested new drafts and instructed that this first setup use
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
Do not invent public URLs or certify unverified controls. The hosted TEST
foundation now exists, but no real company is connected and no accounting
import has been accepted.

### Assessment preparation — observed questionnaire, 13 October

The questionnaire has six sections. This is a preparation record, not a submitted
declaration or an assertion that all controls pass. Conditional follow-up questions
may appear after answers are selected.

| Section | Observed questions and supported position |
| --- | --- |
| General | Chris confirms no regulatory complaints/investigations or sanctions, and no legal-counsel review. These are owner statements, not an independent audit. Security-policy compliance requires an evidence review. The app is relevant to business/accounting workflows. ServiceOS includes generative AI; do not answer “no” merely because this initial connector does not send QuickBooks records to AI. |
| App information | Custom application; server-side Web/SaaS calls; accounting reads only in this connector. Current registration is for Drummonds' internal deployment, with reusable architecture for future clients. It is not a platform that lets outside developers obtain QuickBooks API access, and clients do not need to create their own Intuit developer apps. Disclose the use of development tools accurately. Other ServiceOS inputs include Commusoft, email, telephony and Slack. Review exact available options before entering answers. |
| Authorization | Intuit asks explicitly about sandbox/non-production connect, disconnect and reconnect testing. Connect and accounting reads now pass against Intuit sandbox; provider refresh, disconnect/revocation and reconnect after revocation remain unverified. It also asks about refresh frequency, failed auth retries, reconnect prompts, discovery-document endpoints, expired access/refresh tokens, invalid grants, CSRF and reliance on offline OAuth tools. Existing code/SQL tests support some controls, but cannot be substituted for the missing provider lifecycle run. |
| API usage | API categories and per-customer call frequency. The initial connector uses Accounting entity queries and CompanyInfo; bounded imports reserve requests and pace requests per realm. No perpetual live sync schedule has been enabled. Do not invent a polling frequency or claim reports/webhooks/CDC are implemented. |
| Error handling | API/syntax/validation error tests, `intuit_tid` capture, troubleshooting logs and in-app support. TEST v2 endpoints now record bounded `intuit_tid`, HTTP status and operation metadata in existing Edge logs; 55 tests, Deno checks and downloaded runtime comparison pass. Real provider receipt and log-retention verification remain open; this is not an indefinite diagnostic archive. Sanitised errors and bounded retry behaviour have tests. Verify support access and actual retained diagnostics before answering. |
| Security | Chris confirms no notifiable breach history and nobody appointed to review security risks; the assessment draft records Security Team = No. The exposed development secret was rotated by the owner and its replacement verified in TEST Vault, Keychain and 1Password; production credentials are not provisioned. MFA, CAPTCHA and WebSocket use require a current app/configuration check. Authorised OpenFolk operators can access tenant information for support: do not claim only an individual customer can ever see their information. Ordinary tenants remain isolated. |

Next provider acceptance step is a real sandbox lifecycle run after the exact
callback and secure development-credential destination are prepared. Production
keys and live company authorization remain outstanding. The disconnect migration
has now passed local lifecycle, concurrency, uncertain-outcome and recovery checks
and hosted deployment verification recorded above; real provider acceptance remains
required.

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

### Development credential setup — held for owner rotation

Chris approved the exact development callback and credential destinations on
13 October. Intuit saved the additional Development callback below, with the
default OAuth Playground callback preserved:
`https://saatxzwxvdvqevbnskxy.supabase.co/functions/v1/quickbooks-oauth-callback`.
The default entry remains unchanged. This is the deployed TEST callback, with
one-use state, server-side token exchange and a return to `https://test.openfolk.ai/openfolk`.

At 18:28 UTC the existing app was registered in TEST as sandbox, revision 1.
The client ID, secret, environment and callback were compared in memory and match.
The signed-in TEST screen now shows “Sandbox · 4ef4971d”. Connections/imports are
still zero. The initial Keychain copy was saved and read back. The development secret was
subsequently treated as exposed when a native 1Password field observation included
selected text in tool output. The unsaved 1Password edit was cancelled and its
temporary transfer file removed. TEST app registration is now **inactive**, still
revision 1. The old Keychain/Vault values require replacement following the owner's
rotation. No secret has been rotated by the agent and no company was authorised.

Chris has been asked to rotate only this app's Development client secret in Intuit.
The correct page is open in Arc with credentials hidden. Do not reuse the old
secret, retry the old authorization link, or re-enable the app before replacement.
The approved credential destinations remain TEST Vault, the existing Keychain
service and the existing 1Password note; no wider destination is introduced.
Future native UI observations must allow-list only specific safe output: filtering
`Value:` lines is insufficient because accessibility output may include a separate
selected-text block. Do not write raw credential-bearing UI state to logs.

A genuine signed-in OAuth start ran at 18:38:11 UTC and reached Intuit sign-in.
Readback confirmed environment sandbox, status authorizing, token generation 0,
no bound realm and no saved token. The pending request grants no company access;
app inactivity now fences its exchange. The in-app flow needs an Intuit sign-in
before a fresh consent review. Arc stalled loading the workspace/consent view;
no successful Arc consent is claimed. No accounting records were imported.

The restricted SQL read-only API could not decrypt Vault; verification succeeded
through an explicit read-only transaction using the existing privileged database
route. No grants changed and the registration was not retried.

Approved scope:

- Read the existing **development** client ID/secret for OpenFolk ServiceOS,
  app `4ef4971d-2a39-4309-8c6c-46510d679c59`; do not generate/rotate a key or alter
  the separate Drummonds Dashboard app.
- Register that ID in TEST `saatxzwxvdvqevbnskxy` as environment `sandbox`, with
  the exact callback above. The existing service-only registration RPC stores
  the client secret in Vault as `quickbooks_app:4ef4971d-2a39-4309-8c6c-46510d679c59`.
  It remains until explicitly rotated/retired; no browser/client can read it.
- Keep a local recovery copy in this Mac's Keychain under
  `serviceos.quickbooks.development.4ef4971d-2a39-4309-8c6c-46510d679c59`, and in
  the existing **Openfolk ServiceOS** 1Password item, labelled Development/Sandbox.
  Any temporary transfer file must be private (0600), excluded from Git/output,
  and removed after storage verification. Never put credentials in chat or logs.
- Verify saved registration metadata and secret equality in memory. Do not
  print plaintext or commit credential fingerprints.
- This setup does **not** authorize any QuickBooks company, create users/grants,
  import financial records, activate schedules, change production, or widen the
  selected Intuit Accounting scope. Real sandbox-company authorization is the
  next separate provider grant, reviewed at its consent screen.

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

### TEST release operations

- `scripts/verify/learn-quickbooks-hosted-preflight.mjs test|production` is read-only.
- `scripts/verify/learn-quickbooks-test-foundation.mjs prepare|rehearse|install|verify`
  is hard-bound to TEST. Preparation records exact helper/column prerequisites;
  installation uses one transaction, a receipt and no automatic write retry.
- `supabase/release/quickbooks-test/001_foundation.sql` and its manifest are the
  installed bundle. It seeds no credentials or capture configuration.
- `scripts/verify/learn-quickbooks-test-runtime.mjs deploy|verify` deploys only the
  three new endpoints, refuses unreviewed replacement, and keeps imports disabled.
- `scripts/verify/learn-quickbooks-test-runtime-readback.mjs` verifies downloaded
  version-1 source closures. Do not silently widen its expected version after a
  later release; update the release record and source evidence first.
- `scripts/verify/learn-quickbooks-test-disconnect.mjs prepare|rehearse|install|verify`
  manages only the TEST disconnect extension. `003_disconnect.sql` and its
  manifest record the installed guarded bundle and source hashes.
- Add `disconnect` to `learn-quickbooks-test-runtime.mjs deploy|verify` or
  `learn-quickbooks-test-runtime-readback.mjs` to target only that endpoint.
  Deployment refuses to overwrite an existing endpoint; all downloads verify
  version 1 explicitly. No credentials or company grants are provisioned by these scripts.
- `scripts/verify/learn-quickbooks-test-denials.sql` is a rollback-only TEST role
  probe; it does not create users, grants or credentials.

Do not deploy the full platform-worker from this fork without reconciling its
current parent-workstream changes and resolving the existing Deno mailauth
check. The standalone QuickBooks endpoints do not require that replacement.


### Connection guide on TEST — 13 October 2026

The `/quickbooks` route provides connect/reconnect and disconnect guidance using
the existing OpenFolk branding. It links to the signed-in operator controls,
explains Intuit's broader Accounting permission and retained history, and uses
Chris's approved Drummonds support address. It contains no company records,
connection status, legal policy or automatic provider action.

Local production build and TypeScript checks passed. Desktop and 390 px mobile
views were inspected; both modes fit without horizontal overflow and reported
no browser warnings/errors. Protected TEST deployment `dpl_HnmKvRxyTC79N3jBWQ4vVExpoRn5`
from Git `3817044c4a5d2dd893769c8aa239169f4526181f` now serves both stable TEST aliases.
Hosted connect/disconnect rendering and sign-in destinations passed; TEST protection
remains `all`. Intuit Development App URLs were saved and survived reload: host
`test.openfolk.ai`, launch `/quickbooks`, reconnect `/quickbooks?mode=connect`,
and disconnect `/quickbooks?mode=disconnect`. These are guidance pages, not
an OAuth callback or a provider revocation endpoint. Production settings remain
unchanged. The development app remains inactive pending owner
secret rotation; this guide does not establish OAuth or accounting acceptance.


### Production package prepared and locally rehearsed — 13 October, 19:00 UTC

A fresh read-only LIVE catalog check found the required ten helper functions,
customer-card/profile columns and no existing QuickBooks relations. The new
`supabase/release/quickbooks-production/001_quickbooks.sql` combines the four
exact migrations in one transaction with a private source-hash receipt. Its
guards pin the target setting, prerequisite bodies/owners/search paths and
user/service execute permissions, required column types and absence of existing
QuickBooks functions/relations. The target setting is an operator mistake guard,
not independent proof of backend identity.

`learn-quickbooks-production-package.mjs prepare` performs only metadata reads
and local artifact writes. `verify` checks source and artifact hashes offline.
It deliberately has no installation command. Four targeted tests pass for stale
or wrong-target catalogs, incomplete prerequisites and altered transaction
boundaries.

The exact bundle passed install and rollback in a network-isolated clone of the
257-table local schema under non-superuser postgres. Three missing repository
helpers were added to that clone only. The first attempt rejected their default
execute permissions: the fixture now applies their actual repository revocations
and grant, rather than weakening production guards. Explicit wrong-target,
widened-permission and repeated-install probes reject safely. Private table/RPC
permissions and a synthetic local Vault round trip pass.

This is **prepared, not installed**. The clone has no production customer rows;
it does not prove live row preservation, provider acceptance or current production
schema equivalence beyond the checked prerequisites. Refresh the catalog and
recovery/preservation evidence before installation. Production credentials,
company consent, matching runtime/frontend release and the real sandbox lifecycle
remain outstanding. No live data, secrets, grants or schedules changed.

[Package rehearsal evidence](evidence/learn-quickbooks-production-package-2026-10-13.json).


### Shared LEARN integration — 13 October

The QuickBooks worktree has merged shared TEST head `b88fbcf`, retaining the newer
reviewed Commusoft account-holder and contact reconciliation work. The shared
branch introduced `20261101970000_learn_customer_account_holder.sql`, colliding
with this branch's Slack capability-reader migration number. The unchanged Slack
SQL is now named `20261101971000_learn_slack_control_capabilities.sql`; verification
scripts use the new path. The historical TEST evidence retains its original path
and source hash, since that is what was applied. This rename does not reapply SQL,
alter any stored receipt or change a hosted migration history.

Two earlier duplicate migration versions (`20261023190000`, `20261023200000`)
predate this integration and are outside this rename. Production QuickBooks uses
its exact guarded release artifact, not an indiscriminate migration push.

Combined validation passed: 175 targeted TypeScript tests across QuickBooks,
Slack, Commusoft review and the dispatcher; 18 Python reconciliation planner
tests; production build and full frontend TypeScript. The renamed Slack SQL
also passed its isolated PostgreSQL rollback, pagination, capability and access
checks. This is source integration acceptance, not a new hosted release or real
QuickBooks provider acceptance.


### Owner rotation completed — 13 October, 19:16 UTC

Chris confirmed rotation of the Development client secret. The new value was
captured without diagnostic output, verified as different from the old value,
and saved to the existing TEST Vault app (revision 2, active), the same Mac
Keychain entry and a concealed field in the existing Openfolk ServiceOS 1Password
note. Existing note fields were verified unchanged. The private temporary
transfer file was removed. Production and the separate Drummonds Dashboard app
are unchanged; no company consent or financial import is established by this.

The raw HTML reported by Chris exposed a callback presentation bug: Supabase
rewrites GET `text/html` responses to `text/plain` on the default function domain.
The callback candidate now issues a no-store 303 to the configured frontend
connection guide, forwarding only a fixed `review` or `needs_check` indication,
with no OAuth parameters and an empty fragment. Guidance explicitly requires
signed-in status verification and company confirmation. It never asserts account
access from a query parameter. Both outcomes pass tests; frontend build/typecheck
and the callback Deno check pass. The frontend was deployed from `91c2f3a` to
`dpl_FxxyFqJaMM4bzkRAhXScmajU1cN7`; both stable aliases were subsequently
advanced by the shared build to `c7744a8` / `dpl_6Vb2z8TyE43LuyMevbZnuhvtG8sq`,
which includes this fix. Protection remains `all`.

Reference: https://supabase.com/docs/guides/functions/http-methods


### Hosted gateway callback correction and sandbox connection — 13 October, 19:36 UTC

The 19:17 attempt failed before any provider request. A safe routing diagnostic
proved that the hosted gateway delivers the callback internally as HTTP on the
same project host, with `/functions/v1` removed. The OAuth contract correctly
required the registered public HTTPS callback, so it rejected that internal URL.
The Edge entrypoint now maps only the exact same-project gateway route (or the
same project's documented functions host) to the configured public callback.
No forwarded header is trusted; state, expiry, actor authority, app revision,
realm binding and the registered HTTPS token-exchange redirect stay enforced.

Callback runtime v7 is active in TEST, artifact
`85373b50148d06f7594059cdc48d7a4b2faabdfc8f07825c22c4942fe1c2b13e`.
All nine runtime modules match downloaded deployed source, closure
`f0df75ae73615f90d312b9c49c29441b539520a7233d70072c7a33297eda04e3`.
Eighteen focused OAuth/route/HTTP tests and the Deno check pass. An empty hosted
GET now returns the expected safe 303, without provider requests. Other endpoints,
secret fingerprints and retained record counts were preserved during deployment.

A fresh operator-initiated retry reused the owner's Intuit session and existing
consent. Intuit token exchange and sandbox CompanyInfo both returned HTTP 200.
TEST persisted the pair in Vault, token generation 1, and returned company
`Sandbox Company_US_1`, realm `9341456295767559`. This is Intuit sample data,
not Drummonds' live company. The operator confirmation explicitly records that
sandbox-only purpose. No canonical customer links or production changes follow.
A bounded sample run of Customer/Invoice/Payment/CreditMemo is limited to eight
read requests, 100 records per page, minor version 75. The manual runner uses
the exact worker with acquisition pinned to this run; no hosted worker key or
recurring schedule is provisioned. Provider lifecycle and live acceptance remain
separate until recorded below.


### Sandbox import and repeat capture accepted — 13 October, 19:46 UTC

Both operator-started scans completed through the exact worker implementation,
manually invoked with a pinned run ID. Each used four of eight permitted reads
and saved four pages containing 77 observations: 29 customers, 31 invoices,
16 payments and one credit memo. Repeating the scan retained eight page receipts
and 154 observations, while latest records and source versions remained 77.
No duplicate records or new versions were introduced by unchanged provider data.
The signed-in UI displayed the same counts and clearly labelled Sandbox.

Final readback: connection paused, QuickBooks input disabled, no queued/running
imports, no canonical customer links. Sample records and encrypted tokens remain
in TEST; no production/accounting writes or recurring schedules were created.
The hosted dispatcher remains unprovisioned. These checks prove actual sandbox
OAuth and persisted accounting reads, not live Drummonds coverage, automated
refresh, provider revocation or full accounting reconciliation.

[Sanitised acceptance evidence](evidence/learn-quickbooks-sandbox-2026-10-13.json).


### Owner assessment facts — 13 October

Chris answered “None” to the question covering regulatory investigations or
complaints, sanctions and notifiable data breaches. Record those as his stated
business facts, not independently audited findings. Chris subsequently confirmed:

- No legal-counsel review of the business activities/use of user data.
- Nobody appointed to review ServiceOS security risks.
- QuickBooks data must be excluded from model training; he explicitly approved
  answering No to Intuit's training question. This includes fine-tuning.
- He is willing to review and sign a separate agreement with Drummonds. This is
  not an executed agreement, acceptance of draft terms, or evidence of legal review.

Intuit confirmed the General Questions draft was saved, including Legal Counsel
= No, AI = Yes, AI Training = No and an explanation of the current connector's
read/store-only handling with no QuickBooks AI pipeline. No final submission or
blanket security-policy compliance attestation was made. The security-team and
breach answers are likewise based on the owner statements, not audited findings.


### Lease timing fix and sandbox recovery — 13 October, 20:52 UTC

The first real refresh check acquired its durable lease but made zero provider
requests: a small database clock lead made the two-minute lease exceed the local
strict duration check. Token generation did not advance. The revised shared
budget accepts at most five seconds of clock skew while reducing execution time
to at most 115 seconds. SQL lease validation remains authoritative. Sixty focused
QuickBooks tests, the frontend typecheck and production build pass.

TEST callback v8, worker v3 and disconnect v3 were installed, then downloaded and
matched to the full runtime source closures. No production runtime changed.
The original pending lease correctly prevented an uncertain automatic retry or
revocation. The signed-in disconnect stopped capture and required manual review.

Only OpenFolk ServiceOS was removed from Sandbox Company_US_1 through QuickBooks
Manage integrations; its absence was verified. The separate Drummonds Dashboard
app was untouched. TEST had one QuickBooks connection. The existing operator then
recorded the provider review through the signed-in controls. This is an operator
review, not an Intuit revocation-API receipt.

Chris approved fresh sandbox reconnection at the consent screen. OAuth returned
the same sample company and saved generation 2; company confirmation left capture
paused and imports disabled. Readback retained 77 latest records, 77 source
versions and eight pages, with no active imports and no pending refresh lease.
The normal refresh check is running as a one-shot local process, waiting until
21:44:04 UTC; do not mark it passed until its terminal evidence is inspected.
API revocation and production acceptance remain open.

[Sanitised lifecycle evidence](evidence/learn-quickbooks-lifecycle-2026-10-13.json).

### Business review pack — 13 October

Chris approved the pilot basis (90 days, no separate fee, prior approval of
third-party costs, 30-day termination notice, unchanged software ownership) and
named Heidi as Drummonds signatory and himself as security-risk owner. The earlier
absence of an appointed owner is superseded; no historical review programme or
legal-counsel review is asserted.

The privacy notice, authorised-user terms and separate private pilot agreement
are prepared in docs/legal. A local, responsive review pack is generated by
scripts/legal/build-approval-pack.py into outputs/quickbooks-approval. It is not
placed in public routes or deployed. Business approval, exact recipient/transfer
arrangements and achievable exit/deletion commitments still need resolution.
The draft terms now propose England and Wales jurisdiction and a concrete change
notice process; this is proposed text, not an accepted agreement.

Chris subsequently approved the draft text and proposed retention targets via the
review-pack question. The exact source hashes and scope are recorded in
`docs/legal/SERVICEOS-QUICKBOOKS-DRAFT-APPROVAL.json`. This approves the drafts,
not signature or publication. The preview labels that distinction and invalidates
its approved label if any of the three approved document hashes changes.
