import { useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { OperatorShell } from "@/components/app/OperatorShell";
import { getSupabaseClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { listTenantDirectory } from "@/lib/openfolk";
import { costHealth, costMoney, type CostAccount } from "@/lib/operating-costs";
import "@/styles/operating-costs.css";

export const Route = createFileRoute("/openfolk/apis")({ component: CostsPage });
const providerLinks: Record<string, string> = {
  vapi: "https://dashboard.vapi.ai",
  openai: "https://platform.openai.com/settings/organization/billing/overview",
  supabase: "https://supabase.com/dashboard",
  vercel: "https://vercel.com/dashboard",
};
async function rpc(name: string, args?: Record<string, unknown>) {
  const { data, error } = await getSupabaseClient().rpc(name, args);
  if (error)
    throw Error(
      error.code === "40001"
        ? "This account changed. Refresh before saving."
        : "Could not complete this request. Check operator access and the entered figures.",
    );
  return data;
}
function CostsPage() {
  const { user } = useAuth();
  const cache = useQueryClient();
  const key = ["operating-costs", user?.id];
  const query = useQuery({
    queryKey: key,
    queryFn: () => rpc("costs_overview"),
    refetchInterval: 60000,
  });
  const [adding, setAdding] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  const accounts: CostAccount[] = query.data?.accounts ?? [];
  const updated = async () => {
    await cache.invalidateQueries({ queryKey: key });
    setAdding(false);
    setChecking(null);
  };
  const attention = accounts.filter((a) => costHealth(a).tone === "urgent").length;
  const unchecked = accounts.filter((a) => costHealth(a).tone === "waiting").length;
  return (
    <OperatorShell pageTitle="APIs">
      <div className="op-heading">
        <p className="op-eyebrow">APIs · ACCOUNTS & COSTS</p>
        <h1>Keep Emma connected and funded.</h1>
        <p>
          Vapi powers the calls. The AI account powers the analysis. Manage both here, privately
          within OpenFolk.
        </p>
      </div>
      <div className="cost-notice">
        <strong>Automatic monitoring is awaiting setup.</strong>
        <p>
          Figures below are recorded checks, not live balances. No automatic top-ups or Slack cost
          alerts are enabled here. Keep provider billing alerts active until the complete monitoring
          route is verified.
        </p>
      </div>
      {query.isPending && <p role="status">Opening costs…</p>}
      {query.isError && (
        <div className="op-error" role="alert">
          Costs could not be loaded. No funding status can be confirmed.{" "}
          <button onClick={() => void query.refetch()}>Retry</button>
        </div>
      )}
      {query.isSuccess && (
        <>
          <div className="op-metrics">
            <div className="op-metric">
              <strong>{accounts.length}</strong>
              <span>Provider accounts tracked</span>
            </div>
            <div className="op-metric">
              <strong>{attention}</strong>
              <span>Funding issues at last check</span>
            </div>
            <div className="op-metric">
              <strong>{unchecked}</strong>
              <span>Checks needed</span>
            </div>
          </div>
          <div className="cost-toolbar">
            <h2>AI receptionist</h2>
            <button className="cost-button" onClick={() => setAdding(!adding)}>
              {adding ? "Close setup" : "Set up an account"}
            </button>
          </div>
          {adding && <AccountForm onDone={updated} />}
          <section className="op-card cost-setup" aria-label="API account setup">
            <h2>Account setup</h2>
            <p>
              Start with Vapi and OpenFolk’s AI billing account. Gmail and other connections can
              join this section as those modules are released.
            </p>
            <div className="cost-fields">
              {[
                { key: "vapi", name: "Vapi", purpose: "Calls, voice and provider-billed usage" },
                { key: "openai", name: "OpenFolk AI", purpose: "Call review and analysis" },
              ].map((p) => (
                <div key={p.key}>
                  <strong>{p.name}</strong>
                  <p>{p.purpose}</p>
                  <small>
                    {accounts.some((a) => a.provider === p.key)
                      ? "Billing account recorded · live verification pending"
                      : "Awaiting account setup"}
                  </small>
                </div>
              ))}
            </div>
            <p>
              <a
                href="https://app.slack.com/client/T0BLG3N4KN1/C0C513YT52N"
                target="_blank"
                rel="noopener noreferrer"
              >
                OpenFolk #apis ↗
              </a>{" "}
              · Private channel created. Automatic app delivery awaits verification.
            </p>
            <p className="op-note">
              Cards and automatic top-ups stay with the provider. Recording settings here does not
              activate them or authorise charges.
            </p>
          </section>
          <div className="cost-grid">
            {accounts.map((a) => {
              const health = costHealth(a);
              const s = a.latest;
              return (
                <article key={a.id} className="op-card cost-card">
                  <header>
                    <div>
                      <p className="op-eyebrow">
                        {a.provider} · {a.currency}
                      </p>
                      <h2>{a.name}</h2>
                    </div>
                    <span className={`op-status op-status-${health.tone}`}>{health.label}</span>
                  </header>
                  <p>
                    {a.clients.length
                      ? a.clients.map((c) => c.name).join(" · ")
                      : "OpenFolk shared overhead — no client allocation recorded"}
                  </p>
                  <dl>
                    <div>
                      <dt>
                        {a.billing_mode === "prepaid"
                          ? "Remaining credit"
                          : "Recorded account balance"}
                      </dt>
                      <dd>{costMoney(s?.balance ?? null, a.currency)}</dd>
                    </div>
                    <div>
                      <dt>Recorded period spend</dt>
                      <dd>{costMoney(s?.period_spend ?? null, a.currency)}</dd>
                      {s?.period_start && (
                        <small>
                          {s.period_start} to {s.period_end}
                        </small>
                      )}
                    </div>
                  </dl>
                  <p>
                    <strong>{health.action}</strong>
                  </p>
                  <p className="op-note">
                    {s
                      ? `Manually checked ${new Date(s.observed_at).toLocaleString("en-GB")} · ${s.source}`
                      : "No billing check recorded."}
                  </p>
                  <p className="op-note">
                    Auto-reload: {s?.auto_reload ?? "unknown"} · Payment:{" "}
                    {s?.payment_status ?? "unknown"}
                    {a.billing_mode === "prepaid"
                      ? ` · Low-credit threshold: ${costMoney(a.low_balance, a.currency)}`
                      : ""}
                  </p>
                  {s && (
                    <details>
                      <summary>Check evidence</summary>
                      <p>{s.evidence}</p>
                    </details>
                  )}
                  <footer>
                    <button
                      className="cost-button"
                      onClick={() => setChecking(checking === a.id ? null : a.id)}
                    >
                      {checking === a.id ? "Close check" : "Record billing check"}
                    </button>
                    {providerLinks[a.provider] && (
                      <a href={providerLinks[a.provider]} target="_blank" rel="noopener noreferrer">
                        Provider billing ↗
                      </a>
                    )}
                  </footer>
                  {checking === a.id && <CheckForm account={a} onDone={updated} />}
                </article>
              );
            })}
          </div>
          <p className="op-note">
            Spend periods and currencies are kept separate. Call estimates are not a provider
            invoice or remaining credit. Provider-billed AI or telephone charges must not be counted
            again as Vapi charges.
          </p>
        </>
      )}
    </OperatorShell>
  );
}

function AccountForm({ onDone }: { onDone: () => Promise<void> }) {
  const { user } = useAuth();
  const clients = useQuery({
    queryKey: ["operator-directory", user?.id],
    queryFn: async () => {
      const r = await listTenantDirectory();
      if (!r.ok) throw Error("Could not load clients");
      return r.data.tenants;
    },
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await rpc("costs_add_account", {
        p_provider: f.get("provider"),
        p_ref: f.get("reference"),
        p_name: f.get("name"),
        p_currency: f.get("currency"),
        p_mode: f.get("mode"),
        p_threshold: Number(f.get("threshold")),
        p_clients: f.getAll("clients"),
      });
      await onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="op-card cost-form" onSubmit={save}>
      <h2>Add a provider account</h2>
      <p>Use the billing account’s name or ID, never an API key, payment card or password.</p>
      <div className="cost-fields">
        <label>
          Service
          <select name="provider">
            <option value="vapi">Vapi</option>
            <option value="openai">OpenAI</option>
          </select>
        </label>
        <label>
          Account name
          <input name="name" required maxLength={100} placeholder="OpenFolk — Vapi" />
        </label>
        <label>
          Provider account reference
          <input name="reference" required maxLength={160} />
        </label>
        <label>
          Billing currency
          <select name="currency">
            <option>USD</option>
            <option>GBP</option>
            <option>EUR</option>
          </select>
        </label>
        <label>
          Billing type
          <select name="mode">
            <option value="prepaid">Prepaid credit</option>
            <option value="invoiced">Invoiced usage</option>
          </select>
        </label>
        <label>
          Low-credit warning threshold
          <input name="threshold" type="number" min="0" max="1000000000" step="0.01" required />
        </label>
      </div>
      <fieldset>
        <legend>Clients supported (leave empty for shared overhead)</legend>
        {clients.isPending ? (
          <p>Loading clients…</p>
        ) : clients.isError ? (
          <p role="alert">Client list unavailable. Retry before assigning this account.</p>
        ) : (
          clients.data?.map((c) => (
            <label className="cost-check" key={c.tenant_id}>
              <input type="checkbox" name="clients" value={c.tenant_id} />
              {c.display_name ?? c.slug ?? c.tenant_id}
            </label>
          ))
        )}
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <button className="cost-button" disabled={busy}>
        {busy ? "Saving…" : "Save account"}
      </button>
      <p className="op-note">
        This records the account only. It does not connect a provider or authorise spending.
      </p>
    </form>
  );
}
function CheckForm({ account, onDone }: { account: CostAccount; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [checkedAt] = useState(() => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const number = (key: string) => (f.get(key) === "" ? null : Number(f.get(key)));
    setBusy(true);
    setError("");
    try {
      await rpc("costs_record_check", {
        p_account: account.id,
        p_version: account.version,
        p_observed: new Date(String(f.get("observed"))).toISOString(),
        p_balance: number("balance"),
        p_spend: number("spend"),
        p_start: f.get("start") || null,
        p_end: f.get("end") || null,
        p_reload: f.get("reload"),
        p_payment: f.get("payment"),
        p_source: f.get("source"),
        p_evidence: f.get("evidence"),
      });
      await onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="cost-form" onSubmit={save}>
      <h3>Record what the provider shows</h3>
      <p>Amounts in {account.currency}. Leave unavailable figures blank, not zero.</p>
      <div className="cost-fields">
        <label>
          Checked at (your local time)
          <input type="datetime-local" name="observed" defaultValue={checkedAt} required />
        </label>
        <label>
          Credit / balance
          <input type="number" name="balance" step="0.000001" min="-1000000000" max="1000000000" />
        </label>
        <label>
          Period spend
          <input type="number" name="spend" step="0.000001" min="0" max="1000000000" />
        </label>
        <label>
          Spend period start
          <input type="date" name="start" />
        </label>
        <label>
          Spend period end
          <input type="date" name="end" />
        </label>
        <label>
          Auto-reload
          <select name="reload">
            <option value="unknown">Not checked</option>
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </label>
        <label>
          Payment status
          <select name="payment">
            <option value="unknown">Not checked</option>
            <option value="okay">No payment issue shown</option>
            <option value="failed">Payment failed</option>
          </select>
        </label>
        <label>
          Source
          <select name="source">
            <option value="dashboard">Provider dashboard</option>
            <option value="invoice">Provider invoice</option>
          </select>
        </label>
      </div>
      <label>
        Evidence / invoice reference
        <textarea
          name="evidence"
          required
          maxLength={500}
          placeholder="Where were these figures checked? No payment details or secrets."
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button className="cost-button" disabled={busy}>
        {busy ? "Saving…" : "Save billing check"}
      </button>
      <p className="op-note">This does not change provider billing settings or make a payment.</p>
    </form>
  );
}
