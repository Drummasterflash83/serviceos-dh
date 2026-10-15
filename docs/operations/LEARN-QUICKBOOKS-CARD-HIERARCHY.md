# QuickBooks customer finance across native subaccounts

Status checked 15 October 2026, 11:48 UTC. The read-only card reader and
matching customer-card wording are released to TEST and LIVE.

## Why this was needed

Drummonds' retained QuickBooks company has 8,848 customer subaccounts beneath
1,438 parent accounts. At the 11:25 UTC read-only checkpoint, 15,237 captured
invoices, payments, estimates and credits were addressed to those subaccounts.
The earlier canonical-card finance reader selected transactions whose
`CustomerRef` matched only an explicitly reviewed account. Future reviewed
parent cards could therefore omit the financial activity QuickBooks records
beneath that parent. None of the 24 existing LIVE reviewed cards had a child
account at that checkpoint, so this correction does not increase their totals.

## Reader boundary

- A current, individually reviewed QuickBooks customer link remains the only
  starting point for a canonical card. The reader follows QuickBooks' recorded
  `ParentRef` hierarchy within the same tenant, environment and realm.
- Conflicted customer versions, cycles and a hierarchy deeper than 32 edges
  cannot be traversed. The observed Drummonds maximum was two edges.
- An explicit child link to another card, an explicit unlink, or a changed child
  identity stops that subtree at the parent card. Multiple reviewed roots on
  the same card are deduplicated before transactions are counted.
- The existing finance access function still limits reads to company admins
  and logged OpenFolk support operators. The existing response shape, audit,
  currency separation, exact decimal handling and conflict holds are preserved.
- This is a native QuickBooks account relationship. It does **not** claim a
  QuickBooks subaccount is the same as a Commusoft job, nor attach an invoice to
  a specific Commusoft job.

## Release and verification

Migration
[`20261104010000_learn_quickbooks_card_hierarchy.sql`](../../supabase/migrations/20261104010000_learn_quickbooks_card_hierarchy.sql)
replaces only the guarded finance-reader query. Its prerequisite definition
matched exactly in TEST and LIVE. The full synthetic PostgreSQL QuickBooks suite
passed, including native child/grandchild totals, explicit child-card and unlink
boundaries, duplicate prevention, tenant denial and rollback. The frontend build
and its 47 brand/navigation checks passed locally.

The hosted release script rehearsed a rollback transaction in both projects,
then installed and read back release `quickbooks_card_hierarchy_v1`:

| Environment | Installed UTC | Reader MD5 | Access checks |
| --- | --- | --- | --- |
| TEST `saatxzwxvdvqevbnskxy` | 15 October 11:35:02 | `d61d449f5a08d6ec90a3ac1b184b76a0` | Owner, grants and unauthorised RPC denials preserved |
| LIVE `tgbnakbxwcqjeimygroz` | 15 October 11:36:59 | `d61d449f5a08d6ec90a3ac1b184b76a0` | Owner, grants and unauthorised RPC denials preserved |

No provider request, new account, grant, source import or card link was made by
this release. LIVE readback after installation found all 24 links, 24 audit
events, zero missing cards, zero identity drift and zero source conflicts. The
third unattended accounting scan continued at 1,082 saved pages with no error.

The frontend candidates were built against the current V2 code and promoted
only after checking that each deployment was READY and bound to its intended
Supabase project. `test.openfolk.ai` and the stable TEST Vercel alias now serve
Git commit `eec1e86968250c1106be7124b1a7f4965d6e79e5`; `www.openfolk.ai`,
`app.openfolk.ai`, the apex redirect and the stable LIVE Vercel alias serve
`723daaeae69d9c606a8dd33adee6f68f2dd1ec2d`. All aliases were read back
after promotion. The existing Drummonds branding and navigation remain.

Signed in at the stable LIVE site, Dan Breen's customer card showed three
published Commusoft jobs, three QuickBooks invoices totalling GBP 401.05, and
three QuickBooks payments totalling GBP 401.05. The finance panel displayed the
new QuickBooks subaccount boundary and explicitly said no individual Commusoft
job match had been established. This card has no QuickBooks child accounts, so
it verifies the unchanged direct-account path; the child-account path was
verified in the isolated PostgreSQL suite, not with a LIVE linked child card.
The signed-in Belvoir card independently showed two Commusoft jobs, two contacts,
two QuickBooks invoices and two payments, confirming that jobs, contacts and
finance are available together in the existing client UX.
[Release evidence](evidence/learn-quickbooks-card-hierarchy-release-2026-10-15.json)
contains no credential or private source payload.

The first TEST verification reported an expected-digest mismatch after a
successful installation. Its local JavaScript replacement calculation treated
the literal `$'` in the SQL currency regular expression as a replacement token.
Exact TEST function readback matched the literal prepared SQL byte for byte;
the local digest calculation was corrected, and independent TEST and LIVE
readbacks then passed. The migration and release receipt were not retried.

## Rollback

The previous finance-reader definition is captured in the guarded release
preparation. If the new reader misattributes records, restore that exact
definition in a reviewed transaction after checking its owner/grants, then
verify the affected card and audit. Do not delete retained source history,
receipts or reviewed links. A frontend wording rollback must restore the prior
alias-served deployment without changing this backend unless the reader itself
is the cause.
