# Original-source evidence for performance cards

## Local implementation — 10 October 2026

Performance evidence previously queried `interactions`, `email_messages`,
`phone_calls` and `phone_recordings` directly. The verified TEST configuration
keeps those raw communication tables closed to ordinary clients. This produced
an access gap even for authorised company reviewers.

Interaction references now use the existing `learn_card_communications_read` RPC.
Original email/call/recording references use the new `learn_card_source_read` RPC.
The latter takes one company, one supported table and one UUID. It returns a
versioned envelope with that exact scope and one record (or null for an unavailable
reference). It contains no dynamic table SQL, source updates or provider requests.

| Source | Fields available for review |
|---|---|
| Email | Subject, clipped snippet, sent/received timestamps, provider direction |
| Phone call | Provider, provider direction, start, duration, provider outcome |
| Recording | Provider, start and duration |
| Interaction | Existing bounded subject, summary, preview and provenance reader |

Text from the new RPC is bounded to 4,000 Unicode characters plus a visible
shortening marker. Raw email bodies/HTML, provider payloads, phone numbers, costs,
recording URIs and private storage pointers are excluded. The database reader role
has no SELECT privilege on those excluded columns. A recording reference is metadata,
not audio playback or evidence of playable media. No transcript reader is added.
These are current stored excerpts and metadata, not immutable source snapshots or
proof of complete capture.

## Authority and preservation

The additive migration `20261031030000_learn_card_sources.sql` reuses the existing
restricted communication-reader role: NOLOGIN, NOINHERIT, no superuser, role/database
creation, replication or RLS bypass. It requires RLS on the caller-profile and all
three source tables. The caller-profile policy exposes only the actual signed-in
profile; owner/admin role and company must match. Source-specific RLS policies use
that same caller-profile boundary. The reader needs no runtime `auth` schema access.
Temporary deployment-role membership and schema CREATE permission are removed.

Only authenticated callers may execute the RPC; anon and service-role execution
are denied. Ordinary clients receive no new raw-table grants. The reader gains
only the listed column grants on the three source tables. Existing source records,
connections, ingestion checkpoints, recordings, policies and measurements are not
rewritten. Source absence or denied access is not converted into a zero score.

The client validates envelope scope, record identity, an exact field allowlist,
required fields, timestamp format, finite nonnegative durations and text bounds.
It never falls back to direct raw-source queries. Server Unicode shortening markers
survive rendering. Work calculation proofs, job records and member records retain
their existing reads. The card displays readable source names, UTC timestamps,
duration units and the exact reference inside each panel. A record with no
available values is explicitly described rather than shown as a blank success.

## Verification and remaining release work

- Eleven source/review/collector tests passed, including foreign/malformed/denied
  responses, no raw-table fallback and preservation of a long Unicode excerpt.
- Disposable network-isolated PostgreSQL 17 checks passed RLS prerequisites,
  non-superuser deployment, exact rollback of policies/column grants/RPC, company
  isolation, same-session role revocation, excluded-column denial and unchanged
  source/profile fingerprints.
- The actual SQL responses for all three source types passed the actual application
  evidence reader; this connects SQL response shape to client validation.
- Application and preview TypeScript checks passed. Application and preview builds
  passed, along with the 47 existing prebuild checks.
- Browser verification used the actual card component with synthetic interaction,
  email, call and recording references. All four panels rendered; the browser
  reported no console errors. Fixture source values exist only in memory.

[Database evidence](evidence/learn-card-sources-local-2026-10-10.json) and
[SQL-to-client evidence](evidence/learn-card-sources-client-from-sql-2026-10-10.json).

This increment is local only. TEST remains release 018, with 90 tables and 19
receipts. Before deploying the application, pin the source-reader release against
that catalog, rehearse/roll back on TEST, install once, and verify ordinary signed-in
source reads and unchanged existing rows. The new policies and reader column grants
must be accounted for explicitly by the catalog verifier; broad raw-client grants
are not an acceptable substitute. Production, actual source acceptance, provider
completeness, audio playback and retained assessment runs remain separate work.
