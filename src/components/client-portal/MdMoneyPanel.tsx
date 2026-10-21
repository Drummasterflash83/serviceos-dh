import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";
import { readFounderAccountsPairs, readFounderAccountsPreview,
  type AccountsPair, type FounderAccountsPreview } from "@/lib/new-dawn-founder-accounts-preview";
import { readAccountsMarginPreview, type AccountsMarginPreview } from "@/lib/new-dawn-accounts-margin";
import { DRUMMONDS_FY27_START, accountsNetMargin, agedReceivablesBucketKind, moneyReportFreshness,
  mdMoneyAmount, mdUkDay, newestAccountsPair } from "@/lib/new-dawn-md-money";

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
  const netMargin = saved && snapshot?.margin
    ? accountsNetMargin(saved.netProfit, snapshot.margin.totalIncome) : null;
  const isFy27Ytd = saved?.periodStart === DRUMMONDS_FY27_START;
  const agedBucket = saved ? agedReceivablesBucketKind(saved.receivables.days91Plus) : "unknown";
  const freshness = saved ? moneyReportFreshness(saved.periodEnd, saved.arAsOf, new Date()) : null;
  if (summaryOnly) return <section className="md-money-strip" aria-label="Drummonds MD company money">
    <div className="md-money-strip-heading"><div>
      <p className="of-eyebrow">DRUMMONDS · MD MONEY</p>
      <h3>Company money</h3>
      <p>Dated QuickBooks company accounts. Job-level money still needs verified links.</p>
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
          <strong>{mdMoneyAmount(saved.netProfit, saved.currency)}</strong>
          <small>FY27 to {mdUkDay(saved.periodEnd)} · target pending</small></div>
      </div>
      <p className="md-money-strip-receivables"><strong>Company receivables · {mdUkDay(saved.arAsOf)}</strong>
        <span>{mdMoneyAmount(saved.receivables.total, saved.currency)}</span>
        <small>Net total on the saved A/R report, including credits; not a live balance or invoice chase.</small></p>
      <p className="md-money-strip-source">QuickBooks · {mdUkDay(saved.periodStart)} to {mdUkDay(saved.periodEnd)} · {saved.accountingMethod} basis · saved {dateTime(saved.profitReceivedAt)} UK. These are saved reports, not today's live balances. Further Works and recurring revenue need verified sources; see Money detail.</p>
    </>}
  </section>;
  return <section className="md-money" aria-label="Drummonds MD money">
    <p className="of-eyebrow">DRUMMONDS · MONEY</p>
    <h2>Company money at a glance.</h2>
    <p>Saved QuickBooks accounts for the period shown below. The figures are company totals, not job profit or live balances.</p>
    <div className="md-money-accounts">
      <h3>Company accounts</h3>
      <p>Latest verified saved period, with its date and accounting basis.</p>
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
            {mdUkDay(pair.periodStart)} to {mdUkDay(pair.periodEnd)} · {pair.accountingMethod} · saved {dateTime(pair.profitReceivedAt)}
          </option>)}
        </select>
        <span>Periods are separate reports. A partial month is not a trend against a full month.</span>
      </label>}
      {error && <p role="alert">{error}</p>}
      {saved && <>
        {freshness && <p className={`md-money-freshness md-money-freshness--${freshness.state}`}
          role={freshness.state === "older" || freshness.state === "unverified" ? "status" : undefined}>
          {freshness.message}</p>}
        <p className="md-money-source">QuickBooks Online · Drummonds company accounts · {mdUkDay(saved.periodStart)} to {mdUkDay(saved.periodEnd)} · {saved.accountingMethod} basis · reports saved {dateTime(saved.profitReceivedAt)} and {dateTime(saved.receivablesReceivedAt)} UK. These are saved reports, not today's live balances.</p>
        <div className="md-money-grid">
          <article><span>Accounts gross profit</span>
            <strong>{snapshot.margin ? `${snapshot.margin.accountsGrossMarginPct}%` : "Not enough data yet"}</strong>
            <p>{snapshot.margin
              ? "QuickBooks accounts basis. Field margin and target basis still need job costs and Finance confirmation."
              : "Needs a verified income figure. Field margin still needs job costs and links."}</p>
          </article>
          <article><span>Net profit · MD only</span>
            <strong>{mdMoneyAmount(saved.netProfit, saved.currency)}</strong>
            <p>{netMargin ? `Accounts net margin ${netMargin}% for this period (8% margin goal). ` : "Accounts net margin needs a verified income figure. "}{isFy27Ytd
              ? "FY27 net-profit target comparison awaits the current approved target."
              : "This saved period is not FY27 year-to-date; target comparison is unavailable."}</p>
          </article>
          <article><span>Further Works this month</span><strong>Not enough data yet</strong>
            <p>Needs classified quotes and linked work before comparison with the £58,000 monthly target.</p>
          </article>
          <article><span>Annual recurring revenue</span><strong>Not enough data yet</strong>
            <p>Needs verified contracts, value and terms.</p>
          </article>
        </div>
        <section className="md-money-receivables" aria-label="Saved company receivables">
          <p className="of-eyebrow">QUICKBOOKS · SAVED A/R REPORT</p>
          <h3>Company receivables as of {mdUkDay(saved.arAsOf)}</h3>
          <strong className="md-money-receivables-total">{mdMoneyAmount(saved.receivables.total, saved.currency)}</strong>
          <p>This is the net total on the verified company report, including credits. It is neither a live balance nor a list of invoices to chase.</p>
          {agedBucket === "credit" && <p><strong>91 days and over:</strong> {mdMoneyAmount(saved.receivables.days91Plus, saved.currency)} net credit. Do not treat this age group as overdue debt.</p>}
          <details className="md-money-age-breakdown"><summary>See report age groups</summary>
            {agedBucket === "positive" && <p>A positive 91-day bucket is a review cue, not a confirmed collectible invoice or approval to chase.</p>}
            <dl>
              <div><dt>Current</dt><dd>{mdMoneyAmount(saved.receivables.current, saved.currency)}</dd></div>
              <div><dt>1–30 days</dt><dd>{mdMoneyAmount(saved.receivables.days1To30, saved.currency)}</dd></div>
              <div><dt>31–60 days</dt><dd>{mdMoneyAmount(saved.receivables.days31To60, saved.currency)}</dd></div>
              <div><dt>61–90 days</dt><dd>{mdMoneyAmount(saved.receivables.days61To90, saved.currency)}</dd></div>
              <div><dt>91 days and over</dt><dd>{mdMoneyAmount(saved.receivables.days91Plus, saved.currency)}{agedBucket === "credit" ? " net credit" : ""}</dd></div>
            </dl>
          </details>
        </section>
      </>}
    </div>
    <div className="md-money-next">
      <h3>What the accounts cannot answer yet</h3>
      <ul>
        <li><strong>Completed work not invoiced:</strong> needs verified Commusoft completion and exact QuickBooks job-to-invoice links.</li>
        <li><strong>FY27 target:</strong> needs Finance's current net-profit target and timing. The older £144k snapshot is not a current target.</li>
        <li><strong>Further Works and recurring revenue:</strong> need classified quotes and verified contract values and terms.</li>
      </ul>
    </div>
  </section>;
}
