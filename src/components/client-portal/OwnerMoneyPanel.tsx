import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";
import { financeAmount } from "@/lib/learn-quickbooks-finance";
import { readOwnerMoney, type OwnerMoney } from "@/lib/learn-owner-money";

const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const checked = (value: string | null) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString("en-GB")
    : "not recorded";

/** Flagged company-owner view; OpenFolk operators must make a fresh logged read. */
export function OwnerMoneyPanel({ tenant, operator, operatorReason }: {
  tenant: string;
  operator: boolean;
  operatorReason: string;
}) {
  const { user, profile } = useAuth();
  const owner = !operator && profile?.tenant_id === tenant &&
    ["owner", "admin"].includes(profile.role ?? "");
  const flag = useQuery({
    queryKey: ["new-dawn-owner-money-flag", user?.id, tenant],
    enabled: !!user && uuid(tenant),
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().from("feature_flags")
        .select("value").eq("tenant_id", tenant)
        .eq("flag", "new_dawn.owner_money").maybeSingle();
      if (error) throw Error("Owner money flag unavailable.");
      return data?.value === true;
    },
    staleTime: 30_000,
  });
  const [operatorResult, setOperatorResult] = useState<OwnerMoney | null>(null);
  const [operatorError, setOperatorError] = useState(false);
  const [operatorBusy, setOperatorBusy] = useState(false);
  const client = useQuery({
    queryKey: ["new-dawn-owner-money", user?.id, tenant],
    enabled: flag.data === true && !!user && owner,
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().rpc("learn_quickbooks_owner_money", {
        p_tenant: tenant, p_environment: "production", p_operator_reason: null,
      }).abortSignal(AbortSignal.timeout(20_000));
      if (error) throw Error("Saved QuickBooks money is unavailable.");
      return readOwnerMoney(data, { tenant, actor: user!.id, environment: "production" });
    },
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  async function readOperatorMoney() {
    const reason = operatorReason.trim();
    if (!operator || !user || reason.length < 3 || operatorBusy) return;
    setOperatorBusy(true);
    setOperatorError(false);
    setOperatorResult(null);
    try {
      const { data, error } = await getSupabaseClient().rpc("learn_quickbooks_owner_money", {
        p_tenant: tenant, p_environment: "production", p_operator_reason: reason,
      }).abortSignal(AbortSignal.timeout(20_000));
      if (error) throw Error("Audited money read unavailable.");
      setOperatorResult(readOwnerMoney(data, {
        tenant, actor: user.id, environment: "production", operatorReason: reason,
      }));
    } catch {
      setOperatorError(true);
    } finally {
      setOperatorBusy(false);
    }
  }
  if (flag.data !== true || (!operator && !owner)) return null;
  const money = operator ? operatorResult : client.data;
  return (
    <section className="nd-money-panel" aria-label="Saved QuickBooks invoice money">
      <div className="nd-money-heading">
        <div>
          <p className="of-eyebrow">MONEY EVIDENCE</p>
          <h2>What the saved invoices say.</h2>
          <p>QuickBooks invoice balances, with source gaps in view. This is not a reconciled accounts receivable or profit report.</p>
        </div>
        {!operator && <button className="cp-secondary" disabled={client.isFetching}
          onClick={() => void client.refetch()}><RefreshCw size={15} /> Refresh evidence</button>}
      </div>
      {operator && <div className="nd-money-operator">
        <p>OpenFolk preview. Use the access reason above for a separate audited money read.</p>
        <button className="cp-secondary" disabled={operatorBusy || operatorReason.trim().length < 3}
          onClick={() => void readOperatorMoney()}>
          {operatorBusy ? "Checking access…" : "Open audited money preview"}
        </button>
      </div>}
      {!operator && client.isPending && <p role="status">Reading saved invoice evidence…</p>}
      {((!operator && client.isError) || operatorError) &&
        <p role="alert">Saved invoice evidence is unavailable. Check access or try again.</p>}
      {money && <>
        <p className="nd-money-scope">QuickBooks Online · retained production invoices · aged at {money.as_of} UTC · read {checked(money.read_at)}. {money.records.toLocaleString()} saved invoices; {money.conflicted_records} conflicted record{money.conflicted_records === 1 ? "" : "s"} excluded.</p>
        {money.groups.length === 0 && <p>No retained QuickBooks invoices are available for this company.</p>}
        <div className="nd-money-groups">
          {money.groups.slice(0, 4).map((group) => <article key={`${group.realm_id}:${group.currency ?? "unknown"}`} className="nd-money-group">
            <p className="nd-money-source">{group.currency ?? "Currency unverified"} · QuickBooks company {group.realm_id} · {group.records.toLocaleString()} captured invoices</p>
            <div className="nd-money-values">
              <div><span>Balance on captured invoices</span><strong>{financeAmount(group.outstanding, group.currency)}</strong></div>
              <div><span>Overdue by captured due dates</span><strong>{financeAmount(group.overdue, group.currency)}</strong></div>
            </div>
            <small>Latest captured {checked(group.newest_observed_at)}. {group.missing_balances || group.undated_positive
              ? `${group.missing_balances} missing balance · ${group.undated_positive} positive balances without a valid due date. Totals are held where evidence is incomplete.`
              : "Ageing uses saved invoice due dates, not a QuickBooks A/R report."}</small>
          </article>)}
        </div>
        {money.groups.length > 4 && <p className="nd-money-scope">{money.groups.length - 4} additional realm/currency groups are not shown in this compact view.</p>}
        <div className="nd-money-attention">
          <h3>Oldest overdue invoices in the saved records</h3>
          <p>{money.overdue_invoice_count.toLocaleString()} saved invoices have a positive balance past their captured due date. The first five are shown here; no chase is sent.</p>
          {money.attention.slice(0, 5).map((row) => <article key={row.source_version_id}>
            <span><strong>{row.document_number ? `Invoice ${row.document_number}` : `QuickBooks invoice ${row.invoice_id}`}</strong><small>Due {row.due_date} · captured {checked(row.last_observed_at)}</small></span>
            <b>{financeAmount(row.balance, row.currency)}</b>
            <details><summary>Source reference</summary><code>QuickBooks {row.realm_id} / {row.invoice_id} · version {row.source_version_id}</code></details>
          </article>)}
          {money.overdue_invoice_count === 0 && <p>No overdue positive balances appear in the retained invoice set.</p>}
        </div>
        <p className="nd-money-scope">Accounts gross profit, field gross profit, net profit, ARR and Further Works await their own verified sources. Invoice totals do not stand in for those measures.</p>
      </>}
    </section>
  );
}
