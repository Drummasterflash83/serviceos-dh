# Commusoft customer account-holder review

## Status: LIVE reviewed identity journey verified, 13 October 2026

The exact backend change is installed in TEST and production. Git
9091ce4970a319aacb6959227382532688957e93, deployment
dpl_BdmR3wuhjf1ghYYN58sQQgeYbMpG, serves the existing live aliases. A signed-in
operator reviewed one real account against the current provider export and saved
it through the new form. Readback verified one correctly named card, separate
primary-contact identity, retained evidence/source/actor and a matching audit
receipt. The published card was then opened through logged operator access.
It currently has no published linked jobs; this is not a comprehensive-card claim.
TEST's frontend remains unchanged and its signed-in journey is still outstanding.

Current Commusoft evidence distinguishes a customer account holder from its API
primary contact. A tenant, family member or other contact must not silently
become the customer or receive the account's jobs and communication context.
Before this release, all three previously published Drummonds customer-card names were corroborated
against the fresh provider export; this change does not rewrite those records.

The review requires an explicit account name, a same/different primary-contact
decision and a short reference to the checked provider account or export when
creating a new person customer. If the two are different, the new account holder
gets no copied first/last name, email or phone. The original contact remains in
immutable source evidence for separate contact review. If they are the same,
the name must match the retained primary contact before its details are copied.
Neither route creates a verified status or invents consent, history or scores.

The reviewer, source version and account-holder evidence are saved with the new
person and immutable link request. Existing-target review, company creation and
exact retries of previously saved legacy reviews retain their original paths.
New person creation through the old endpoint fails closed. New operator requests
use the existing selected-client facade and its audit receipts; no new grant,
profile movement, impersonation, provider permission or capture setting is added.

## Verification

- Fourteen focused client/facade tests, TypeScript and the production application
  build pass, including the repository's 47 prebuild checks.
- A network-isolated native database restore plus the 24 reviewed release packages
  compiles and exercises the change as `postgres`. Same/different identities,
  malformed input, stale sources, changed retries, audit-failure rollback,
  operator isolation and legacy retries across installation are checked.
- All 1,591,580 archived rows across 394 tables and seven sequences remain
  unchanged. All synthetic fixtures roll back; the disposable container is removed.
- The rehearsal baseline excludes later unrelated Slack changes. It is not a
  claim that the current production schema or signed-in deployment was accepted.

Reproduce with `python3 scripts/backup/rehearse_customer_account_holder.py
--output /private/tmp/account-holder-rehearsal-<unique>` using the retained approved
archive and pinned local image. The output directory must be fresh. Private
restore diagnostics stay outside Git.

## Release and remaining acceptance

[Verified release evidence](evidence/learn-customer-account-holder-production-2026-10-13.json)
and the exact envelopes under
`supabase/release/learn-production-patches/account-holder-v1/` supersede the local-only
status above. The requirements below were followed for this release and apply to
future amendments.

For future promotion, compare current hosted definitions/access, prepare the exact
guarded migration and preservation evidence, and verify a matched backend and
frontend release. Install the backend before enabling the new frontend form.
The old frontend will refuse new person creation during that interval rather
than infer an account holder. Retain the schema safeguards if frontend rollback
is necessary; do not restore blind primary-contact person creation. Any rollback
of published review data needs a separately reviewed correction, not deletion.

This release does not bulk-publish customers or prove provider completeness.
The known API/UI customer coverage gap and wider canonical customer/site/job/
contact reconciliation remain open. Local evidence is recorded in
[evidence](evidence/learn-customer-account-holder-candidate-2026-10-13.json).
