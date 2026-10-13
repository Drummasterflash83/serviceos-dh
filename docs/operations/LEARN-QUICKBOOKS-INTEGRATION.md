# QuickBooks Online input — implementation and handover

Updated 13 October 2026. Workstream: `codex/quickbooks-integration`.

## Scope and ownership

Chris confirmed QuickBooks Online and authorised using the Drummonds developer
account initially, with an eventual move to an OpenFolk-owned app. The connector
must be available to future ServiceOS clients. No Drummonds identity, realm,
credential or company-specific mapping belongs in shared code.

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
- 16 synthetic tests pass; strict standalone TypeScript checks pass for both
  runtime modules. No real QuickBooks accounting data has been requested.

Reproduce:

```sh
node --test supabase/functions/_shared/quickbooks/*.test.ts
```

## Needs finishing

1. Create/configure the Intuit app, confirm developer workspace owner, production
   eligibility and any assessment/terms. No app has been created by this build.
2. Implement audited operator connection controls and server-only state storage.
   Insert state durably before redirecting; atomically claim unused/unexpired
   state, recheck actor authority and reject callback replay before code exchange.
3. Implement token exchange and refresh with per-connection leases and atomic
   replacement of the token pair in Vault. App secrets and tokens must never be
   committed, put in client JavaScript, printed or included in evidence files.
4. Verify CompanyInfo against the authorised realm and show its identity for
   connection confirmation. Never infer realm from a numeric JavaScript value.
5. Implement durable request reservations, tenant-scoped source versions, page
   receipt/checkpoint transactions, bounded capture and recovery after uncertain
   HTTP/persistence outcomes. The transport's injected callbacks are not yet
   backed by database functions. Pausing/revoking must also fence publication.
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

## Blocked externally

The authenticated Intuit portal currently fails to load both **App dashboard**
and **Workspaces** with “Sorry, something went wrong”. Dashboard retry returned
the sign-in error page (`errorType=400`). User has been asked to confirm a working
developer workspace. This does not establish that Drummonds accounting/API access
is broken; no accounting request has been attempted.

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
reviewed once the app can be created. This checkpoint contains no real keys.

## Primary references

- [Intuit official OAuth client](https://github.com/intuit/oauth-jsclient) —
  endpoints, Accounting scope, code exchange and token refresh.
- [Get started](https://developer.intuit.com/app/developer/qbo/docs/get-started)
  — app, sandbox and production developer setup.
- [Limits and throttles](https://static.developer.intuit.com/output_html/qbo/docs/learn/limits-and-throttles.html)
  — bounded query pages and rate limiting.
- [Webhook best practices](https://static.developer.intuit.com/output_html/qbo/docs/develop/webhooks/best-practices.html)
  — reconciliation for missed events; webhooks are not yet implemented here.
