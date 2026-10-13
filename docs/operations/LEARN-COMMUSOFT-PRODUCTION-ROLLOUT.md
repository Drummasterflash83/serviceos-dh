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

## Shared customer/job context — 13 October, 12:38 BST

A read-only live check confirms 1,552 customer sources, 871 work-address sources
and 12,633 job sources. Canonical jobs, sites and source-to-canonical links are
still zero. The completed traversals must not be described as published customer
context. Customer-contact traversal remains active under the existing approval.

The existing logged OpenFolk review path can classify/reuse customers, then publish
their sites, contacts and jobs with source-version provenance. The next steps are:

1. Verify current customer-type meanings and review person/company classifications.
2. Inspect existing identity candidates; reuse only verified identities and retain
   ambiguous/shared-contact cases for review rather than automatically merging them.
3. Publish reviewed customers, then sites/jobs/contacts through the existing audited
   operator transactions, with exact source-version/replay receipts.
4. Reconcile unresolved parent references and prove the resulting existing cards
   and job communication readers, tenant isolation and retained source preservation.
5. Connect explicit Slack job references through source-bound work-context review,
   keeping internal authors distinct from customer identity.

The settings/customerTypes endpoint previously returned JSON ACCESS_DENIED on
12 October. That response has not been retried or bypassed. The sealed historical
customer export corroborates category clues but is not fresh account taxonomy:
39 live customer IDs are absent from that export, and one current type ID maps to
two historical category labels. No bulk classification policy or identity merge
has been inferred. Private aggregate evidence is retained in
`.verification-results/commusoft-classification-evidence-20261013.json`.

This work completes the original input-to-context requirement. The proposed richer
customer-card UX remains discussion-only, as requested.

## Initial source traversals completed — 13 October, 15:56 BST

All four logged initial production passes completed: properties 25 pages,
jobs 127 pages, customer contacts 1,552 target pages, and site contacts 871
 target pages. Each retained a terminal complete checkpoint with no next cursor.
The final source totals are 2,423 distinct properties, 12,633 jobs and 2,969
contacts across the two contact passes. Contacts are not additive per pass:
shared provider contact identities may appear in more than one property context.
The final account has no queued/running/retrying source job; existing communication,
recording and voicemail totals were preserved.

This establishes traversal of available API results for the approved initial
scope. It does not establish complete canonical identity mapping, provider-deleted
history, recurring capture or comprehensive customer cards. The earlier card-design
hold was superseded by Chris's later approved customer/job UX changes; identity
merges still require evidence. Next: verify recurring capture and reconcile the
remaining classification/relationship gaps through the logged operator workflow.

Evidence: [initial production capture](evidence/learn-commusoft-initial-live-complete-2026-10-13.json).

## Customer identity corroboration — 13 October, 17:14 BST

The fresh read-only audit selects only the latest unambiguous observed source
for each customer identity. All1,552 source heads were unambiguous. The earlier
322 exact historical ID/name/postcode matches omitted the provider title from
individual full names; the sealed export leaves separate first/last-name columns
blank. Including the explicit title raises exact matches to1,237, without fuzzy
matching or changing any production record. Thirty-nine source IDs still have
no historical counterpart. This strengthens the review evidence but establishes
neither current taxonomy nor canonical identity authority by itself.

The existing settings/customerTypes denial used the established working Bearer
request, so repeating it with the same credential has not been attempted. The
current official endpoint documentation still identifies that settings route.
No provider permission, credential or customer merge changed during this audit.

Evidence: [customer corroboration](evidence/learn-commusoft-customer-corroboration-2026-10-13.json).

## Current provider UI taxonomy — 13 October, 17:26 BST

The existing authenticated Arc session displayed Settings → Customer types at
`https://app.commusoft.co.uk/settings/customer_types`. It currently lists Private
customer, Company, Estate Agent, School or College, Property Management, Care Home,
Religious building, Hospitality, Government Building, Private Landlord, Building
Company, Accounting Name and Staff Member. The first two cannot be edited or deleted.
Accounting Name uses “Account code”; the other types use work-address labels.

Read-only form inspection confirmed that Estate Agent describes a letting agent
managing multiple tenant properties, and Private Landlord describes a customer
owning more than one premises. Neither description alone proves person/company
classification. No values were edited or saved. No numeric type IDs were exposed;
row order is not ID evidence. The provider settings API remains denied for the
existing credential. This fresh observation corroborates category names, but does
not resolve historical type changes or authorize arbitrary customer merges.

The latest recurring read at 16:25:39 UTC showed phase 3 (customer contacts), 40
settled pages, valid operator/connection authority and unchanged runtime hashes.
Thus the ongoing job stage advanced automatically after the property stage.
Both contact stages and a final recurring watermark remain to be verified.

## Current taxonomy and provider coverage discrepancy — 13 October, 18:22 BST

Authenticated Commusoft Customers navigation exposes the numeric category IDs in
its labelled creation links. This resolves the earlier lack of current ID-to-label
evidence without requesting additional provider scopes. The exact observed mapping
is retained in the evidence below. Route names are supporting metadata, not a
canonical identity policy: “Building Company” (11) uses the individual route, and
“Accounting Name” (13) and “Staff Member” (14) need distinct treatment.

The documented `includeCount=true` requests independently returned **1,552 customers
and 871 work addresses**, exactly matching retained initial and recurring property
traversals. Commusoft's dashboard reports **1,650 customers and 982 work addresses**.
A fresh customer export contains 1,650 distinct IDs: all 1,552 imported IDs are
present, with **98 additional IDs** absent from the API traversal. All ten newest
customers displayed in the provider UI were already retained.

