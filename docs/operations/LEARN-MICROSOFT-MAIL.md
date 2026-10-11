# Microsoft 365 mail input

## Current status — local transport, not an enabled connector

On 11 October 2026, the first Microsoft Graph mail delta reader was implemented in
`supabase/functions/_shared/microsoft_mail_page.ts`. Its 19 synthetic transport tests
and strict TypeScript checks pass. No Microsoft credentials, accounts, customer
records, provider requests, hosted installation or production changes were involved.
The controller's `microsoft_365` entry remains `adapterImplemented: false`.
This is groundwork for the full reusable input adapter; it does not yet import mail.

## Implemented behavior

The reader fetches one Graph v1.0 page for an explicitly scoped company, email
account, Microsoft directory mailbox object ID and actual folder ID. A successful
result says `persistence: not_attempted` and `attachmentsCaptured: false`. Its folder
round completion flag describes the provider response only; it cannot establish
stored evidence, mailbox coverage, freshness or connector health.

The initial request selects message content, participants, source timestamps,
headers and identity fields without a date or change-type filter. Every request
asks for immutable message IDs. Follow-up requests preserve Microsoft's complete
opaque URL, after checking the global Graph host, mailbox, folder, resource and
continuation kind. Redirects are rejected. IDs remain case-sensitive; encoded
slashes stay inside one identifier. Slash, OData parenthesized and qualified delta
function forms are accepted. These choices follow Microsoft's
[message delta contract](https://learn.microsoft.com/en-us/graph/api/message-delta?view=graph-rest-1.0)
and [immutable ID guidance](https://learn.microsoft.com/en-us/graph/outlook-immutable-id).
National-cloud Graph hosts and mailbox UPN aliases are not supported by this reader.

Partial updates retain only the supplied fields. Missing fields do not become
null; explicit nulls remain explicit. The original provider object, duplicate
observations and seven-digit timestamp fractions are retained. A removal is a
folder-membership event, never permission to delete retained email evidence. Delta
ordering is not a reliable chronology. An empty page with a next link stays
incomplete, and an unchanged terminal delta link is allowed. See Microsoft's
[delta overview](https://learn.microsoft.com/en-us/graph/delta-query-overview) and
[mail change tracking](https://learn.microsoft.com/en-us/graph/delta-query-messages).

Each fetch has a 30-second timeout, a 16 MiB response limit and a 1,000-event ceiling;
page size preference is constrained to 1–100. Malformed, oversized or mis-scoped
pages fail as a whole. Errors distinguish authentication, denied access, missing
folder, expired delta, throttling and provider failure. Retry-After is returned to
the future scheduler; this reader does not retry, reset a cursor or silently
truncate content. Error messages exclude provider bodies, tokens and URLs.
Returned raw bodies and continuation URLs are private runtime data, not log data.
HTML bodies must not be rendered as trusted application HTML.

## Remaining work to deliver the connector

1. Resolve each authorized company/account to its Microsoft tenant and mailbox;
   integrate consent, token storage/refresh/revocation and read-only mail content
   permissions. Transport UUID validation is not authorization. Revalidate the
   company/module/account permission and capture switch at execution time.
2. Discover actual folder IDs and the complete folder hierarchy, including explicit
   handling of hidden and search folders. The root listing alone is insufficient:
   Microsoft requires traversal of child folders. See
   [root folder listing](https://learn.microsoft.com/en-us/graph/api/user-list-mailfolders?view=graph-rest-1.0)
   and [child folder listing](https://learn.microsoft.com/en-us/graph/api/mailfolder-list-childfolders?view=graph-rest-1.0).
   Discovery progress and exclusions must be visible to OpenFolk. Neither the
   reader nor its tests proves mailbox-wide coverage.
3. Add tenant/account/folder-scoped capture state and append-only source page/event
   receipts. Persist a complete page and its cursor in one transaction under a
   lease with compare-and-set checks. Handle duplicate delivery, lost commit replies,
   scope changes and expired tokens without discarding source history. Detect longer
   cursor cycles across pages, not just the immediate repetition caught here.
4. Materialize shared email/interaction evidence by mailbox plus immutable message
   ID. Reconcile sparse, repeated or reordered events without assuming the last
   page is the newest message version. Preserve folder removals and original
   bodies separately. Define attachment, inline content and unsupported-folder
   handling; `hasAttachments` alone cannot prove attachment capture.
5. Integrate durable jobs, bounded historical ingestion, incremental schedules,
   operator health/recovery and company switches. Stop future work on disable or
   revocation. Keep customer-facing progress calm and truthful about missing/stale
   inputs, while providing diagnostic detail in OpenFolk.
6. Verify isolated end-to-end storage/retry/concurrency behavior, hosted TEST access
   boundaries and an authorized real mailbox. Only then mark adapter capability as
   implemented and evaluate enabling capture. Production remains a separate release.

## Reproduce local checks

```sh
node --test supabase/functions/_shared/microsoft_mail_page.test.ts
./node_modules/.bin/tsc --noEmit --strict --allowImportingTsExtensions \
  --target ES2022 --module ESNext --moduleResolution bundler \
  --lib ES2022,DOM --skipLibCheck \
  supabase/functions/_shared/microsoft_mail_page.ts \
  supabase/functions/_shared/microsoft_mail_page.test.ts
```

Tests exercise the exported reader with synthetic provider responses, including
exact outgoing requests, continuation traversal, source preservation, invalid
scopes and foreign destinations, malformed pages, byte limits, error classification,
retry timing, in-flight scope mutation and completion timestamps. They are not
real-provider acceptance, database preservation or authenticated controller tests.
