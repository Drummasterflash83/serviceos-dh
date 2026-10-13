# Slack visibility lookup performance patch

Applied and catalog-verified in LIVE at 20:33 UTC on 13 October 2026. The signed-in
findings read succeeds. A separate customer/Slack communication lookup still times
out; this patch does not establish a complete healthy timeline. See the production
evidence referenced by the manifest.
The LIVE card findings query timed out inside `learn_slack_document_withheld`.
This patch replaces only that private helper. It follows UUID references in the
requested document, then at most one measurement and one observation layer, matching
the original semantics. It never treats embedded text, object keys or uppercase
UUID strings as references. It retains tenant filters, the exact withholding
marker, security-definer owner, volatility, search path and private execute ACL.

The production wrapper requires the exact project, source digest, existing helper
definition and ACL. Do not run the full merged migration tree: QuickBooks is separate.
Set `serviceos.release_target` and `serviceos.release_sha256` from the manifest,
then apply only this package as the existing postgres deployer. Before any rollback,
verify that the current definition MD5/ACL/owner match the manifest's `after` block;
rollback.sql restores the old definition without changing permissions or source data.
Rollback restores the expensive query and may reintroduce the card-read timeout.

Full native-schema rehearsal preserved 1,591,580 rows and seven sequences. Fifteen
existing journeys and 42 baseline-versus-candidate cases passed. The exact wrapper
passed wrong-target, wrong-digest, definition/access drift, late-failure, transaction
rollback and definition rollback checks. Raw source data and private logs are excluded.

The comparison fixture is `scripts/verify/learn-slack-visibility-lookup.assert.sql`,
run after the existing source-withheld fixture with the previous helper retained
under `verify_slack_document_withheld_baseline` in the isolated test database only.
Production must never receive that test helper or synthetic fixtures.
