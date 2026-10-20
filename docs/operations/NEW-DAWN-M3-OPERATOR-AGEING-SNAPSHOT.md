# M3 saved receivables snapshot on the OpenFolk job home

The existing OpenFolk-only saved accounts panel now shows the QuickBooks
`AgedReceivables` report **total**, alongside accounts GP and net profit, for
the explicitly selected production P&L/A/R pair. It labels the report period,
accounting basis, A/R as-of date, and the two receipt times in UTC. This is a
historical company report, not today's collectable debt or a job result.

The existing separate `new_dawn.aged_debt_exception_preview` switch still
controls **all five ageing buckets** and the positive 91+ review cue. The
parent `new_dawn.job_home_accounts_preview` and
`new_dawn.report_summary_preview` switches, operator authority, explicit
reason, reviewed pair, audited RPC, matching production source hashes and
receipt scope remain required before the panel reads any amount. No flag is
created or changed by this frontend release. The ordinary client and MD
presentation previews do not mount this private panel. Owner/client money
flags stay OFF.

Before showing any figure, the browser verifies the five exact decimal bucket
strings sum to the report total using integer arithmetic. It accepts mixed
decimal scales and credits without converting money to JavaScript `Number`.
The existing server report parser independently validates source columns and
the bucket total. An inconsistent pair is withheld. The total is company-wide;
there is no customer, invoice or Commusoft job attribution, and the UI does not
offer a chase action. Field GP and ARR remain held for their distinct evidence.

Review the signed-in OpenFolk operator view on LIVE after the normal Vercel
release gate: select a dated pair and reason, perform one audited read, compare
the total and five buckets to that same retained A/R receipt, and check the
source dates. With the separate ageing flag OFF, only the total is shown; with
it ON, the breakdown and any positive 91+ cue are shown. Check an ordinary
client session cannot see the panel. This does not approve publishing any
accounts figure to Drummonds; actual owner definitions and identity remain a
separate release gate.
