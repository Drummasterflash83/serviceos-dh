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

For LIVE: record current main, migration hash, flag states and report/finance
counts; install this exact SQL with a rollback guard; verify the counts/flags
and grants unchanged. Merge the UI with the new flag still OFF. If the operator
preview is then enabled, perform a signed-in desktop and 390 px mobile check
using a real saved pair and reason, verify both audit events, and confirm
ordinary access denial. Disable only `new_dawn.job_home_accounts_preview` to
withdraw the panel. The additive RPC and immutable audit can remain. Client
publication requires separate accounting review and a real owner identity;
Chris's OpenFolk identity must never substitute for Drummonds staff.
