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

## Local verification

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

The initial local checks preceded the TEST release recorded below. Production,
real-source acceptance, provider completeness, audio playback and retained
assessment runs remain separate work.

## Accepted in TEST — 10 October 2026

Release `019_card_sources.sql` was rehearsed and rolled back on TEST, installed
once, and accepted through actual Auth/PostgREST application readers. TEST now has
90 public tables and 20 release receipts. Source SHA-256:
`cca8c835fdf7b3e088796ecd34dae4e09b6ed615f93386ff2f03cfdea9d86e86`.

The release validator pins the entire preceding release 018, the new function,
three source policies and 19 restricted-reader column grants. Ordinary anon,
authenticated and service-role source privileges remain exactly as before. It
rejects drift in prior objects/endpoints, authority, policies or grants; installation
requires a matching acknowledged rollback report no older than one hour. An unknown
write response triggers inspection, never an automatic replay.

The exact release wrapper passed isolated PostgreSQL 17 checks, including rollback
of function/policies/grants when receipt insertion fails. Nine release-runner tests
passed across the source, correction and communication releases, including lost
responses, stale prerequisites and once-only installation. Updated TEST UI helpers
require release 019; their syntax checks passed.

Two ordinary signed-in owners from separate synthetic companies used the actual
application evidence helper for email, call, recording and interaction references.
Long Unicode clipping, zero call duration and the existing customer-card linkage
passed. Anonymous/viewer/ops/operator/service and foreign-company scope requests
were denied; foreign IDs returned no record. Direct raw reads remained closed,
unsupported references failed, and changing the owner's role revoked access in the
same session. Source reads did not change the new synthetic source records.

The three fixture users were banned, had passwords rotated, and were demoted to
viewer; memberships ended. Two emails, two calls, two recording metadata rows,
two Slack messages and eight interactions remain as evidence. Final readback at
02:20:42 UTC confirmed zero active fixture users or memberships. The fixture has
no audio objects and does not prove playback or live capture.

Across the complete hosted rehearsal, installation and acceptance, all pre-existing
email, call, recording, transcript, Slack, interaction, measurement, review and
correction rows retained identical counts and fingerprints. Only the two newly
created synthetic tenants were excluded from that comparison. No production,
provider, storage, ingestion, payroll or frontend deployment operation was made.

Evidence: [isolated release](evidence/learn-test-sources-local-release-2026-10-10.json),
[hosted rollback](evidence/learn-test-sources-rehearsal-2026-10-10.json),
[installation](evidence/learn-test-sources-install-2026-10-10.json),
[actual signed-in acceptance](evidence/learn-test-sources-acceptance-2026-10-10.json),
[final catalog, retirement and preservation](evidence/learn-test-sources-final-2026-10-10.json).

This acceptance verifies synthetic TEST source reads. It does not establish provider
completeness, real employee scores, live Slack/voicemail capture, playable recordings,
transcript access or production readiness. The frontend remains undeployed.

## Customer timeline integration — 11 October 2026 (local only)

Customer and job timeline entries can now open the existing restricted original
email/call/recording reader directly. Previously this reader was reachable only
through scorecard evidence. The shared `LearnStoredEvidence` component preserves
the same field allowlist and caller-scoped RPC; it performs no provider fetch,
source write, permission change or raw-table fallback. Unsupported source types
explicitly say that only the displayed interaction details are available.

A failed source read offers Retry. Source/tenant changes remount the panel, and
unmounted reads cannot deliver old results. Recording details explicitly remain
metadata, not playback. Scorecard evidence reuses the same component.

The real components were exercised in the isolated local browser fixture: open
a customer, inspect its finding and timeline, receive simulated source denials,
then retry to read the retained email and call metadata. The unsupported Slack
original-source state remained visible while its interaction excerpt was retained.
No browser warning/error was returned by the console inspection. Eighteen focused
reader tests, application/preview TypeScript checks, both builds and 47 application
prebuild checks passed. Existing bundling warnings remain.

[Structured evidence](evidence/learn-card-source-timeline-local-2026-10-11.json)
and [synthetic browser screenshot](evidence/learn-card-source-timeline-local-2026-10-11.jpg).
This is not new hosted or real-provider acceptance. Hosted signed-in Drummonds
verification, full source/audio access and timeline traversal beyond the bounded
window remain outstanding. The browser also exposed unresolved team UUID labels
in customer finding ownership; human-readable team attribution remains to finish.
