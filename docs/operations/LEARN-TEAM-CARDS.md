# Team cards and scoring scopes

The protected TEST frontend is READY at 22:45 UTC on 10 October 2026 from Git
`4468eca77953410a6d36490255df362f7d65ad30`. Vercel route protection and the actual
browser same-origin sign-in redirect pass. Production is unchanged. See
[release evidence](evidence/learn-team-cards-2026-10-10.json).

The card UI now exposes separate **Team members** and **Teams**
tabs, alongside customers and jobs. This frontend increment uses existing tenant
organisation units and existing scoring RPCs; it adds no migration or source rows.

Team cards show bounded, tenant-filtered organisation-unit records with names,
types and update times. A selected team group filters by its organisation-unit ID.
The detail reader joins only explicit `team` or `org_unit` responsible/accountable
references. It deduplicates findings and reads their linked communications through
the existing restricted communication RPC. Same UUIDs with different reference
kinds, another team's work and foreign-company rows do not become team evidence.
Read failures remain visible. This view does not aggregate work owned by members
of the team, reconstruct historical membership, or average individual scores.

Scoring settings are now available for each card type, using its exact subject kind
and optional member/team group. Team-wide rules and individual rules for members
of that team are separate revision histories. Job/customer policies cannot receive
a stale team filter. Switching tabs resets the filter, selected card and settings;
settings remount for each scope. Both reading and saving validate returned scope.
The existing publication, completed-period assessment, review and missing-evidence
rules continue to apply. Member-only work/driving templates are omitted from other
card scopes. No connected team calculation adapter is claimed by these templates.

The synthetic preview now stores and retrieves drafts by exact scope, so saving a
job draft does not replace a team draft in the fixture. Its changes are in-memory,
not hosted writes. Synthetic team work is marked explicitly.

## Verification

- 31 focused card/settings/publication/scorer tests pass, plus four TEST readiness
  checks. New cases cover team pagination, exact filtering, typed ownership,
  foreign rows, failed reads and all six valid card/group draft scopes.
- Application and preview TypeScript checks and both builds pass. The application
  prebuild includes 47 existing checks.
- Actual browser: select Office, inspect its team-assigned work and linked email;
  save a synthetic team policy on a 0–50 scale; reopen it on the team card as
  unassessed because no measurements exist; verify individual and customer rules
  stay empty; save separate job rules; reopen the unchanged team revision.
- Read-only hosted TEST metadata confirms the required organisation-unit columns,
  RLS and authenticated scoring functions exist. This is compatibility evidence,
  not signed-in owner acceptance of this new UI.

No credentials, temporary users, operator grants, provider requests, source
mutations, real scoring rules, real assessments or production changes were made.
Fresh signed-in hosted acceptance and evidenced team aggregation remain pending.
Current deployment is recorded in [DEPLOYMENT](../DEPLOYMENT.md).

The next [team workload collector](LEARN-TEAM-WORKLOAD.md) is locally verified but
not yet installed in TEST. Its deployment must be paired with the matching frontend.
