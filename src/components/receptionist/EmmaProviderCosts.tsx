import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import "./emma-provider-costs.css";
type Period = {
  usd: number;
  calls: number;
  costedCalls: number | null;
  minutes: number | null;
  pending: number | null;
};
type Costs = { currency: "USD"; checkedAt: string; periods: { today: Period; month: Period } };
export function EmmaProviderCosts({ tenant, userId }: { tenant: string; userId: string }) {
  const query = useQuery({
    queryKey: ["receptionist-provider-costs", userId, tenant],
    staleTime: 45000,
    refetchInterval: 60000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().functions.invoke("receptionist-calls", {
        body: { tenantId: tenant, action: "costs" },
      });
      if (error || data?.error || data?.currency !== "USD" || !data?.periods)
        throw Error("Provider costs could not be checked.");
      return data as Costs;
    },
  });
  const data = !query.isError ? query.data : null;
  const money = (v: number) =>
    new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(v);
  return (
    <section className="rw-panel emma-costs" aria-label="Emma provider costs">
      <div className="rw-panel-title">
        <div>
          <p className="rw-eyebrow">PROVIDER USAGE · USD</p>
          <h2>What Emma is costing</h2>
        </div>
        <button
          className="rw-text-btn"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw size={15} /> Refresh costs
        </button>
      </div>
      <p>
        Current Vapi-reported usage for Emma’s published assistant. Figures can settle after calls
        finish.
      </p>
      {data ? (
        <>
          <div className="emma-costs-grid">
            {(
              [
                ["today", "Today"],
                ["month", "This month"],
              ] as const
            ).map(([key, label]) => {
              const p = data.periods[key];
              return (
                <article key={key}>
                  <span>{label} · London time</span>
                  <strong>{money(p.usd)}</strong>
                  <small>
                    {p.calls.toLocaleString("en-GB")} {p.calls === 1 ? "call" : "calls"} ·{" "}
                    {p.minutes === null
                      ? "Minutes not reported"
                      : `${p.minutes.toLocaleString("en-GB", { maximumFractionDigits: 1 })} provider minutes`}
                  </small>
                  {p.pending !== null && p.pending > 0 && (
                    <small>{p.pending} calls awaiting a reported cost; total is incomplete.</small>
                  )}
                </article>
              );
            })}
          </div>
          <p className="emma-costs-note">
            Checked{" "}
            {new Date(data.checkedAt).toLocaleString("en-GB", { timeZone: "Europe/London" })} ·
            refreshes every minute while open.
          </p>
        </>
      ) : (
        <p role="status">
          {query.isPending
            ? "Checking provider costs…"
            : "Provider costs are temporarily unavailable. Refresh to try again; this is not a zero balance."}
        </p>
      )}
      <details>
        <summary>What these costs include</summary>
        <p>
          Calls attached to this published Emma assistant, including any Vapi dashboard tests.
          Separate in-app practice and LEARN recaps, other assistants, separately billed phone
          plans, taxes and OpenFolk fees are not included. Provider usage is not Drummonds’ invoice,
          and USD is shown without an estimated currency conversion.
        </p>
      </details>
    </section>
  );
}
