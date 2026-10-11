# LEARN source preservation reader

The private preservation manifest tracks retained source IDs, recording storage
pointer hashes, transcript states and storage object metadata. It covers existing
email, call, recording, transcript, interaction, customer, job, member, voicemail,
email-account and tenant-connector tables. It never downloads email bodies,
transcript text or audio, and never changes the source or provider.

A comparison checks every prior retained ID rather than relying on an increased
total. Missing IDs, changed recording pointers and changed/missing inventoried
storage objects are reported separately. Failed or incomplete reads are unverified,
not zero and not proof of deletion. An incomplete current run must not replace a
previous complete baseline.

## Counted and double-pass reads

The default `counted` mode checks exact counts before and after one ordered ID scan.
Ordinary page reads and storage lists no longer request redundant exact counts.
Only the explicit HEAD count requests use `Prefer: count=exact`.

The optional `double_keyset` mode makes two independent ordered scans of each table,
using the same tenant and fixed creation-time cutoff. It sends no exact-count
requests. Both passes must reach an empty page and return identical IDs, recording
pointer hashes and transcript states before that table is verified. Replacements
that leave the total unchanged still invalidate the run. This mode can require more
page requests than counted mode, but avoids global count queries.

An empty page, not a short page, proves exhaustion: a server may impose a lower row
limit than the requested 1,000. UUIDs must be valid, unique and strictly ordered,
and every row must match the requested company. Per-table scans are capped at
1,000 page requests. The default global HTTP budget is 1,000 requests, configurable
from 1 to 10,000; exhaustion leaves the affected inventory unverified. Each request
has a 20-second timeout and each JSON response an 8 MiB limit. Errors retain only
safe HTTP/transport categories and fixed endpoint names, not response prose,
credentials, source values or request filters.

Storage enumeration also waits for an empty page, advances by the actual number
of returned entries, and rejects repeated/invalid names. It lists only the folders
referenced by this company's recording pointers. This is a read-only storage-list
POST, not an upload or download. A partial or changing source scan makes storage
coverage unverified. Storage listing remains an observation, not a transactional
snapshot or an object-byte integrity check.

The new private manifest format is `learn-preservation/2`; it records the scan mode,
request budget, requests used and safe read errors. Comparisons with earlier
version-1 manifests remain supported. Public summaries omit IDs and storage paths.
Private output uses exclusive creation and mode 0600.

With the existing secure verification environment already loaded:

```sh
VERIFY_SCAN_MODE=double_keyset VERIFY_REQUEST_BUDGET=400 node scripts/verify/learn-preservation.mjs .verification-results/new-private-manifest.json .verification-results/learn-preservation-2026-10-09.json
node --test scripts/verify/learn-preservation.test.mjs scripts/verify/learn-voicemail-email-audit.test.mjs
```

Read the result's completeness and comparison state; process success alone is not
proof of preservation. Matching passes cover the selected inventory fields, not all
source columns. They cannot exclude every concurrent edit, prove complete provider
capture, establish playable audio, or replace a tested backup/restore process.

## Earlier availability failure — 10 October, 03:12 UTC

Eighteen focused checks passed, including the six new regression cases for omitted
page counts, short-page exhaustion, matching double scans, same-count replacement,
changed pointers/statuses, unavailable/foreign/duplicate rows, request/body budgets
and repeated storage listings. The source reader is a local diagnostic change;
no database schema, Edge function, frontend or provider deployment is involved.

The previous live count checks returned HTTP 500/SQLSTATE 57014, and a separate
management aggregate returned HTTP 544. In this follow-up, the metadata/query-plan
runner timed out on its first catalog request and returned no usable statistics or
plans. A separate ID-only, ordered email page of at most 100 rows, without an exact
count, timed out after 20 seconds at 03:12:41 UTC. Therefore redundant counts are
not established as the cause of the live failure, and the new scan mode is not
claimed to restore database availability. A full double scan was not started after
the pilot failed; no database session or setting was changed.

At that time, the last complete large-source preservation comparison was the
successful 00:40–00:41 run: 18,456 emails, 4,324 calls and 2,882 recordings. The later partial
run verified small registries but could not verify those larger sources or storage.
No missing historical record is established by the failures. Later source reads
recovered, as recorded below. These earlier failures remain
unverified observations, not evidence of empty input or missing history.

Evidence: [small-page pilot](evidence/learn-source-keyset-pilot-2026-10-10.json),
[local verification](evidence/learn-source-preservation-reader-2026-10-10.json),
[earlier complete comparison](evidence/learn-preservation-phone-binding-2026-10-10.json),
and [later partial comparison](evidence/learn-preservation-voicemail-email-2026-10-10.json).
## Current production preservation — 11 October, 02:22 UTC

The read-only 100-row email pilot passed. A complete `double_keyset` scan used
149 requests with no read errors, cutoff 02:22:24.756 UTC and completion
02:22:49.217 UTC. All previous IDs from the complete 10 October 18:30:41 UTC
manifest remained across all eleven sources. No recording pointer changed and
no inventoried storage object was missing or changed in size/update metadata.

| Stored source | Current count | Previous count |
|---|---:|---:|
| Emails | 18,511 | 18,501 |
| Calls | 4,328 | 4,328 |
| Recording rows | 2,882 | 2,882 |
| Transcript rows | 2,882 | 2,882 |
| Interactions | 22,851 | 22,841 |
| Customer cards | 3,160 | 3,159 |
| Canonical jobs | 0 | 0 |
| Team members | 8 | 8 |
| Receptionist voicemails | 0 | 0 |
| Email accounts | 30 | 30 |
| Tenant connectors | 3 | 3 |

Of the transcripts, 2,876 are completed and six failed. Storage enumeration found
2,888 objects in the referenced folders; all 2,882 recording pointers matched
objects larger than 44 bytes. These are retained database records and object
metadata, not proof of full provider capture, playable audio or complete content
integrity. The six failed transcripts and zero captured voicemail rows remain
unresolved. The zero canonical jobs here describes production, not the separate
retained Commusoft TEST import.

The private ID/hash manifest remains ignored and permission-restricted. The
[public aggregate evidence](evidence/learn-preservation-live-2026-10-11.json)
contains no message bodies, customer IDs, transcript text or recording paths.
This check made no production writes or provider requests.

## Backup and recovery evidence

A separate read-only management observation at 02:25 UTC found eight production
physical database backups marked `COMPLETED`, newest inserted at
11 October 00:32:06.770 UTC. PITR is disabled. TEST returned an empty backup list.
This establishes the provider's backup metadata, not a completed restore or
recoverable audio. Storage file bytes need separate backup coverage.
See [recovery coverage and remaining acceptance](LEARN-DATA-RECOVERY.md).
