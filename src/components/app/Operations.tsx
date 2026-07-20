import { useEffect, useState } from "react";
import { AlertTriangle, ListChecks, Activity, PlugZap } from "lucide-react";
import {
  getRecommendationSummary,
  listRecommendations,
  type Recommendation,
  type RecommendationSummary,
} from "@/lib/recommendations";
import {
  getPlatformJobSummary,
  listPlatformJobs,
  type PlatformJob,
  type PlatformJobSummary,
} from "@/lib/platform-jobs";
import { getConnectorStatuses } from "@/lib/connector-status";
import { cn } from "@/lib/utils";

/**
 * Operations — the business-operations surface. It answers "what work is flowing,
 * and can the company deliver it?" from REAL data only: open recommendations that
 * need action, delivery-affecting platform-job failures, and operational activity.
 * Field delivery (jobs, engineers, scheduling, assets) is honestly shown as
 * unconnected until a jobs connector (Commusoft) exists — never fabricated.
 */

const when = (v: string | null) =>
  v ? new Date(v).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—";

type Data = {
  recSummary: RecommendationSummary | null;
  jobSummary: PlatformJobSummary | null;
  recs: Recommendation[];
  failures: PlatformJob[];
};

export function Operations() {
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      getRecommendationSummary(),
      getPlatformJobSummary(),
      listRecommendations({ status: "open", limit: 8 }),
      listPlatformJobs({ status: ["dead_letter", "failed"], limit: 8 }),
    ]).then(([rs, js, recs, fails]) => {
      if (!active) return;
      setData({
        recSummary: rs.ok ? rs.data : null,
        jobSummary: js.ok ? js.data : null,
        recs: recs.ok ? recs.data : [],
        failures: fails.ok ? fails.data : [],
      });
    });
    return () => {
      active = false;
    };
  }, []);

  const commusoftLive =
    getConnectorStatuses().find((c) => c.id === "business.commusoft")?.state === "Live";

  if (!data) return <Panel>Loading operational state…</Panel>;

  return (
    <div className="space-y-6">
      <div>
        <div className="text-display text-xl font-semibold">Operations</div>
        <p className="mt-1 text-sm text-muted-foreground">
          What work is flowing, and whether the company can deliver it. Everything here is real;
          field-delivery systems appear once their connector is live.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Actions needing attention" value={String(data.recSummary?.open ?? 0)} />
        <Metric label="Overdue actions" value={String(data.recSummary?.overdue ?? 0)} />
        <Metric
          label="Delivery failures (unresolved)"
          value={String(data.jobSummary?.dead_letter ?? 0)}
        />
        <Metric label="Jobs failed today" value={String(data.jobSummary?.failed_today ?? 0)} />
      </div>

      <section>
        <Title icon={ListChecks}>Recommendations requiring action</Title>
        <div className="overflow-hidden rounded-2xl border border-hairline bg-white divide-y divide-hairline">
          {data.recs.length ? (
            data.recs.map((r) => (
              <div key={r.id} className="flex items-start justify-between gap-4 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <SeverityDot severity={r.severity} />
                    <span className="truncate">{r.title}</span>
                  </div>
                  {r.detail && (
                    <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {r.detail}
                    </div>
                  )}
                  {r.recommended_action && (
                    <div className="mt-1 text-xs">
                      <span className="text-muted-foreground">Recommended: </span>
                      {r.recommended_action}
                    </div>
                  )}
                </div>
                <time className="shrink-0 text-xs text-muted-foreground">
                  {when(r.due_at ?? r.created_at)}
                </time>
              </div>
            ))
          ) : (
            <Empty text="No open recommendations. Nothing needs action right now." />
          )}
        </div>
      </section>

      <section>
        <Title icon={AlertTriangle}>Delivery risks — processing failures</Title>
        <div className="overflow-hidden rounded-2xl border border-hairline bg-white divide-y divide-hairline">
          {data.failures.length ? (
            data.failures.map((j) => (
              <div key={j.id} className="flex items-start justify-between gap-4 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">
                      {j.status}
                    </span>
                    <span className="truncate">{j.job_type}</span>
                  </div>
                  {j.last_error && (
                    <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {j.last_error}
                    </div>
                  )}
                </div>
                <time className="shrink-0 text-xs text-muted-foreground">
                  {when(j.dead_lettered_at ?? j.failed_at ?? j.updated_at)}
                </time>
              </div>
            ))
          ) : (
            <Empty text="No processing failures affecting delivery." />
          )}
        </div>
      </section>

      <section>
        <Title icon={Activity}>Field delivery</Title>
        {commusoftLive ? (
          <Panel>Field delivery data is connected.</Panel>
        ) : (
          <div className="rounded-2xl border border-dashed border-hairline bg-surface-alt p-6 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <PlugZap className="h-4 w-4 text-muted-foreground" />
              Jobs, engineers, scheduling and assets are not connected
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              These require a field-service connector (Commusoft), which is not connected yet. No
              jobs, engineer counts or scheduling metrics are shown because none would be real.
              Connect Commusoft to bring operational delivery into ServiceOS.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function SeverityDot({ severity }: { severity: string }) {
  const tone =
    severity === "critical" || severity === "high"
      ? "bg-destructive"
      : severity === "medium"
        ? "bg-warning"
        : "bg-muted-foreground";
  return <span className={cn("h-2 w-2 shrink-0 rounded-full", tone)} />;
}

function Title({ icon: Icon, children }: { icon: typeof Activity; children: React.ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
      <Icon className="h-4 w-4 text-muted-foreground" />
      {children}
    </h2>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-hairline bg-white p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-display mt-1 text-xl font-bold">{value}</div>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-hairline bg-white p-5 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="p-5 text-sm text-muted-foreground">{text}</div>;
}
