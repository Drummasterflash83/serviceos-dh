# Checked identity evidence for operator review

Email and extension suggestions previously read single capped responses and
matched verified links without consistently restricting their provider. A Slack
login email could look like an existing mail identity; the same extension number
at another phone provider could look like an existing phone identity. Truncated
member lists could also turn a duplicate name into a seemingly unique match.

Both suggestion readers now share five checked inventories: current members,
active endpoints, current verified user identities, provider mailbox metadata and
retained identity reviews. Stable-ID pages exhaust the server even when its row
cap is smaller than requested. Exact before/after counts, tenant IDs, row IDs,
empty terminal pages and the existing per-table row/byte/request budgets are
checked. Failed or incomplete reads cannot return successful partial suggestions.
One fixed observation time excludes future/expired links and future review rows.
The workspace shares this identity inventory between its email and phone readers.

Verified links must match the endpoint's provider (or its channel fallback used
by the existing manual-review RPC). Email addresses/provider object IDs and exact
extension numbers are checked without stripping arbitrary text into a number.
Conflicting verified members remain unresolved. Shared/suspended mailbox signals
and shared phone infrastructure cannot become personal suggestions merely because
an old personal link exists. Metadata from Google cannot classify a Microsoft or
manual endpoint with the same address; duplicate or mismatched mailbox references
remain review items. Rejected, deferred, unassigned and other operator decisions
are honoured. An old confirmed-person review without a unique matching current
link does not recreate that suggestion. No code here creates a link, ownership
assignment or performance score.

## Verification

Eight new identity tests, seven health tests, ten roster/authorization/store tests,
fifteen identity-v1 tests and nine telephony tests pass (49 total). The twenty
existing email classification/suggestion verification cases pass. Direct TypeScript
checking of the new identity module passes. Seven deployment-guard tests pass,
including refusal by the historical roster/health installers to deploy changed
source under their old pins.

The actual isolated PostgREST v14.5 test uses the installed PostgrestClient and the
real inventory reader/builders: 2,503 members/identities/mailboxes, 2,504 endpoints
and reviews, under a 137-row server cap. All five inventories complete in 110
requests with ten exact-count HEADs and five empty terminal pages. The duplicate
name stays ambiguous and the later unassigned decision is retained. Foreign and
ended records are excluded; synthetic source fingerprints remain unchanged.
These synthetic table shapes are not hosted schema or positive operator acceptance.

Reproduce with `node --test scripts/learn-identity-inventory.test.mjs`,
`node supabase/functions/_shared/controlplane/identity_resolution.verify.ts` and
`python3 scripts/verify/learn-identity-inventory-http.py`.
The Docker verifier uses cached images, no mounts or published ports, and no
external network or customer records.

## Release and remaining limits

Reviewed controller closure: 20 files,
`4a51b09af59e87a13c80224c30b301a40640a3bd98cd2fa0aee416677ada2d92`.
The TEST replacement runner requires operator v3 and unchanged existing schema,
and journals all 101 preservation fingerprints before one deployment attempt.
Controller v4 is ACTIVE, installed on 11 October at 03:16 UTC from Git
`6a1544dcd4ebfb09f6bb4919447e841d6c5127e8`. All 101 monitored datasets,
schema and other endpoints were preserved. Fourteen hosted workspace/data-quality
boundary checks passed. The existing protected frontend is retained at Git
`27113d0`; no frontend source or request contract changed. Positive signed-in
hosted acceptance remains pending. See [local evidence](evidence/learn-identity-inventory-local-2026-10-11.json)
and [TEST evidence](evidence/learn-identity-inventory-test-2026-10-11.json).

The read is current, not a transactional or historical snapshot. Per-table limits
remain 20,000 rows, 8 MiB and 100 requests. Same-count concurrent edits remain
possible. Review ordering uses creation time then ID for deterministic ties; IDs
do not establish real-time precedence between simultaneous conflicting decisions.
The subsequent [ownership increment](LEARN-OWNERSHIP-EVIDENCE.md) checks endpoint,
assignment and handoff reads at the requested time. Connection evidence, discovery
history, phone readiness and cross-client listing retain separate coverage limits. Positive signed-in
hosted acceptance, complete provider capture and actual card evidence attribution
remain required. This increment neither enables capture nor promotes production.
