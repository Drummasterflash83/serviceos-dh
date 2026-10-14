# Customer reconciliation from retained Commusoft evidence

The first bounded LIVE group is verified: twenty customer identities, four sites
and eighteen jobs. Its follow-up contact review published seventeen relationships
(twelve existing account holders and five distinct named people), with five sources
held. This is broader canonical publication, not complete customer, contact or
communication coverage. Use the completion checklist for current gates.

## Read-only preparation

`scripts/commusoft/customer-review-snapshot.mjs` uses the existing Supabase CLI login
for one read-only management query. Supply the exact project, tenant and connection;
it verifies that the connection belongs to that tenant and is Commusoft. It retains
all tied latest source versions rather than choosing an arbitrary winner. It saves
private rows with mode 0600 and prints aggregate counts only. It never reads provider
credentials or calls Commusoft. Use an existing private directory under `/private/tmp`
or the ignored `.verification-results` directory, and a new output filename.

```sh
node scripts/commusoft/customer-review-snapshot.mjs \
  --project '<project-ref>' --tenant '<tenant-uuid>' --connection '<connection-uuid>' \
  --output /private/tmp/customer-review/snapshot.private.json
```

The category mapping is a private JSON file with `tenant`, `connection`, `evidence`
and `categories`. Each exact provider category ID maps to `person`, `company` or
`hold`. Base it on that client's verified taxonomy. Unknown categories stay held;
the code contains no global Drummonds category mapping. A category alone never
establishes a customer identity.

Use the original freshly downloaded Commusoft **Customers list** export. The
current provider's `.xls` download is an HTML table; the planner parses its exact
seven-column header and records a SHA-256 of the original bytes and source row.
It rejects malformed tables and retains duplicate account IDs as held cases.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/commusoft/plan_commusoft_customers.py \
  --snapshot /private/tmp/customer-review/snapshot.private.json \
  --export-source /private/tmp/customer-review/source.xls \
  --mapping /private/tmp/customer-review/mapping.private.json \
  --output /private/tmp/customer-review/plan.private.json
