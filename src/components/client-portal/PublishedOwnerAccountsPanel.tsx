import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";
import { financeAmount } from "@/lib/learn-quickbooks-finance";
import {
  canReadPublishedOwnerAccounts,
  ownerReportCoverage,
  requestPublishedOwnerAccounts,
  type OwnerAccountsGate,
  type PublishedOwnerAccounts,
} from "@/lib/new-dawn-owner-accounts-report";

/** Separate client-owner read; OpenFolk uses its own audited operator preview. */
export function PublishedOwnerAccountsPanel({
  tenant,
  operator,
}: {
  tenant: string;
  operator: boolean;
}) {
  const { user, profile } = useAuth();
  const eligible = !operator && !!user && profile?.tenant_id === tenant && profile.role === "owner";
  const platform = useQuery({
    queryKey: ["new-dawn-owner-accounts-platform-authority", user?.id],
    enabled: eligible,
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().rpc("current_user_is_openfolk_operator", {
        required_permission: "platform.controlplane.view",
      });
      if (error || typeof data !== "boolean") throw Error("Operator authority unavailable");
      return data;
    },
    staleTime: 0,
  });
  const flag = useQuery({
    queryKey: ["new-dawn-owner-accounts-report-flag", user?.id, tenant],
    enabled: eligible && platform.data === false,
    queryFn: async () => {
      const { data, error } = await getSupabaseClient()
        .from("feature_flags")
        .select("value")
        .eq("tenant_id", tenant)
        .eq("flag", "new_dawn.owner_accounts_report")
        .maybeSingle();
      if (error) throw Error("Owner accounts flag unavailable");
      return data?.value === true;
    },
    staleTime: 30_000,
  });
  const gate: OwnerAccountsGate = {
    tenant,
    userId: user?.id ?? null,
    profileTenant: profile?.tenant_id ?? null,
    role: profile?.role ?? null,
    operator,
    platformAuthorityCleared: platform.data === false,
    flagEnabled: flag.data === true,
  };
  const allowed = canReadPublishedOwnerAccounts(gate);
  const scope = `${tenant}|${user?.id ?? ""}|${profile?.tenant_id ?? ""}|${profile?.role ?? ""}|${operator}|${platform.data}|${flag.data}`;
  const [saved, setSaved] = useState<{
    scope: string;
    report: PublishedOwnerAccounts;
    coverage: ReturnType<typeof ownerReportCoverage>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setSaved(null);
    setBusy(false);
    setNotice("");
  }, [tenant, user?.id, profile?.tenant_id, profile?.role, operator, platform.data, flag.data]);
  if (!allowed) return null;
  const active = saved?.scope === scope ? saved : null;
  const report = active?.report;
  const coverage = active?.coverage;
  async function openReport() {
    if (!allowed || busy) return;
    const ticket = ++generation.current;
    setBusy(true);
    setSaved(null);
    setNotice("");
    try {
      const report = await requestPublishedOwnerAccounts(gate, async (p_tenant) => {
        const { data, error } = await getSupabaseClient()
          .rpc("learn_quickbooks_owner_accounts_report", { p_tenant })
          .abortSignal(AbortSignal.timeout(20_000));
        if (error) throw Error("Owner accounts read unavailable");
        return data;
      });
      const coverage = ownerReportCoverage(report, new Date().toISOString().slice(0, 10));
      if (ticket === generation.current) setSaved({ scope, report, coverage });
    } catch {
      if (ticket === generation.current)
        setNotice(
          "A reviewed accounts snapshot is not available. Ask OpenFolk to check the report and your access.",
        );
    } finally {
      if (ticket === generation.current) setBusy(false);
    }
  }
  return (
    <section className="nd-money-panel" aria-label="Published company accounts">
      <div className="nd-money-heading">
        <div>
          <p className="of-eyebrow">COMPANY ACCOUNTS · OWNER ONLY</p>
          <h2>Accounts snapshot</h2>
          <p>A dated QuickBooks report, available only after review. It is not live job profit.</p>
        </div>
        <button className="cp-secondary" disabled={busy} onClick={() => void openReport()}>
          {busy
            ? "Opening reviewed report…"
            : report
              ? "Refresh reviewed report"
              : "Open reviewed report"}
        </button>
      </div>
      {notice && <p role="status">{notice}</p>}
      {report && (
        <div className="space-y-3" role="status">
          <p className="nd-money-scope">
            QuickBooks Online · company accounts · profit and loss period {report.periodStart} to{" "}
            {report.periodEnd} · {report.accountingMethod} basis · receivables report as of{" "}
            {report.arAsOf}. Saved report, review {report.revision}.
          </p>
          {coverage && (
            <p className="nd-money-scope">
              <strong>
                {coverage.state === "historical_period" ? "Past period" : "This month"}.
              </strong>{" "}
              {coverage.message} This is report coverage, not a live QuickBooks check.
            </p>
          )}
          <dl className="nd-money-values">
            <div>
              <dt>Accounts gross profit</dt>
              <dd>
                <strong>{financeAmount(report.accountsGrossProfit, report.currency)}</strong>
              </dd>
            </div>
            <div>
              <dt>Net profit · owner only</dt>
              <dd>
                <strong>{financeAmount(report.netProfit, report.currency)}</strong>
              </dd>
            </div>
          </dl>
          <section className="nd-money-attention" aria-label="Saved receivables ageing">
            <h3>Receivables on the saved report</h3>
            <p>
              QuickBooks Online · as of {report.arAsOf}. This is a dated company report, not a live
              balance or a list of invoices to chase.
            </p>
            <dl className="nd-money-values">
              <div>
                <dt>Total on this report</dt>
                <dd>
                  <strong>{financeAmount(report.receivables.total, report.currency)}</strong>
                </dd>
              </div>
            </dl>
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer">See the five ageing groups</summary>
              <dl className="mt-2 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2">
                <dt>Current</dt>
                <dd className="min-w-0 break-all text-right">
                  {financeAmount(report.receivables.current, report.currency)}
                </dd>
                <dt>1–30 days</dt>
                <dd className="min-w-0 break-all text-right">
                  {financeAmount(report.receivables.days1To30, report.currency)}
                </dd>
                <dt>31–60 days</dt>
                <dd className="min-w-0 break-all text-right">
                  {financeAmount(report.receivables.days31To60, report.currency)}
                </dd>
                <dt>61–90 days</dt>
                <dd className="min-w-0 break-all text-right">
                  {financeAmount(report.receivables.days61To90, report.currency)}
                </dd>
                <dt>91 days and over</dt>
                <dd className="min-w-0 break-all text-right">
                  {financeAmount(report.receivables.days91Plus, report.currency)}
                </dd>
              </dl>
            </details>
          </section>
          <p className="nd-money-scope">
            Field gross profit is held until job costs and links are verified. Annual recurring
            revenue is held until recurring contracts and periods are verified.
          </p>
        </div>
      )}
    </section>
  );
}
