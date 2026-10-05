import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueries } from "@tanstack/react-query";
import { BellRing, ChevronRight } from "lucide-react";
import { listTenantDirectory } from "@/lib/openfolk";
import { useAuth } from "@/lib/auth";
import { OperatorShell } from "@/components/app/OperatorShell";
import { loadOperatorHealth } from "@/components/app/useOperatorHealth";
import { healthSignal } from "@/lib/operator-workspace";
import { BuildInvestment } from "@/components/app/BuildInvestment";

export const Route = createFileRoute("/openfolk/")({ component: OpenfolkList });
function OpenfolkList() {
  const { user } = useAuth();
  const directory = useQuery({
    queryKey: ["operator-directory", user?.id],
    queryFn: async () => {
      const result = await listTenantDirectory();
      if (!result.ok)
        throw Error(
          "The client directory could not be opened. OpenFolk operator access is required.",
        );
      return result.data.tenants;
    },
  });
  const tenants = directory.data ?? [];
  const health = useQueries({
    queries: tenants.map((tenant) => ({
      queryKey: ["operator-module-health", user?.id, tenant.tenant_id],
      queryFn: () => loadOperatorHealth(tenant.tenant_id),
      refetchInterval: 60000,
    })),
  });
  const complete =
    !directory.isPending && !directory.isError && health.every((q) => q.isSuccess && !q.isError);
  const urgent = health.reduce(
    (sum, q) => sum + (q.data?.urgent ?? 0) + (q.data?.failed ?? 0) + (q.data?.overdue ?? 0),
    0,
  );
  const reviews = health.reduce((sum, q) => sum + (q.data?.open ?? 0), 0);
  return (
    <OperatorShell>
      <div className="op-heading">
        <p className="op-eyebrow">YOUR CLIENTS, WORKING BETTER</p>
        <h1>A clear view. The right next step.</h1>
        <p>Every client. Every released module. Start with what needs you.</p>
      </div>
      <div className="op-metrics">
        <div className="op-metric">
          <strong>{directory.isSuccess ? tenants.length : "—"}</strong>
          <span>Client workspaces</span>
        </div>
        <div className="op-metric">
          <strong>{complete ? urgent : "—"}</strong>
          <span>Urgent reports & delivery issues</span>
        </div>
        <div className="op-metric">
          <strong>{complete ? reviews : "—"}</strong>
          <span>Open feedback reports</span>
        </div>
      </div>
      {directory.isPending && <p role="status">Opening your clients…</p>}
      {directory.isError && (
        <div className="op-error" role="alert">
          {directory.error.message} <button onClick={() => void directory.refetch()}>Retry</button>
        </div>
      )}
      <div className="op-client-grid">
        {tenants.map((tenant, index) => {
          const query = health[index];
          const data = query.isError ? undefined : query.data;
          const signal = healthSignal(data);
          return (
            <Link
              key={tenant.tenant_id}
              to="/openfolk/$tenantId"
              params={{ tenantId: tenant.slug ?? tenant.tenant_id }}
              className="op-card op-client-card"
            >
              <div className="op-client-top">
                <span className="op-avatar">
                  {(tenant.display_name ?? tenant.slug ?? "C").slice(0, 1)}
                </span>
                <span className={`op-status op-status-${signal.tone}`}>
                  {signal.tone === "urgent" && <BellRing size={15} />}{" "}
                  {query.isError ? "Health check unavailable" : signal.label}
                </span>
              </div>
              <h2>{tenant.display_name ?? tenant.slug ?? "Client workspace"}</h2>
              <p>
                {data?.receptionist
                  ? `${data.receptionist.name} · AI receptionist`
                  : "Modules & delivery"}
              </p>
              <p>
                {data
                  ? `${data.open} open reports · ${data.urgent} urgent · ${data.failed + data.overdue} notification issues`
                  : "Open the workspace to check its modules."}
              </p>
              <footer>
                Open workspace <ChevronRight size={18} />
              </footer>
            </Link>
          );
        })}
      </div>
      {directory.isSuccess && tenants.length === 0 && (
        <div className="op-card">
          Your first client will appear here when their workspace is added.
        </div>
      )}
      <BuildInvestment />
      <p className="op-note">
        Health reflects saved feedback and notification delivery, refreshed every minute. “No
        reported issues” is not a live phone-line test. Urgent reports are included in open
        feedback.
      </p>
    </OperatorShell>
  );
}