```

The snapshot must be no more than one hour old. Outputs are private and contain
customer data: do not commit, paste into public reports or send to another service.
Only aggregate counts, code hashes and verification booleans belong in Git.

## What a proposal means

A `ready_for_operator_review` row has one retained latest version, one matching
export account, a corroborated nonblank postcode, a reviewed category and a
corroborated account name. Person proposals require the account name to agree with
the primary contact after limited title/whitespace normalization. That comparison
is corroboration, never an automatic identity merge. The stored account evidence
keeps the exact exported name, row and digest. Different/uncertain account holders
remain in the existing individual review workflow.

Existing names, contact points, broad phone collisions and postcodes produce
possible-match holds. Export accounts sharing a name or endpoint with another
account also require review. None of these matching signals proves identity.
Companies require agreement between the source company name and exported account
name. A company name on a person-category record is held. Missing API accounts,
ambiguous sources and unknown/internal categories are held and counted explicitly.
Already-linked accounts also need review if the retained version changes or their
canonical name/postcode no longer corroborates the current export.

Batches contain at most twenty proposals, newest account number first. The script
has **no apply command** and makes no production or provider changes. Its `applied`
count is always zero, including after it observes links created separately.

## Logged publication and recovery

Open the selected client in OpenFolk → Client information → source review, with an
explicit operator reason. For each proposed account, read the current source and
check its account number, name, postcode and classification against the proposal.
Run the current possible-match check. If anything changed or a possible match
appears, hold it for individual review; do not automatically merge or override it.

Use the existing customer identity confirmation, including account-holder evidence
for a new person. The first group used the existing signed-in operator and each
save has an audited receipt; no service-role impersonation or new grant was used.
After customers, review sites, then jobs and contacts using their explicit provider
relationships. An unchanged account name does not alone prove another contact is
the same person. Generic labels such as “Occupier” need identity/role handling.

A lost acknowledgement is not proof of failure. Stop and read the retained link and
receipt before another decision. Existing exact-retry handling may recover the
same request; never change its evidence or create a replacement identity to work
around an uncertain result. Review expiry is normal: reopen logged access and
continue only records that were not already saved. Do not disable access checks.

Refresh the read-only snapshot and planner after each group. In the first real run,
nine further proposals acquired possible matches after the twenty new accounts
were published. An earlier plan must not become an unattended approval queue.

## Verification and limits

Run `PYTHONDONTWRITEBYTECODE=1 python3 scripts/commusoft/plan_commusoft_customers_test.py`.
The eighteen tests exercise meaningful reconciliation failures and batch bounds.
The snapshot reader also has a syntax check and actual scoped read-only acceptance.
No frontend or schema change is introduced by these scripts.

The 13 October real group passed readback of all 42 published links, ownership,
source versions, original actor and account-holder evidence. Existing identity
projections, customer source heads and prior customer links were compared before
and after. The established release preservation verifier separately checked earlier
immutable source hashes, identity IDs, access and schedules. Neither comparison
claims every field of every production table was hashed.

The latest observed report has 24 linked accounts, 828 proposals and 798 held
accounts. This includes the known 98 exported customers absent from the API;
reasons overlap. The UI/API site discrepancy also remains unresolved. Contacts,
communication attribution, useful summaries, scoring and full operational acceptance remain separate delivery work. Additional
contact-point presentation is now verified in LIVE and TEST.

## Contact follow-up acceptance, 13 October 20:04 BST

For an existing account holder, corroborate the provider contact ID as well as the
full name, explicit property relationship and current candidate identity. Reuse the
reviewed person only when those facts agree. A name match alone is insufficient.
For an additional named contact, review the property/site owner and current person
search, then allow the existing backend endpoint-collision check to hold uncertain
identities. Never select a different person merely to bypass a collision hold.

The real follow-up published 17 of 22 retained contacts, preserving source versions,
actor and card/site evidence. Two attempted new contacts were held because their
email or phone matched unnamed existing people; they were not retried against an
arbitrary candidate. A departmental label and two possible duplicates also remain
held. Publication added 29 unverified, non-primary contact points and retained the
five earlier contact links. No primary-field, consent or verification override was
made for reused people. The live operator card displays a representative new
contact, and additional saved-contact presentation was subsequently verified in LIVE
and TEST; see the contact-details release evidence.

[Sanitised contact acceptance](evidence/learn-contact-reconciliation-2026-10-13.json)
records the exact counts and preservation scope. No private contact details, source
payloads or browser screenshots are committed.

## Further LIVE customer journey — 13 October, 22:40 UTC

A fresh read-only snapshot found 25 linked customers, 827 proposals and 798 held
accounts. One further person account was corroborated against the same-day export,
current retained source, category and postcode, then checked against current LIVE
identity candidates. The existing signed-in operator published the customer through
the logged control, followed by its three explicitly related jobs. Readback verifies
source versions, actor, account-holder evidence, card ownership and job identities.
The existing LIVE customer view shows all three linked jobs. Published totals are
now 26 customers and 619 jobs; this is not complete customer context.

All 4,466 previous identity projections (selected fields), 25 prior customer links,
1,552 retained customer payloads and 52 contact points match the before snapshot.
This comparison does not claim every production field/table was hashed. The source
completion times lack a timezone and remain withheld from duration/scoring. Original
Commusoft descriptions, including historical code labels, are retained exactly.
Current taxonomy must not be inferred from those labels or silently replace them.

[Additional real journey and preservation evidence](evidence/learn-customer-reconciliation-second-2026-10-13.json).


## Further LIVE publication — 14 October, 03:07 UTC

The next twenty individually reviewed export proposals now have canonical customer
identities and cards, with two sites and seventeen jobs linked through explicit
provider relationships. Nineteen contacts were subsequently published: fourteen
explicit primary contacts reuse their corroborated account-holder person, while
five independently named company/site contacts became separate people after both
current name and source-endpoint candidate checks. Their forty-one contact channels
are non-primary and unverified; no consent or verification was inferred.

Two source labels represent a household or a business rather than one identified
person. A third named contact shares an office number with a different named
person. All three remain unlinked. In particular, selecting the other office
contact merely because its phone matches would merge different people. A reviewed
shared-endpoint and group-contact path remains required, not silently deferred.

Signed-in LIVE acceptance covers a person with two jobs and three saved channels,
and a company with two jobs, its service address and one site contact. Customer to
job and back is usable. Original descriptions, including both leading-zero current
codes and historical codes actually retained by Commusoft, are unchanged. Unknown
completion timezones are explicitly excluded from duration/performance evidence.
No linked communications on these sample cards is reported as missing context.

The refreshed planner observes forty-nine corroborated linked accounts, one linked
account requiring review, 796 proposals, and 804 held export accounts. Hold reasons
can overlap. The source-link totals are fifty customers, forty-eight sites, 644 jobs
and fifty-two contacts. Earlier proposal lists must not be reused as blanket
approval: new identities have created further possible matches.

Readback and scoped before/after preservation pass. Every pre-contact identity
projection, customer link and contact point remains; all prior customer source
versions and payloads remain, although recurring capture advanced observation
timestamps. This is not a whole-database preservation or complete coverage claim.
Private source manifests, receipts and screenshots remain outside Git under
`/private/tmp/serviceos-customer-publication-20261014-0230/`.

[Sanitised acceptance](evidence/learn-customer-publication-2026-10-14.json).

## Further LIVE customer history — 14 October, 04:14 UTC

A freshly corroborated company account now has all forty-seven of its currently
retained jobs and three source contacts on its LIVE card. Publication used the
existing signed-in operator, current candidate searches and explicit Commusoft
property relationships. An unrelated job whose number matched the property number
was excluded. The partial source contact name was preserved without inventing a
surname or merging unrelated people returned by a broad first-name search.

Readback verifies source revisions, original actor, card ownership and all six
new unverified non-primary contact-point records. Existing identity projections,
customer links/contact points, contact links and customer source payloads pass
scoped before/after comparison. Signed-in acceptance covers both job pages,
contacts, job drill-down and return. No communication is yet linked to this card,
and unzoned completion times remain excluded from performance calculations.

Current publication totals are 51 customers, 48 sites, 691 jobs and 56 contacts.
The fresh plan has 795 proposals, 804 held export accounts and one already-linked
account requiring review. This remains partial customer coverage.
[Acceptance evidence](evidence/learn-customer-history-publication-2026-10-14.json).

## Estate publication — 14 October, 04:30 UTC

One larger company estate now has its 26 retained sites and 208 related jobs
published in LIVE. The browser workflow checks visible owner/property and source
IDs against the fresh retained relationship inventory before each bounded save.
Numeric/description search hits belonging elsewhere are excluded. Saved receipts
cover 208 distinct jobs, and the complete server readback verifies source versions,
actors, original job IDs, customer/site ownership and retained source descriptions.
Three display titles trim trailing source spaces using the existing normaliser;
that presentation detail does not rewrite the underlying source descriptions.

Seven named contacts and fourteen contact channels are published. Two evidenced
separation reviews preserve three distinct people sharing an office number, with
exact candidate sets and logged result receipts. Five generic occupier/location
labels remain unpublished; suitable role handling remains required. Current roles,
contact permission and performance are not inferred from historic source labels.

Signed-in LIVE acceptance covers the job count, both site pages, contact details,
leading-zero service code, job drill-down and return. Missing linked communications
and unconfirmed completion timezones remain explicit. Current totals are 52
customers, 74 sites, 899 jobs and 63 contacts; overall customer coverage is incomplete.
[Acceptance and preservation evidence](evidence/learn-customer-estate-publication-2026-10-14.json).

## Further LIVE publication — 14 October, 06:42 UTC

Twenty more export-corroborated accounts now have canonical customer cards, with
four explicitly related sites and thirty-two jobs. Each customer source was read
in the logged operator UI and checked against its exact account name, postcode and
reviewed category; a fresh name/contact candidate check preceded each save. All
site/job source IDs, customer labels and explicit property relationships were
checked before publication. Five-minute review expiry was renewed normally, and
saved batches were reloaded without replaying their mutations.

Thirteen retained contacts reuse their corroborated account-holder identities:
both the full name and explicit primary-contact ID agree. Their twenty-eight
contact channels remain non-primary and unverified. Seven records remain held:
a generic occupier, a possible duplicate of a current primary contact and five
named people with existing identity candidates. Shared endpoints do not justify
merging them or declaring different identities without further evidence.

Readback proves all fifty-six customer/site/job links, source revisions, original
operator, account-holder evidence, card ownership and unchanged job descriptions.
Contact readback proves thirteen links, source payloads, graph relationships and
all sixty-three earlier contact links preserved. Final scoped preservation retains
4,511 earlier identity projections, fifty-two earlier customer links, 115 contact
points and all 1,552 retained customer source payloads. This is not an assertion
that every field in every production table was hashed.

Signed-in LIVE verification on the stable app.openfolk.ai origin shows a sample
customer's six linked jobs, customer-to-job drill-down and return, its contact and
saved mobile detail. Missing communications/findings and unconfirmed completion
timezones remain explicit. The secondary status breakdown omits a completed
category despite the correct six-completed headline; that presentation gap is
recorded for correction. Actual retained historical job descriptions are preserved,
not silently replaced with current taxonomy codes.

Current published source-link totals: **72 customers, 78 sites, 931 jobs and 76
contacts**. Refreshing the planner after these changes leaves 759 proposals, 819
held export accounts and one linked account requiring review. Fifteen previously
ready accounts gained candidate holds; older plans are not blanket approval.
The 98 API-missing customer accounts remain unresolved. Broad matching, scoring,
operational recovery and complete acceptance remain open.

No frontend/schema release, grant, credential, provider write or schedule change
was made. Private source manifests, receipts and screenshots stay outside Git in
`/private/tmp/serviceos-customer-publication-20261014-0740/`.

[Sanitised acceptance](evidence/learn-customer-publication-2026-10-14-second.json).
