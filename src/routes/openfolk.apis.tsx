import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { OperatorShell } from "@/components/app/OperatorShell";
import { useAuth } from "@/lib/auth";
import { listTenantDirectory } from "@/lib/openfolk";
import { useReceptionistCalls } from "@/lib/use-receptionist-calls";
import { usageRows, providerUsageSearch, type UsagePeriod } from "@/lib/provider-usage";
import { findOperatorTenant } from "@/lib/operator-workspace";
import { sectionSearchValue } from "@/lib/openfolk-workspace-nav";
import "@/styles/provider-usage.css";

export const Route = createFileRoute("/openfolk/apis")({
  validateSearch: providerUsageSearch,
  component: ProviderCosts,
});
function ProviderCosts() {
  const { user } = useAuth();
  const { tenant: selected } = Route.useSearch();
  const navigate = Route.useNavigate();
  const directory = useQuery({
    queryKey: ["operator-directory", user?.id],
    queryFn: async () => {
      const result = await listTenantDirectory();
      if (!result.ok) throw Error("OpenFolk operator access is required to view provider usage.");
      return result.data.tenants;
    },
  });
  const tenant =
    directory.isSuccess && !directory.isError
      ? selected
        ? findOperatorTenant(directory.data, selected)
        : directory.data[0]
      : undefined;
  return (
    <OperatorShell
      pageTitle="APIs"
      tenantId={tenant?.tenant_id}
      company={tenant ? (tenant.display_name ?? tenant.slug ?? "Client workspace") : undefined}
      onModule={(module) => {
        if (tenant)
          void navigate({
            to: "/openfolk/$tenantId",
            params: { tenantId: tenant.slug ?? tenant.tenant_id },
            search: { module, tools: false },
          });
      }}
      onSection={(section) => {
        if (tenant)
          void navigate({
            to: "/openfolk/$tenantId",
            params: { tenantId: tenant.slug ?? tenant.tenant_id },
            search: { section: sectionSearchValue(section), tools: true },
          });
      }}
    >
      <div className="op-heading">
        <p className="op-eyebrow">APIs · ACCOUNTS & COSTS</p>
        <h1>Your services. Your costs.</h1>
        <p>Review call usage here. Manage credit and top-ups securely with the provider.</p>
      </div>
      {directory.isPending && <p role="status">Checking operator access…</p>}
      {directory.isError && (
        <div className="op-error" role="alert">
          {directory.error.message} <button onClick={() => void directory.refetch()}>Retry</button>
        </div>
      )}
      {directory.isSuccess && !directory.isError && (
        <>
          <div className="op-module-grid">
            <section className="op-card">
              <h2>Vapi</h2>
              <p>Credit balance, payment method and automatic top-ups.</p>
              <a
                className="op-button"
                href="https://dashboard.vapi.ai/settings/billing"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open Vapi billing ↗
              </a>
              <p className="op-note">
                The provider holds the current balance. This page does not change billing settings.
              </p>
            </section>
            <section className="op-card">
              <h2>OpenFolk AI</h2>
              <p>Review the AI billing account and its usage separately.</p>
              <a
                className="op-button"
                href="https://platform.openai.com/settings/organization/billing/overview"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open AI billing ↗
              </a>
              <p className="op-note">
                Select the intended organisation. AI-account costs are not included in the call
                figures below.
              </p>
            </section>
          </div>
          <section className="op-card api-usage">
            <label htmlFor="usage-client">Client</label>
            <select
              id="usage-client"
              value={tenant?.tenant_id ?? ""}
              onChange={(e) => void navigate({ search: { tenant: e.target.value } })}
            >
              {!tenant && (
                <option value="">
                  {directory.data.length ? "Choose an accessible client" : "No clients available"}
                </option>
              )}
              {directory.data.map((t) => (
                <option key={t.tenant_id} value={t.tenant_id}>
                  {t.display_name ?? t.slug ?? "Client"}
                </option>
              ))}
            </select>
            {selected && !tenant && (
              <p role="status">
                This client is not in your accessible directory. Choose a client above.
              </p>
            )}
            {tenant && (
              <CallUsage key={tenant.tenant_id} tenant={tenant.tenant_id} userId={user?.id} />
            )}
          </section>
          <p className="op-note">
            Live credit monitoring and automatic cost alerts are awaiting connection. Keep provider
            billing alerts enabled. Gmail and other services will appear here as they are added.
          </p>
        </>
      )}
    </OperatorShell>
  );
}
function CallUsage({ tenant, userId }: { tenant: string; userId?: string }) {
  const query = useReceptionistCalls(userId, tenant);
  const [period, setPeriod] = useState<UsagePeriod>("day");
  const result = usageRows(query.data?.pages.flatMap((p) => p.calls) ?? [], period);
  const checked = query.data?.pages[0]?.checkedAt;
  const connected = query.data?.pages.every((p) => p.connection === "connected") === true;
  return (
    <>
      <h2>Vapi call usage</h2>
      <p>
        Provider-reported call costs in USD—not your remaining credit or a billing statement.
        Limited to calls returned for this client’s configured assistant; separate practice
        assistants, other assistants and fixed fees may be excluded.
      </p>
      <label htmlFor="usage-period">Group by</label>
      <select
        id="usage-period"
        value={period}
        onChange={(e) => setPeriod(e.target.value as UsagePeriod)}
      >
        <option value="day">Day</option>
        <option value="week">Week</option>
        <option value="month">Month</option>
      </select>
      {query.isPending && <p role="status">Loading call usage…</p>}
      {query.isError ? (
        <div className="op-error" role="alert">
          Usage could not be checked. <button onClick={() => void query.refetch()}>Retry</button>
        </div>
      ) : query.isSuccess && !connected ? (
        <p role="status">Awaiting the call-data connection. No usage total is available.</p>
      ) : (
        query.isSuccess && (
          <>
            <p className="op-note">
              {query.hasNextPage
                ? "Partial history — older calls are not included yet."
                : "All returned pages loaded for this assistant. This is not account-wide billing coverage."}{" "}
              Dates are UTC; weeks start Monday.
              {checked ? ` Last checked ${new Date(checked).toLocaleString("en-GB")}.` : ""}
            </p>
            {result.undated > 0 && (
              <p role="status">
                {result.undated} call(s) have no usable date and are excluded from the grouped
                figures.
              </p>
            )}
            <div className="api-table-scroll">
              <table>
                <caption>Loaded call usage by {period}</caption>
                <thead>
                  <tr>
                    <th scope="col">Period starting</th>
                    <th scope="col">Calls</th>
                    <th scope="col">Minutes</th>
                    <th scope="col">Reported cost (USD)</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.date}>
                      <th scope="row">{r.date}</th>
                      <td>{r.calls}</td>
                      <td>
                        {r.timed ? (r.seconds / 60).toFixed(1) : "Awaiting data"}
                        {r.timed < r.calls && (
                          <small>
                            {r.timed}/{r.calls} durations available
                          </small>
                        )}
                      </td>
                      <td>
                        {r.priced
                          ? new Intl.NumberFormat("en-GB", {
                              style: "currency",
                              currency: "USD",
                              minimumFractionDigits: 4,
                            }).format(r.cost)
                          : "Awaiting data"}
                        {r.priced < r.calls && (
                          <small>
                            {r.priced}/{r.calls} costs available — partial
                          </small>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!result.rows.length && <p>No dated calls returned for this assistant.</p>}
            {query.hasNextPage && (
              <button
                className="op-button"
                disabled={query.isFetching}
                onClick={() => void query.fetchNextPage()}
              >
                {query.isFetching ? "Loading…" : "Load older calls"}
              </button>
            )}
          </>
        )
      )}
    </>
  );
}
