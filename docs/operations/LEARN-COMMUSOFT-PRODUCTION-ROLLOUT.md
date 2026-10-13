# Drummonds Commusoft production activation

## Prepared connection step — 13 October 2026

The signed-in OpenFolk production controller confirms no Commusoft connection or
import account for Drummonds. A read-only database check at 10:28 UTC found zero
source pages, source collections and Commusoft jobs. The existing production
verification and worker endpoints are ACTIVE with JWT validation; their artifacts
match the matched release. This is readiness, not production input acceptance.

The existing TEST connection belongs to Drummonds account `19136`, UK, and retains
its verified private-app credential in encrypted Vault. Metadata was checked at
10:40 UTC; no secret value was retrieved or printed for this preparation.

The prepared action will:

1. Reuse that existing private-app credential in Drummonds' encrypted production
   Vault, project `tgbnakbxwcqjeimygroz`, tenant
   `00000000-0000-0000-0000-000000000001`.
2. Save it through Chris's existing signed-in OpenFolk controls for account `19136`,
   UK, preserving its existing provider permissions. No new user or grant.
3. Run the existing access check: at most one read-only property request. Save the
   verification receipt, not the returned customer record.

The credential persists until replaced or revoked. It is not placed in Git,
plaintext files, logs or chat. TEST data is not copied into production. This step
creates no import, schedule, provider write or paid AI processing, and does not
publish canonical customers or jobs. Browser rules require confirmation for the
new production credential destination before submission.

## Following input work

After successful connection verification, use the logged tenant-scoped import
controls for current properties/customers, jobs, customer contacts and site contacts.
Preserve each page, version and checkpoint; verify pagination exhaustion and
relationship gaps before describing coverage as complete. The previous TEST
traversal retained 2,421 properties (1,550 customers and 871 sites), 12,611 jobs and
2,965 contacts. These are comparison figures, not guaranteed current production
counts. Ongoing capture requires its complete four-stage cycle and coverage checks.

Keep source import separate from canonical identity review and the proposed richer
card design. Chris has explicitly kept that card expansion at discussion stage.

## Connection result — 13 October, 11:45 BST

Chris approved the exact production credential destination and single access check.
The existing signed-in controller saved the connection and returned **properties
access verified** at 10:44:59 UTC. Production connection
`87d0d4fa-1097-4a73-80fd-61357edb1e5d` is configured with its Vault binding.
The 10:45:32 UTC readback still shows zero import pages, source collections and
Commusoft jobs. One-use encrypted local transfer files were removed; no plaintext
credential was saved in the repository. Jobs/contacts and source coverage remain open.

## Initial production source-import sequence

This implements the existing authorised LEARN LIVE input goal, separate from the
credential-only step above and from the customer-card expansion on hold.
Use the existing operator account and audited controls, without new access grants.
The first collection is customers/work addresses: at most 50 pages of 100 records,
with a 24-hour approval. Read jobs next (maximum 300 pages of 100), then customer
contacts (2,500 pages of 100) and site contacts (1,500 pages of 100), each only after
the preceding checkpoint completes and with its own 24-hour scope. Stop and retain
checkpoints on expiry, exhaustion or failure; do not silently increase bounds.
These are successful-page ceilings; failed/retried provider attempts also retain
their own permit and queue evidence. The database worker remains serial per account.

Make the LEARN master and existing email/phone/Slack settings explicitly On to
preserve their currently permitted behaviour; enable only Drummonds' Commusoft
input. No other tenant, credential or provider scope changes. The existing runtime
can execute bounded pages through its dedicated worker. Do not turn on the shared
global dispatcher until verifying no unrelated eligible Commusoft work exists.

Record before/after source totals, exact connection binding, page receipts,
checkpoint exhaustion and unresolved relationships. Imports retain provider sources
and do not themselves publish canonical identities or the proposed richer cards.
Do not describe missing source properties or unzoned dates as resolved merely
because all available pages were fetched.

## Initial source evidence — 13 October, 12:09 BST

The signed-in operator controls enabled the Commusoft input and recorded the initial
properties approval, then the separate jobs approval after properties completed.
The bounded existing worker exhausted the properties cursor in 25 requests/pages,
retaining 2,423 distinct property/customer/site sources. The job pass reached 75 pages
and 7,500 retained jobs, with its next cursor preserved and processing continuing.
The dedicated runner rechecks the account, fixed scope, expiry and absence of other
eligible Commusoft jobs before each request; it stops on uncertainty or any non-success.
Existing emails, calls, recordings and voicemail counts were preserved. No canonical
publication or ongoing Commusoft schedule was enabled by these source passes.

Private journals: `.verification-results/commusoft-live-properties-20261013-execution.json`
and `.verification-results/commusoft-live-jobs-20261013-execution.json`. These contain
scope/checkpoint evidence, not source payloads or API credentials.

### Jobs finished and customer contacts started — 12:16 BST

The job traversal finished after 127 successful pages, retaining 12,633 distinct
jobs with `complete=true` and no remaining cursor. Properties remain at 2,423.
The signed-in production controller independently shows the completed job traversal.
The next logged approval covers customer contacts for the 1,552 customer targets
in that completed property traversal, at most 2,500 pages of 100 through 14 October
11:15 UTC. Its first supervised batch is running; site contacts have not started.
This is source capture, not complete canonical customer/job/card coverage.
