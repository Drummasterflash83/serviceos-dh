# Customer communication lookup performance patch

Applied and catalog-verified LIVE at 20:51:28 UTC on 13 October 2026. The signed-in
customer card with 585 jobs now reads both findings and communications successfully;
nine contacts remain available. All 33 retained contact source links and their
identity, endpoint, source and relationship evidence were unchanged. No linked
communication was returned for that customer; matching remains incomplete. The LIVE
customer communication reader times out while checking current Commusoft versions
for every owned job. This patch restricts that work to jobs with a committed Slack
context review, before the costly version checks. All final tenant, customer/site
ownership, immutable review, source freshness and public-channel visibility checks
remain intact. It changes only `learn_card_slack_job_context(uuid,uuid,uuid)`.

Use only the exact guarded apply.sql with the manifest's release target and source
SHA256 settings. Do not apply the merged migration tree or promote its frontend;
QuickBooks is separate TEST work. Before rollback, require the manifest's exact
`after` function definition MD5, owner and ACL. rollback.sql restores the original
helper without changing records or access. It can reintroduce the timeout.

Full-schema rehearsal passed 15 existing journeys, 42 withholding comparisons and
a 600-unrelated-job regression. The old helper traverses irrelevant source versions;
the new helper avoids them while returning the reviewed conversation. All archived
1,591,580 rows and seven sequences remain unchanged. Wrong target/digest, definition
and access drift, late failure, transaction rollback and definition rollback passed.

The regression fixture is scripts/verify/learn-customer-context-lookup.assert.sql.
In an isolated fully restored database only, retain the original helper definition
under `verify_card_slack_job_context_baseline` before applying this patch, revoke
its execution from public/anon/authenticated/service_role, then run the fixture
inside a transaction with public,pg_catalog search_path and roll it back. Never
install the baseline helper or fixtures in production.

This optimization does not bypass stale canonical job links. Source updates still
require a provenance-preserving refresh workflow before derived Slack context can
be treated as current. Broad customer/job publication remains incomplete.
