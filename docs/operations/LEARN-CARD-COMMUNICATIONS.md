# Communication excerpts on LEARN cards

Customer, job and member cards previously queried `interactions` directly. TEST
keeps that raw table closed to ordinary clients, so linked communication evidence
could not load even when the card and work records were readable.

The implementation now uses `learn_card_communications_read` through the
signed-in client. Customer cards request their canonical person/company links;
job cards request their job identity; supporting work evidence requests at most
50 exact interaction IDs. The existing findings, graph and typed ownership links
remain in use. No identity is inferred from names, email addresses or phone numbers.

## Access and retained evidence

A dedicated NOLOGIN, NOINHERIT, NOBYPASSRLS role owns the security-definer reader.
It receives only the selected interaction columns and the current profile's ID,
company and role. Its profile policy exposes only the actual caller's row; its interaction policy
permits that caller's company owner/admin. The RPC reads the RLS-filtered profile
and verifies company and role before reading. It does not need runtime access to
the `auth` schema. UID-function execution remains required for the stored policies. It denies
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

## TEST release and actual signed-in acceptance — 10 October

TEST now has the restricted reader through releases 016 and 017: 89 public tables,
eighteen receipts. The original 016 bundle and receipt remain intact. The current
standalone migration, `20261031010000_learn_card_communications.sql`, incorporates
the correction for future reviewed deployments; do not replay it over TEST.

Release 016 passed rollback rehearsal and was acknowledged on installation, but
its post-check stopped. Hosted `postgres` lacks grant authority over the `auth`
schema, so the requested schema grant was not installed. Effective checks showed
UID-function execution was available but schema usage was not. Inspection also
found the new profile policy needed exact normalization in the older launch-metadata
catalog projection. Earlier definitions, endpoint metadata and client column grants
were verified unchanged. The original local expectation and stopped install report
remain retained; no installation was blindly repeated.

The isolated harness reproduced the actual auth-schema lookup failure. Release 017
changes only the function body to obtain the caller profile through its existing
RLS policy instead of resolving `auth.uid()` inside the function at runtime. Stored
policies already bind that function by identity. The reader remains NOLOGIN,
NOINHERIT and NOBYPASSRLS, with the same column grants and explicit company/role
checks. Its `auth` schema access stays closed. Exact isolated and hosted rollback
checks passed before the correction was installed and verified.

Five focused release/context tests passed, covering metadata mutation, preserved
prior catalogs, stale rehearsal denial and uncertain-write handling. The corrected
isolated migration and actual SQL response tests passed; twelve client/card tests
passed. Current TEST UI/fixture launchers now require release 017. Historical
release scripts retain their own exact contracts.

Actual Auth/PostgREST acceptance exercised the application readers with two
synthetic companies. Customer, job and member cards each returned the correct email,
call and Slack excerpts linked to one retained work item. Long Unicode excerpts
were explicitly shortened; deleted records and raw metadata were excluded. Foreign
company requests failed, foreign IDs returned no records, raw-table SELECT stayed
closed, and anonymous/viewer/ops/operator roles were denied. Changing the owner to
admin succeeded; later demotion affected the same session and produced a visible
card access gap.

The first acceptance fixture failed atomically because its synthetic Slack source
timestamp was incorrectly formatted as a date instead of a numeric value. The seed
was corrected and rehearsed with rollback; a fresh complete acceptance passed.
All pre-existing TEST communication counts and full-row fingerprints stayed equal.
Both fixture runs retain their identities. All six logins were banned, passwords
rotated and profiles reduced to viewer, with no active members. The successful
fixture retains two emails, two calls, two Slack rows and eight interactions.

Evidence: [initial expectation](evidence/learn-communications-initial-local-expectation-2026-10-10.json),
[016 rehearsal](evidence/learn-test-communications-rehearsal-2026-10-10.json),
[016 stopped post-check](evidence/learn-test-communications-installed-2026-10-10.json),
[017 rehearsal](evidence/learn-test-communication-context-rehearsal-2026-10-10.json),
[017 installation](evidence/learn-test-communication-context-installed-2026-10-10.json),
[corrected local context](evidence/learn-card-communication-context-local-2026-10-10.json),
[initial fixture](evidence/learn-test-communications-acceptance-initial-2026-10-10.json),
[signed-in acceptance](evidence/learn-test-communications-acceptance-2026-10-10.json), and
[final readback](evidence/learn-test-communications-final-2026-10-10.json).

These checks use explicitly seeded source links and synthetic data, not provider
capture or a proof of the ingestion/projection pipeline. Browser rendering of the
hosted reader, real-source ordinary-user acceptance, production release, raw-source
performance drill-down, broader staff visibility and source reconciliation remain.
No production mutation, provider request, employee rating or pay action occurred.
