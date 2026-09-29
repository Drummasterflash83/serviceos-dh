import { lazy, Suspense } from "react";
import { BellRing, Headphones, Receipt, Layers, ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/auth";
import "@/styles/client-investment.css";
import "@/styles/client-workspace.css";
import { useOperatorHealth } from "./useOperatorHealth";
import { healthSignal, type OperatorModule } from "@/lib/operator-workspace";
import type { ReceptionistView } from "@/lib/client-workspace-nav";

const ReceptionistWorkspace = lazy(() =>
  import("@/components/receptionist/ReceptionistWorkspace").then((module) => ({
    default: module.ReceptionistWorkspace,
  })),
);
const FeedbackDesk = lazy(() =>
  import("./FeedbackDesk").then((m) => ({ default: m.FeedbackDesk })),
);
const ClientPortal = lazy(() =>
  import("@/components/client-portal/ClientPortal").then((module) => ({
    default: module.ClientPortal,
  })),
);
const ClientInvestment = lazy(() =>
  import("@/components/client-portal/ClientInvestment").then((module) => ({
    default: module.ClientInvestment,
  })),
);
const OperatorDelivery = lazy(() =>
  import("./OperatorDelivery").then((module) => ({ default: module.OperatorDelivery })),
);
const tabs: { view: ReceptionistView; label: string }[] = [
  { view: "improvements", label: "Feedback & responses" },
  { view: "today", label: "Receptionist overview" },
  { view: "practice", label: "Practise & improve" },
  { view: "callers", label: "People who called" },
  { view: "phones", label: "Phone system" },
  { view: "details", label: "Training & setup" },
];
function OperatorModuleContent({
  tenantId,
  company,
  module,
  onModule,
  view,
  onView,
}: {
  tenantId: string;
  company: string;
  module: OperatorModule;
  onModule: (module: OperatorModule) => void;
  view: ReceptionistView;
  onView: (view: ReceptionistView) => void;
}) {
  const { user } = useAuth();
  const health = useOperatorHealth(tenantId);
  const data = health.isError ? undefined : health.data;
  const signal = healthSignal(data);
  if (module === "receptionist")
    return (
      <>
        <div className="op-heading">
          <p className="op-eyebrow">RELEASED MODULE · AI RECEPTIONIST</p>
          <h1>{data?.receptionist?.name ?? "Receptionist"}, from your side.</h1>
          <p>Review the call. Respond to the client. Keep each improvement moving.</p>
        </div>
        <nav className="op-inline-nav" aria-label="Receptionist tools">
          {tabs.map((tab) => (
            <button
              key={tab.view}
              aria-current={view === tab.view ? "page" : undefined}
              onClick={() => onView(tab.view)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <Suspense fallback={<p role="status">Opening the receptionist…</p>}>
          {view === "improvements" ? (
            <FeedbackDesk key={tenantId} tenantId={tenantId} />
          ) : (
            <ReceptionistWorkspace
              key={tenantId}
              tenantId={tenantId}
              embedded
              initialView={view}
              onViewChange={onView}
            />
          )}
        </Suspense>
      </>
    );
  if (module === "invoices")
    return (
      <>
        <div className="op-heading">
          <p className="op-eyebrow">CLIENT INVESTMENT</p>
          <h1>Invoices, explained.</h1>
          <p>The same invoices and delivery notes your client sees.</p>
        </div>
        <OperatorDelivery key={`${tenantId}-invoices`} tenantId={tenantId} mode="invoices" />
        <div className="cp-root op-embedded" style={{ marginTop: 24 }}>
          {user && <ClientInvestment tenant={tenantId} userId={user.id} showDelivery={false} />}
        </div>
      </>
    );
  if (module === "modules")
    return (
      <>
        <OperatorDelivery key={`${tenantId}-delivery`} tenantId={tenantId} mode="outcomes" />
        <div style={{ marginTop: 28 }}>
          <p className="op-shared-note">
            Modules below share the client’s workspace. Changes to scope, prices and delivery status
            publish to their workspace.
          </p>
          <ClientPortal key={tenantId} tenantId={tenantId} section="modules" operatorEmbedded />
        </div>
      </>
    );
  return (
    <>
      <div className="op-heading">
        <p className="op-eyebrow">OPENFOLK · CLIENT WORKSPACE</p>
        <h1>{company}</h1>
        <p>Keep the service working. Move the next outcome forward.</p>
      </div>
      {health.isError && (
        <div className="op-error" role="alert">
          {health.error.message}{" "}
          <button onClick={() => void health.refetch()}>Retry health check</button>
        </div>
      )}
      <div className="op-metrics">
        <div className="op-metric">
          <span className={`op-status op-status-${signal.tone}`}>
            {signal.tone === "urgent" && <BellRing size={15} />} {signal.label}
          </span>
          <p className="op-note">Saved reports & delivery checks</p>
        </div>
        <button className="op-metric" onClick={() => onView("improvements")}>
          <strong>{data?.open ?? "—"}</strong>
          <span>Open feedback · view reports</span>
        </button>
        <div className="op-metric">
          <strong>{data ? data.failed + data.overdue : "—"}</strong>
          <span>Notification delivery issues</span>
        </div>
      </div>
      {!!data?.urgent && (
        <div className="op-error">
          <BellRing size={18} />
          <strong>
            {" "}
            {data.urgent} urgent report{data.urgent === 1 ? "" : "s"}
          </strong>
          <p>Open the receptionist feedback queue to review and respond.</p>
          <button className="op-button" onClick={() => onView("improvements")}>
            Review urgent feedback <ArrowRight size={16} />
          </button>
        </div>
      )}
      <div className="op-module-grid">
        <button className="op-card op-module-card" onClick={() => onView("improvements")}>
          <Headphones size={27} />
          <h2>{data?.receptionist?.name ?? "AI receptionist"}</h2>
          <p>Calls, feedback, practice reports and the next improvement.</p>
          <p className="op-note">
            {data?.receptionist
              ? `Recorded stage: ${data.receptionist.launch_stage}. Phone routing is verified separately.`
              : "Check receptionist setup and access."}
          </p>
          <span className="op-button">
            Open receptionist <ArrowRight size={16} />
          </span>
        </button>
        <button className="op-card op-module-card" onClick={() => onModule("invoices")}>
          <Receipt size={27} />
          <h2>Invoices</h2>
          <p>See the investment. Explain what each invoice delivered.</p>
        </button>
        <button className="op-card op-module-card" onClick={() => onModule("modules")}>
          <Layers size={27} />
          <h2>Modules</h2>
          <p>Publish progress, scope and fixed-price packages.</p>
        </button>
      </div>
      <p className="op-note">
        {data
          ? `Checked ${new Date(data.checkedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}. `
          : ""}
        Saved operational signals refresh every minute. New modules will join this workspace as they
        are released.
      </p>
    </>
  );
}

export function OperatorModules(props: Parameters<typeof OperatorModuleContent>[0]) {
  return (
    <Suspense fallback={<p role="status">Opening module…</p>}>
      <OperatorModuleContent {...props} />
    </Suspense>
  );
}
