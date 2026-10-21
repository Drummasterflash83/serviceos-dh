import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";
import { financeAmount } from "@/lib/learn-quickbooks-finance";
import { readFounderAccountsPairs, readFounderAccountsPreview,
  type AccountsPair, type FounderAccountsPreview } from "@/lib/new-dawn-founder-accounts-preview";
import { readAccountsMarginPreview, type AccountsMarginPreview } from "@/lib/new-dawn-accounts-margin";
import { accountsNetMargin, agedReceivablesBucketKind, moneyReportFreshness,
  newestAccountsPair, netProfitYtdComparison } from "@/lib/new-dawn-md-money";
import { MdAgedInvoices } from "./MdAgedInvoices";

type Snapshot = { accounts: FounderAccountsPreview; margin: AccountsMarginPreview | null };
const dateTime = (value: string) => new Date(value).toLocaleString("en-GB", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London",
});

/** Money is only mounted inside the short-lived, audited Drummonds MD view. */
export function MdMoneyPanel({ tenant, reason, summaryOnly = false, onOpenFull }: {
  tenant: string; reason: string; summaryOnly?: boolean; onOpenFull?: () => void;
}) {
  const { user } = useAuth();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [periods, setPeriods] = useState<AccountsPair[]>([]);
  const [selectedRequest, setSelectedRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const initialReadKey = useRef("");
  useEffect(() => () => { generation.current++; }, []);
  const flags = useQuery({
    queryKey: ["md-money-flags", tenant, user?.id],
    enabled: !!user,
    retry: false,
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().from("feature_flags")
        .select("flag,value").eq("tenant_id", tenant)
        .in("flag", ["new_dawn.report_summary_preview", "new_dawn.report_margin_preview"]);
      if (error) throw Error("Money release unavailable");
      return {
        accounts: data?.some(row => row.flag === "new_dawn.report_summary_preview" && row.value === true) === true,
        margin: data?.some(row => row.flag === "new_dawn.report_margin_preview" && row.value === true) === true,
      };
    },
    staleTime: 30_000,
  });

  const openSavedAccounts = useCallback(async (requestId?: string) => {
    if (!user || !flags.data?.accounts || busy || reason.trim().length < 3) return;
    const ticket = ++generation.current;
    setBusy(true); setError(""); setSnapshot(null);
    try {
      const client = getSupabaseClient();
      const { data: candidates, error: candidateError } = await client.rpc(
        "learn_quickbooks_report_pair_candidates", { p_tenant: tenant, p_reason: reason.trim() },
      ).abortSignal(AbortSignal.timeout(20_000));
      if (candidateError) throw Error("Saved report periods unavailable");
      const available = readFounderAccountsPairs(candidates, tenant, user.id);
      const pair = requestId ? available.find(candidate => candidate.profitRequest === requestId) ?? null
        : newestAccountsPair(available);
      if (!pair) throw Error("No matching report pair");
      const { data: raw, error: summaryError } = await client.rpc(
        "learn_quickbooks_report_summary_preview", {
          p_tenant: tenant, p_profit_request: pair.profitRequest,
          p_receivables_request: pair.receivablesRequest, p_reason: reason.trim(),
        },
      ).abortSignal(AbortSignal.timeout(20_000));
      if (summaryError) throw Error("Saved accounts unavailable");
      const accounts = readFounderAccountsPreview(raw, tenant, pair);
      let margin: AccountsMarginPreview | null = null;
      if (flags.data.margin) {
        const { data: rawMargin, error: marginError } = await client.rpc(
          "learn_quickbooks_accounts_margin_preview", {
            p_tenant: tenant, p_profit_request: pair.profitRequest,
            p_receivables_request: pair.receivablesRequest, p_reason: reason.trim(),
          },
        ).abortSignal(AbortSignal.timeout(20_000));
        if (!marginError) {
          try { margin = readAccountsMarginPreview(rawMargin, { tenant, actor: user.id, pair, saved: accounts }); }
          catch { /* A margin shape conflict holds the percentage, not the verified report. */ }
        }
      }
      if (ticket === generation.current) {
        setPeriods(available.sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) ||
          b.periodStart.localeCompare(a.periodStart) || b.profitReceivedAt.localeCompare(a.profitReceivedAt)));
        setSelectedRequest(pair.profitRequest);
        setSnapshot({ accounts, margin });
      }
    } catch {
      if (ticket === generation.current) {
        setPeriods([]); setSelectedRequest("");
        setError("The latest saved QuickBooks reports could not be checked together. Figures remain withheld.");
      }
    } finally {
      if (ticket === generation.current) setBusy(false);
    }
  }, [user, flags.data?.accounts, flags.data?.margin, busy, reason, tenant]);

  // Opening the audited MD money view is the read request. Show the newest
  // verified saved period immediately, while keeping the manual retry control.
  useEffect(() => {
    const key = `${tenant}:${user?.id ?? ""}:${reason}`;
    if (!user || flags.data?.accounts !== true || reason.trim().length < 3 ||
        initialReadKey.current === key) return;
    initialReadKey.current = key;
    void openSavedAccounts();
  }, [tenant, user, reason, flags.data?.accounts, openSavedAccounts]);

  const saved = snapshot?.accounts;
  const ytd = saved ? netProfitYtdComparison(saved.periodStart, saved.periodEnd) : null;
  const netMargin = saved && snapshot?.margin
    ? accountsNetMargin(saved.netProfit, snapshot.margin.totalIncome) : null;
  const agedBucket = saved ? agedReceivablesBucketKind(saved.receivables.days91Plus) : "unknown";
  const freshness = saved ? moneyReportFreshness(saved.periodEnd, saved.arAsOf, new Date()) : null;
  if (summaryOnly) return <section className="md-money-strip" aria-label="Drummonds MD company money">
    <div className="md-money-strip-heading"><div>
      <p className="of-eyebrow">DRUMMONDS · MD MONEY</p>
      <h3>Company money</h3>
      <p>Saved QuickBooks accounts for a dated period. Job-level money still needs verified links.</p>
    </div>{onOpenFull && <button type="button" onClick={onOpenFull}>See money detail →</button>}</div>
    {flags.isError && <p role="alert">Money release status is unavailable.</p>}
    {flags.data?.accounts !== true && !flags.isPending && !flags.isError &&
      <p role="status">Accounts figures are not released for this view yet.</p>}
    {flags.data?.accounts === true && !saved && !error &&
      <p role="status">Checking saved accounts…</p>}
    {error && <p role="alert">{error}</p>}
    {saved && <>
      {freshness && <p className={`md-money-freshness md-money-freshness--${freshness.state}`}
        role={freshness.state === "older" || freshness.state === "unverified" ? "status" : undefined}>
        {freshness.message}</p>}
      <div className="md-money-strip-grid">
        <div><span>Accounts gross profit</span>
          <strong>{snapshot?.margin ? `${snapshot.margin.accountsGrossMarginPct}%` : "Awaiting denominator"}</strong>
          <small>Accounts basis · field GP needs job costs</small></div>
        <div><span>Net profit · MD only</span>
          <strong>{financeAmount(saved.netProfit, saved.currency)}</strong>
          <small>FY27 to {saved.periodEnd} · target pending</small></div>
        <div><span>Further Works</span><strong>Not enough data yet</strong>
          <small>Needs classified quotes and linked work</small></div>
        <div><span>Recurring revenue</span><strong>Not enough data yet</strong>
          <small>Needs verified contracts and terms</small></div>
      </div>
      <p className="md-money-strip-receivables"><strong>Company receivables · {saved.arAsOf}</strong>
        <span>{financeAmount(saved.receivables.total, saved.currency)}</span>
        <small>Net total on the saved A/R report, including credits; not a live balance or invoice chase.</small></p>
      <p className="md-money-strip-source">QuickBooks · {saved.periodStart} to {saved.periodEnd} · {saved.accountingMethod} basis · saved {dateTime(saved.profitReceivedAt)} UK. These are saved reports, not today's live balances.</p>
    </>}
  </section>;
  return <section className="md-money" aria-label="Drummonds MD money">
    <p className="of-eyebrow">DRUMMONDS · MONEY</p>
    <h2>Company money at a glance.</h2>
    <p>Start with verified QuickBooks company accounts for the dated period below. Job-to-cash gaps and original invoice records follow. Each read is audited; nothing here moves money or sends a chase.</p>
    <div className="md-money-accounts">
      <h3>Company accounts</h3>
      <p>The latest verified saved QuickBooks period opens with this audited view. Figures show their dates and accounting basis.</p>
      {flags.isError && <p role="alert">Money release status is unavailable.</p>}
      {flags.data?.accounts !== true && !flags.isPending && !flags.isError &&
        <p role="status">Accounts figures are not released for this view yet.</p>}
      {flags.data?.accounts === true && <button className="cp-primary" type="button"
        disabled={busy} onClick={() => void openSavedAccounts(selectedRequest || undefined)}>
        {busy ? "Checking saved accounts…" : saved ? "Refresh saved accounts" : "Open saved accounts"}
      </button>}
      {periods.length > 1 && <label className="md-money-period">Saved accounting period
        <select value={selectedRequest} disabled={busy}
          onChange={event => void openSavedAccounts(event.target.value)}>
          {periods.map(pair => <option key={pair.profitRequest} value={pair.profitRequest}>
            {pair.periodStart} to {pair.periodEnd} · {pair.accountingMethod} · saved {dateTime(pair.profitReceivedAt)}
          </option>)}
        </select>
        <span>Periods are separate reports. A partial month is not a trend against a full month.</span>
      </label>}
      {error && <p role="alert">{error}</p>}
      {saved && <>
        {freshness && <p className={`md-money-freshness md-money-freshness--${freshness.state}`}
          role={freshness.state === "older" || freshness.state === "unverified" ? "status" : undefined}>
          {freshness.message}</p>}
        <p className="md-money-source">QuickBooks Online · Drummonds company accounts · {saved.periodStart} to {saved.periodEnd} · {saved.accountingMethod} basis · reports saved {dateTime(saved.profitReceivedAt)} and {dateTime(saved.receivablesReceivedAt)} UK. These are saved reports, not today's live balances.</p>
        <div className="md-money-grid">
          <article><span>Accounts gross profit</span>
            <strong>{snapshot.margin ? `${snapshot.margin.accountsGrossMarginPct}%` : "Not enough data yet"}</strong>
            <p>{snapshot.margin
              ? `QuickBooks gross profit ${financeAmount(saved.accountsGrossProfit, saved.currency)} ÷ total income ${financeAmount(snapshot.margin.totalIncome, saved.currency)}. The 30% floor and 35% target basis are unconfirmed.`
              : "A verified total-income denominator is needed for the percentage. Field GP awaits job costs and links."}</p>
          </article>
          <article><span>Net profit · MD only</span>
            <strong>{financeAmount(saved.netProfit, saved.currency)}</strong>
            <p>For {saved.periodStart} to {saved.periodEnd}. Accounts net margin: {netMargin ? `${netMargin}%` : "held"}{netMargin ? ` (net profit ÷ total income; 8% same-period target)` : " until a verified total-income denominator is available"}. {ytd?.target} comparison held: {ytd?.reason}</p>
          </article>
          <article><span>Further Works this month</span><strong>Not enough data yet</strong>
            <p>£58,000 monthly target. Verified estimate value and a Further Works classification are needed.</p>
          </article>
          <article><span>Annual recurring revenue</span><strong>Not enough data yet</strong>
            <p>Verified recurring contracts, value and term are needed.</p>
          </article>
        </div>
        <section className="md-money-receivables" aria-label="Saved company receivables">
          <p className="of-eyebrow">QUICKBOOKS · SAVED A/R REPORT</p>
          <h3>Company receivables as of {saved.arAsOf}</h3>
          <strong className="md-money-receivables-total">{financeAmount(saved.receivables.total, saved.currency)}</strong>
          <p>This is the net total on the verified company report, including credits. It is neither a live balance nor a list of invoices to chase.</p>
          {agedBucket === "credit" && <p><strong>91 days and over:</strong> {financeAmount(saved.receivables.days91Plus, saved.currency)} net credit. Do not treat this age group as overdue debt.</p>}
          <h4>Age groups on this report</h4>
          <dl>
            <div><dt>Current</dt><dd>{financeAmount(saved.receivables.current, saved.currency)}</dd></div>
            <div><dt>1–30 days</dt><dd>{financeAmount(saved.receivables.days1To30, saved.currency)}</dd></div>
            <div><dt>31–60 days</dt><dd>{financeAmount(saved.receivables.days31To60, saved.currency)}</dd></div>
            <div><dt>61–90 days</dt><dd>{financeAmount(saved.receivables.days61To90, saved.currency)}</dd></div>
            <div><dt>91 days and over</dt><dd>{financeAmount(saved.receivables.days91Plus, saved.currency)}{agedBucket === "credit" ? " net credit" : ""}</dd></div>
          </dl>
        </section>
        <div className="md-money-followup">
          <h3>Job-to-cash gaps and ageing context</h3>
          {agedBucket === "positive" && <p><strong>Ageing is a review cue:</strong> the positive 91-day-and-over report bucket does not identify a collectible invoice or authorise a chase.</p>}
          <p><strong>Completed, not invoiced:</strong> awaiting verified Commusoft completion and QuickBooks job links.</p>
          <p><strong>Closed without price, quote or FOC reason:</strong> awaiting verified closure and commercial evidence.</p>
          <p><strong>Liz's chase drafts:</strong> held until invoice-level ageing and customer review are linked. No messages have been drafted or sent.</p>
        </div>
        <details className="md-money-proof"><summary>Source and read audit</summary>
          <p>P&amp;L SHA-256 {saved.profitSha256}; receivables SHA-256 {saved.receivablesSha256}. Summary audit {saved.auditId}{snapshot.margin ? `; margin audit ${snapshot.margin.auditId}` : ""}.</p>
        </details>
      </>}
    </div>
    <div className="md-money-next">
      <h3>What still needs source evidence</h3>
      <ul>
        <li><strong>FY27 net-profit comparison:</strong> the saved 1 April–19 October report covers FY27 to its stated cutoff. Finance has not confirmed the current target or its phasing. The historical £144k snapshot is not a confirmed current target.</li>
        <li><strong>Further Works versus £58k/month:</strong> current, classified quote and delivered or invoiced work with dates.</li>
        <li><strong>ARR:</strong> current recurring contracts with value, term and changes, reconciled to Finance.</li>
      </ul>
    </div>
    <MdAgedInvoices tenant={tenant} reason={reason} />
  </section>;
}
