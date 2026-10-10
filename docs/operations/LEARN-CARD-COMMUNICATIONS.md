# Communication excerpts on LEARN cards

Customer, job and member cards previously queried `interactions` directly. TEST
keeps that raw table closed to ordinary clients, so linked communication evidence
could not load even when the card and work records were readable.

The local implementation now uses `learn_card_communications_read` through the
signed-in client. Customer cards request their canonical person/company links;
job cards request their job identity; supporting work evidence requests at most
50 exact interaction IDs. The existing findings, graph and typed ownership links
remain in use. No identity is inferred from names, email addresses or phone numbers.

## Access and retained evidence

A dedicated NOLOGIN, NOINHERIT, NOBYPASSRLS role owns the security-definer reader.
It receives only the selected interaction columns and the current profile's ID,
company and role. Its RLS policy permits the actual signed-in company's owner/admin.
The RPC independently verifies that company and role before reading. It denies
viewers, ops, operators and foreign-company requests. Only authenticated clients
receive execute permission; anonymous/service callers receive none. The temporary
deployer SET/INHERIT membership is removed after installation; PostgreSQL 17 retains
creator ADMIN ownership for the database administrator, which is not app access.

The reader returns source identity, time, title, summary, preview and canonical
person/company/job links. Raw metadata, addresses, phone numbers and processing
fields are not included. Existing source rows, raw-table client grants, provider
connections and credentials are unchanged. This is an additional read surface,
not an import, redaction of original data or change to source ownership.

The scope must be either person/company links, one job, or 1–50 exact IDs. Responses
contain at most 51 rows, ordered by time then ID; the extra row signals the existing
50-row timeline bound. Deleted/removed interactions are excluded. Titles, summaries
and previews over 4,000 characters include an explicit shortened-excerpt suffix.
Missing source links, read failures and denied access remain visible as card gaps.
A denied request cannot masquerade as an authorised empty result.

The client checks the response version, company, unique IDs, requested links/IDs,
allowed fields and bounds before projecting evidence. Customer/job/member fixtures
still connect email, call and Slack evidence to retained findings. A member timeline
covers communications linked to owned work; it does not establish all communications
sent or received by that person. No measurement, score, confirmation or pay change
is derived from this read.

## Verification

Twelve focused client/card tests passed. Both application and preview TypeScript
checks and the preview build passed (existing bundle/dynamic-import warnings remain).
The preview mock now implements the same RPC envelope.

`python3 scripts/verify/learn-card-communications.py` creates a disposable,
network-isolated PostgreSQL container and uses recorded source-column definitions
with synthetic data. It verifies migration/rollback under a non-superuser deployer,
role/tenant denial, owner/admin success, same-session revocation, closed raw-table
access, bounded and ordered results, excluded deleted rows, selected fields, marked
Unicode excerpts, invalid input and unchanged source-row fingerprints. The actual
SQL response was accepted by the application reader. The container was removed.

The first harness runs exposed differences in the database image's default grants
and PostgreSQL 17 creator-role membership. The harness now explicitly reproduces
TEST's closed raw-table grants and checks forbidden SET/INHERIT access separately
from database-administrator ADMIN ownership. These corrections did not change the
application's authorization boundary.

See [local verification evidence](evidence/learn-card-communications-local-2026-10-10.json).

## Release status and next gate

Migration: `20261031010000_learn_card_communications.sql`. This is local, not installed
in TEST or production. TEST remains release 015 with the verified phone endpoints.
The updated local cards need this reader before their communication timeline can
work against TEST; a missing RPC remains an explicit evidence gap.

Before deployment, inspect the complete current target policies, column grants,
roles and function inventory; build a separately pinned additive TEST release and
rehearse rollback. Prove all earlier catalog definitions/privileges and source rows
remain unchanged except the two new reader policies, role grants and RPC. Then use
actual signed-in users to trace synthetic email/phone/Slack interactions through
customer/job/member cards, including role revocation and company isolation. The
offline fixture is not full hosted Auth or a complete existing-policy projection.

Production release, real-source user acceptance, raw-source drill-down for
performance measurement references, broader staff visibility, complete provider
coverage and source reconciliation remain separate work. No production mutation,
provider request or real employee assessment occurred in this milestone.
