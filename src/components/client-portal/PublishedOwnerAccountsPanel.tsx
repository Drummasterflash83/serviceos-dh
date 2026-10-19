import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";
import { financeAmount } from "@/lib/learn-quickbooks-finance";
import {
  canReadPublishedOwnerAccounts,
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
  const [saved, setSaved] = useState<{ scope: string; report: PublishedOwnerAccounts } | null>(
    null,
  );
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
  const report = saved?.scope === scope ? saved.report : null;
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
      if (ticket === generation.current) setSaved({ scope, report });
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
            QuickBooks Online · company accounts · P&amp;L {report.periodStart} to{" "}
            {report.periodEnd} · {report.accountingMethod} basis · A/R as of {report.arAsOf}. Saved
            report, review {report.revision}; not today’s result.
          </p>
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
          <p className="nd-money-scope">
            Field gross profit is held until job costs and links are verified. ARR is held until
            recurring contracts and periods are verified.
          </p>
        </div>
      )}
    </section>
  );
}