One missing customer was inspected as Active in the provider UI. The documented
property detail endpoint returned JSON HTTP 404 with the same existing credential;
the first unfiltered list page also omitted it. No default dormant-only explanation
has been inferred. This requires provider visibility/filter clarification, not a
blind replay of a completed traversal. Four bounded read-only diagnostic requests
were made; no settings, credentials, provider or production records changed.

The export, exact ID differences and private request journal remain outside Git.
The existing 1,552 API-visible customers can continue through identity and
relationship review while the coverage difference is resolved.

Evidence: [current taxonomy and coverage](evidence/learn-commusoft-provider-coverage-2026-10-13.json).

## Account holder versus primary contact — 13 October, 18:31 BST

The fresh same-day export corroborates the ID and display name for 1,297 of 1,552
API-visible customers, and ID/name/nonblank postcode for 1,282. There are 18 cases
with a missing postcode. In five inspected name mismatches, the API's primary
contact name differs from the exported account-holder name despite matching
postcodes. This is consistent with the documented field meaning: a contact
associated with the customer, not necessarily the customer themselves.

A bounded audit of the three already-published customer links found all three
canonical names agree with the fresh export after removing an explicit title,
and all three card titles agree with their canonical names. No existing card
was changed. This does not establish the correctness of unreviewed identities.

**Next implementation priority:** support a reviewed account-holder identity and
its retained supporting evidence independently of the API primary contact. The
current new-person path copies `contact.firstName/lastName`; it cannot represent
a different account holder without choosing an already-existing target. Extend
the audited review flow to support that case before broad person publication,
retain the original source/contact unchanged, and preserve separate contact
relationships. Do not bulk-create customers from primary-contact names or treat
shared email, phone or address as merge authority. Existing company/source review
and verified identity reuse remain available.

The fresh export and review differences are sealed under the existing ignored
private verification directory. A provider clarification draft is prepared there
as `support-draft.txt`; it has not been sent.

## Customer-to-work publication — 13 October, 21:11 BST

**13 October, 21:11 BST — one substantial customer journey linked and verified LIVE.**

- One company account was corroborated against its retained Commusoft source,
  current customer export and full existing-identity snapshot, then saved through
  the existing logged operator review. No possible identity collisions were merged.
- All 22 sites and 585 jobs belonging to that account in the retained snapshot are
  now linked. Every job's explicit property reference and customer/site ownership
  was verified; the database readback checks every source link, original actor,
  customer card and site relationship. Source descriptions and historical codes
  remain unchanged. These are unverified canonical records with explicit source
  evidence, not independently verified job-completion facts.
- The signed-in LIVE card shows 585 linked jobs (25 on its first page) and 22 sites.
  Source completion times without confirmed timezones remain excluded from duration
  and performance calculations. Communications and contacts are not complete for
  this customer. Complete provider coverage is not claimed.
- All 4,456 previous identity projections, 1,552 retained customer heads, 24 prior
  customer links and 35 contact points were unchanged. No new grant, schema/runtime
  deployment, provider write or paid AI was involved. This is scoped preservation,
  not a hash comparison of every production row.
- Total published business links are now 25 customers, 33 sites, 616 jobs and 22
  contacts. LIVE Slack has 12,127 sources; 102 archived windows and 15 active windows
  are complete. Commusoft site-contact capture remains active with no full-cycle
  watermark yet. Both known Slack recoveries were still queued at 21:03 BST.
- Next: extend evidence-backed customer/contact/communication reconciliation,
  make long job histories easier to scan by current work and date, complete input
  coverage and ongoing capture, then scoring and operational acceptance. The full
  goal remains incomplete; this account is not a substitute for broad coverage.

[Live customer/site/job evidence](evidence/learn-customer-site-job-publication-2026-10-13.json).

## Company contact acceptance — 13 October, 21:26 BST

**13 October, 21:26 BST — company contacts verified LIVE; card read timeout diagnosed.**

- Eleven reviewed source-contact links now represent nine distinct people on the
  previously linked company card; two site sources reuse existing people after
  explicit name, individual-email and company/site corroboration. The LIVE client
  view shows nine contacts. All source payloads, versions, actors and customer/site
  ownership were checked. Reuse preserves original card/endpoint evidence; the
  additional site relationship and immutable source link retain the newer evidence.
- All 22 previous contact links, 4,457 identity projections, 1,552 customer source
  heads, 25 customer links and 35 contact points remain unchanged. Nine people and
  17 non-primary, unverified contact points were added. No permissions, capture
  settings or provider records changed. This is scoped preservation evidence.
- A separate named contact sharing an office phone remains held. Do not merge
  different people because they share a reception number. Explicit shared-office
  endpoint review and department/non-person contacts still need completion.
- The LIVE card's findings read reproducibly times out (Postgres 57014 at 20:20:24
  and 20:22:17 UTC). Server error context identifies `learn_slack_document_withheld`
  through the source-visibility policy. One communication read also timed out;
  the subsequent read succeeded but returned no linked communications. Do not
  describe this as a complete or healthy customer timeline.
- A semantics-preserving candidate scopes withholding dependency checks to UUID
  references present in the requested document. It is under isolated full-schema
  rehearsal; **not deployed**. Keep source-withholding protection and existing ACLs.
- The two known Slack recovery handles remain queued, attempt zero, verified at
  20:19:08 UTC. No duplicate recovery was created. LIVE UI later showed 12,249
  retained Slack sources, 32,616 emails, 4,462 calls, 2,984 recordings and 255
  voicemails; counts do not prove historical coverage or completed learning.
- Next: finish/release the card-read fix with preservation and signed-in evidence,
  extend meaningful contact/communication reconciliation, finish connector coverage,
  scoring and unattended operational acceptance. The full goal remains active.

[Contact publication evidence](evidence/learn-company-contact-publication-2026-10-13.json).
