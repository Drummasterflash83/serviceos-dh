# Phone configuration readiness

The controller previously counted proposed ownership, ignored read failures and
could report shadow readiness while the latest policy was draft or the source
allowlist disabled. Ownership on another channel could supply a missing Phone
handler, and overlapping assignments could silently replace one another.

The readiness reader now checks complete company-scoped inventories for active
Phone endpoints, ownership, people, teams, Customer Health policy versions and
tenant-scoped source settings. A fixed observation time governs endpoints,
assignments and people. Only confirmed, uniquely assigned current owners count.
People must be current company members, teams must exist in the company and role
names must be nonblank. A shared destination alone does not establish accountability.
Every current DDI needs an accountable owner and primary handler for shadow
configuration readiness. Conflicting or overlapping confirmed roles prevent a
ready result; confidence must be finite, within 0.5–1 and present for confirmed
accountable/handler assignments. Extension and queue discovery are informational.

Shadow configuration also requires the latest Customer Health policy to be
published and the tenant source allowlist explicitly enabled with `phone_call`,
matching the actual processing pipeline. Duplicate policy versions or tenant
source settings are unavailable, rather than choosing an arbitrary winner.
Read failures and incomplete inventories fail the request. No settings, assignments,
provider requests or capture controls are changed by this read.

The operator UI removes a hard-coded draft/disabled/inactive panel and explains
that provider capture, audio playback and processing acceptance are separate.
Refresh clears the previous readiness value and rejects superseded responses;
a failed read cannot retain a green badge.
Even the highest configuration result never grants staff-pilot readiness. Existing
wire types and operator authorization are retained.

## Verification

- Eleven focused tests cover configuration gates, ownership review, overlap, current
  people, foreign references, confidence, source scope, inventory failures and
  2,503 DDIs / 5,006 assignments under a simulated 137-row server cap.
- Ownership, health, roster, identity and release guards pass together: 54 tests.
- Actual isolated PostgREST v14.5 and the installed client read 2,503 DDIs,
  people, teams and policy versions plus 5,006 assignments, with a 137-row cap.
  All 132 requests are read-only, including twelve count HEADs and six terminal
  empty pages. Foreign rows and team-scoped settings are excluded, the newest
  policy is used and synthetic fingerprints are unchanged. This does not prove
  hosted schema or signed-in operator acceptance.
- Application and readiness-module TypeScript checks pass. The full build passes,
  including 47 prebuild checks; existing bundler warnings remain.

Reproduce with `node --test scripts/learn-phone-readiness.test.mjs` and
`python3 scripts/verify/learn-phone-readiness-http.py`. The latter uses cached Docker
images, no external network, published ports, host mounts or customer records.

## Release and remaining acceptance

Reviewed closure: 22 files,
`0b8ff421a99248d8954b135f6e0f5f55ba878408010cef789c5a724df1d1e285`.
The prepared TEST replacement requires controller v5, the installed runtime/schema
catalogs and all 101 preservation fingerprints, journals before one submission,
and checks retained sources afterwards. Hosted release is not yet claimed by this
local checkpoint. Production is unchanged.

These bounded reads are not a database transaction: same-count concurrent edits
may escape detection. Each table is limited to 20,000 rows, 8 MiB and 100 requests;
exceeding a limit is unavailable, not partially ready. Named-role readiness is a
configuration assertion, not proof that a particular employee holds that role.
Positive signed-in hosted acceptance, live capture, playable recordings, actual
shadow results and staff safety remain separate requirements.
