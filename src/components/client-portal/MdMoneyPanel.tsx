import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";
import { financeAmount } from "@/lib/learn-quickbooks-finance";
import { readFounderAccountsPairs, readFounderAccountsPreview,
  type AccountsPair, type FounderAccountsPreview } from "@/lib/new-dawn-founder-accounts-preview";
import { readAccountsMarginPreview, type AccountsMarginPreview } from "@/lib/new-dawn-accounts-margin";
import { accountsNetMargin, newestAccountsPair, netProfitYtdComparison } from "@/lib/new-dawn-md-money";
import { MdAgedInvoices } from "./MdAgedInvoices";

type Snapshot = { accounts: FounderAccountsPreview; margin: AccountsMarginPreview | null };
const dateTime = (value: string) => new Date(value).toLocaleString("en-GB", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London",
});

/** Money is only mounted inside the short-lived, audited Drummonds MD view. */
export function MdMoneyPanel({ tenant, reason }: { tenant: string; reason: string }) {
  const { user } = useAuth();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [periods, setPeriods] = useState<AccountsPair[]>([]);
  const [selectedRequest, setSelectedRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
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

  async function openSavedAccounts(requestId?: string) {
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
  }

  const saved = snapshot?.accounts;
  const ytd = saved ? netProfitYtdComparison(saved.periodStart, saved.periodEnd) : null;
  const netMargin = saved && snapshot?.margin
    ? accountsNetMargin(saved.netProfit, snapshot.margin.totalIncome) : null;
  return <section className="md-money" aria-label="Drummonds MD money">
    <p className="of-eyebrow">DRUMMONDS · MONEY</p>
    <h2>Money needing a review.</h2>
    <p>Check saved overdue invoice sources and company accounts separately. Each read is audited. Nothing here moves money or sends a chase.</p>
    <MdAgedInvoices tenant={tenant} reason={reason} />
    <div className="md-money-accounts">
      <h3>Company accounts</h3>
      <p>Open a verified saved QuickBooks period to see its figures, dates and accounting basis.</p>
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
        <div className="md-money-followup">
          <h3>Where money may be held up</h3>
          <p><strong>Aged receivables:</strong> {financeAmount(saved.receivables.days91Plus, saved.currency)} in the report's 91-day-and-over net bucket, as of {saved.arAsOf}. Credits may affect this amount. It is not an invoice-level chase list.</p>
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
        <li><strong>£144k FY27 net-profit comparison:</strong> an agreed fiscal period and a verified full-to-date P&amp;L. Saved monthly reports cannot establish it.</li>
        <li><strong>Further Works versus £58k/month:</strong> current, classified quote and delivered or invoiced work with dates.</li>
        <li><strong>ARR:</strong> current recurring contracts with value, term and changes, reconciled to Finance.</li>
      </ul>
    </div>
  </section>;
}
