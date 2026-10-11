# Team-group selection for cards and scorecards

## Behaviour

The former dropdown rejected companies with more than 200 groups and could not
retry a failed read. The chooser now loads 24 accessible groups per page and
searches names through the existing tenant-scoped card-search RPC. Choosing a
result applies its ID to member/team cards and the existing scorecard scope. Its
observed name appears beside the filter and in the scoring-settings description.
Clearing the filter returns to all accessible current members or teams.

Only an open chooser reads groups. Submitting search resets its page; empty search
returns to browsing. Read failures offer retry without changing the selected team.
Results belong to the current tenant/query/page/retry attempt; late responses
cannot replace newer results. Closing discards chooser state. Switching card type
clears the selected group. The existing user/tenant remount clears company state.

The chooser reuses `readLearnCards` and `searchLearnCards`, including tenant filters
and caller RLS. Direct card pages now reject duplicate IDs and responses larger
than the requested sentinel window. No schema, grants, staff records, memberships,
scoring policies or provider capture are changed.

## Verification — 11 October 2026

- Fifteen card/search reader checks pass. The added case traverses 253 groups over
  eleven bounded pages, excluding another tenant, and selects current members of
  group 253 without including ended members. Duplicate-page results are rejected.
- Application and preview TypeScript checks and builds pass, including all 47
  application prebuild checks. Existing bundler warnings remain.
- Actual browser review traverses 256 synthetic groups over eleven pages with no
  repeated labels, retries an initial failed read, selects team 253, and verifies
  the resulting member and team-card scopes. Direct name search and literal
  punctuation search pass. A delayed prior search does not overwrite newer
  results. Empty results, clear-search, clear-filter, Escape dismissal, explicit
  scoring-settings group label and type-switch reset pass. Console errors: 0.
- TEST backend readback at 02:33 UTC matches installed release 051, 52 ledger
  entries and all 101 preserved dataset fingerprints. No backend deployment needed.

Use `&groupPicker=volume` or `&groupPicker=retry` on the existing local LEARN launch
preview for the synthetic browser fixture. It does not verify hosted signed-in
access. The protected [paired TEST frontend](https://serviceos-learn-test-er2xaypr5-allkin.vercel.app) is READY from Git
`5562c29deff36dac1add8ef58308e4591ec73d01` at 02:36 UTC. Backend binding and
all three anonymous Vercel-protection checks pass. The actual browser redirects
`/client?section=learn` to its own sign-in page with zero console errors. Signed-in
hosted chooser acceptance remains pending; production is unchanged.
[Local evidence](evidence/learn-team-group-picker-local-2026-10-11.json) and
[TEST deployment evidence](evidence/learn-team-group-picker-test-2026-10-11.json).

## Limits

Pages reflect current accessible canonical groups, ordered by update time and ID.
They are not a frozen directory snapshot; concurrent edits can move rows between
pages. Search is literal name matching, not fuzzy matching. The existing page
bound is retained (0–10,000). Team-group selection does not remove the separate
2,000-record limit in the OpenFolk operator roster inventory or establish
historical membership coverage for scoring.
