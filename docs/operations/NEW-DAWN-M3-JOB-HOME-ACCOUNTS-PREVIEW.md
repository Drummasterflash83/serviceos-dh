# M3 saved company accounts · OpenFolk preview

The job-first home offers an **operator-only** saved-report preview after the
audited Drummonds job view opens. Its own `new_dawn.job_home_accounts_preview`
flag remains absent/OFF until a reviewed release. The existing
`new_dawn.report_summary_preview` flag and server authority check are separate;
both must permit a read. Client owner/admin/team views and all client money
flags remain OFF.

The bounded `learn_quickbooks_report_pair_candidates` RPC returns only metadata
for up to 12 **production** P&L and Aged Receivables receipt pairs captured by
the signed-in operator for the selected tenant. It matches connection, realm,
currency, period end and A/R report date, requires verified retained receipts,
and logs the candidate read. It returns no amounts or raw response. The operator
chooses a dated pair, reviews its company/period/basis, and explicitly asks for
the existing audited summary RPC. That RPC rechecks both exact receipt IDs,
source hashes and shape. The browser projects only accounts GP and owner-level
net profit; field GP and ARR remain held. It labels the period and distinguishes
a historical snapshot from a partial current month. A source report is not a
job-costing result or proof that later QuickBooks adjustments are absent.

`20261108100000_new_dawn_report_pair_candidates.sql` is additive. It seeds no
flag, schedule, request or publication and makes no provider call. The
rollback-only hosted TEST rehearsal covers flag-off and ordinary-user denial,
operator candidate read/audit, a bounded no-amount response and function grants.
The browser decoder refuses wrong actor/tenant, future or mismatched period,
hash, realm, basis, currency and non-decimal summary data. Focused tests,
TypeScript and build pass locally.

The exact LIVE preflight is:

`NEW_DAWN_M3_ALLOW_PROJECT=tgbnakbxwcqjeimygroz node scripts/verify/new-dawn-m3-report-pairs-release.mjs --live-read-only`

It has returned `exact_m3_pairs_ready` with five saved report requests, four
receipts, 131 finance events, the existing operator summary flag ON, all
client money flags OFF and the exact prior function hashes. The prior capture
and summary SQL is installed without migration-ledger rows; its three LIVE
function definitions matched a rollback-only TEST installation of the reviewed
sources. Do not invent ledger rows for those earlier migrations. The new
migration will receive its own exact ledger row.

After PR merge and hosted checks, the release owner may run the same command
with `--live-install-exact` **once**, then `--live-read-only`. The installer
rechecks the source SHA, previous function hashes, tenant/realm, flags and
absence of this RPC inside the transaction; it records the exact migration and
compares report, receipt and finance-event counts afterward. An uncertain
write is never replayed automatically. No flag is enabled by this step.

Signed-in acceptance after a separately reviewed Drummonds-only operator flag
switch: open the audited Drummonds job preview with a reason, press **Find saved
report periods**, choose a dated verified pair, review company/period/basis,
then press **Read selected accounts snapshot**. Check desktop and 390 px mobile:
dates and partial/historical coverage must be clear, GP/NP must be exact saved
source strings, field GP/ARR held, and no figure visible before the deliberate
read. Confirm `report.pair_candidates_read` and `report.summary_preview_read`
audits; ordinary access must be denied. Client owner/admin/team money remains
off. Disable only `new_dawn.job_home_accounts_preview` to withdraw the panel;
the additive RPC and immutable audit can remain. Client publication requires
separate accounting review and a real owner identity; Chris's OpenFolk identity
must never substitute for Drummonds staff.

The separately prepared flag switch is
`scripts/verify/new-dawn-m3-job-home-accounts-flag.mjs`. Its read-only preflight
currently returns `operator_accounts_preview_off`. After the exact SQL and
Vercel merge are verified, the release owner can run:

1. `NEW_DAWN_M3_ALLOW_PROJECT=tgbnakbxwcqjeimygroz node scripts/verify/new-dawn-m3-job-home-accounts-flag.mjs --live-read-only`
2. `NEW_DAWN_M3_ALLOW_PROJECT=tgbnakbxwcqjeimygroz node scripts/verify/new-dawn-m3-job-home-accounts-flag.mjs --live-enable-drummonds-operator-only`
3. Repeat `--live-read-only` and complete the signed-in acceptance above.

The switch pins the exact selector ledger and function definition, verifies one
available same-actor saved report pair, the Drummonds job-preview and
report-summary controls, and zero enabled owner/client money flags. It changes
only `new_dawn.job_home_accounts_preview` for Drummonds and reads back once;
uncertain outcomes are never replayed. To withdraw, run
`--live-disable-drummonds-operator-only` with the same project environment
variable. Withdrawal depends only on the exact flag scope, so it still works
if report evidence or selector health later fails. No provider request is made.
