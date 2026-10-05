/**
 * ConnectorHealthPanel — the connector details drawer. It renders ONLY what the
 * provider derived from real snapshot data: evidence-based health + score, the
 * freshness model, actionable warnings, the operational timeline, and the full
 * diagnostics. It holds NO vendor knowledge, so every connector (now and future)
 * gets the same operational drawer for free.
 */

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ConnectorStatusBadge, ConnectorHealthBadge } from "./StatusBadges";
import { toBadge } from "@/lib/runtime/ConnectorHealth";
import { fmtAge, fmtInterval, type FreshnessStatus } from "@/lib/runtime/freshness";
import type { ConnectorAction } from "@/lib/connectors/types";
import type { RuntimeConnector, DiagnosticTone, TimelineEvent } from "@/lib/runtime/types";

const TONE: Record<DiagnosticTone, string> = {
  default: "text-foreground",
  success: "text-success",
  warning: "text-warning",
  critical: "text-destructive",
  muted: "text-muted-foreground",
};

const FRESHNESS_LABEL: Record<FreshnessStatus, { label: string; tone: DiagnosticTone }> = {
  healthy: { label: "Healthy", tone: "success" },
  stale: { label: "Stale", tone: "warning" },
  offline: { label: "Offline", tone: "critical" },
  never_run: { label: "Never run", tone: "warning" },
  unknown: { label: "Unknown", tone: "muted" },
};

const TL_TONE: Record<TimelineEvent["status"], string> = {
  success: "bg-success",
  failed: "bg-destructive",
  running: "bg-accent",
  queued: "bg-warning",
  cancelled: "bg-muted-foreground/50",
};

function fmtClock(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ConnectorHealthPanel({
  connector,
  open,
  onOpenChange,
  onAction,
}: {
  connector: RuntimeConnector | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAction?: (action: ConnectorAction) => void;
}) {
  const badge = connector ? toBadge(connector.status) : null;
  const fresh = connector ? FRESHNESS_LABEL[connector.freshness.status] : null;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        {connector && badge && fresh && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2 text-base">
                {connector.descriptor.name}
                <span className="text-xs font-normal text-muted-foreground">
                  {connector.descriptor.provider}
                </span>
              </SheetTitle>
            </SheetHeader>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <ConnectorStatusBadge status={badge.status} />
              <ConnectorHealthBadge health={badge.health} />
              <span className="text-display text-sm font-bold tabular">
                {connector.health.score}%
              </span>
              <span className={`text-xs ${TONE[fresh.tone]}`}>
                {fresh.label} · last success {fmtAge(connector.freshness.age_seconds)}
              </span>
            </div>

            {/* Why (evidence-based reasons) */}
            {connector.health.reasons.length > 0 && (
              <ul className="mt-4 space-y-1.5">
                {connector.health.reasons.map((r) => (
                  <li
                    key={r}
                    className="rounded-lg border border-hairline bg-surface-alt/60 px-3 py-2 text-xs text-foreground"
                  >
                    {r}
                  </li>
                ))}
              </ul>
            )}

            {/* Actionable warnings + recommended action */}
            {connector.warnings.length > 0 && (
              <div className="mt-4 space-y-2">
                {connector.warnings.map((w) => (
                  <div
                    key={w.id}
                    className={`rounded-lg border px-3 py-2 text-xs ${
                      w.severity === "critical"
                        ? "border-destructive/20 bg-destructive/10"
                        : "border-warning/20 bg-warning/10"
                    }`}
                  >
                    <div
                      className={`font-medium ${
                        w.severity === "critical" ? "text-destructive" : "text-warning"
                      }`}
                    >
                      {w.title}
                    </div>
                    {w.detail && <div className="mt-0.5 text-muted-foreground">{w.detail}</div>}
                    {w.recommendedAction && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 h-7 px-2 text-[11px]"
                        onClick={() => onAction?.(w.recommendedAction!)}
                      >
                        {w.actionLabel ?? "Fix"}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Freshness */}
            <div className="mt-5">
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Freshness
              </div>
              <dl className="mt-2 divide-y divide-hairline rounded-xl border border-hairline">
                {[
                  { label: "Status", value: fresh.label, tone: fresh.tone },
                  {
                    label: "Last success",
                    value: fmtAge(connector.freshness.age_seconds),
                    tone: (connector.freshness.last_success
                      ? "success"
                      : "muted") as DiagnosticTone,
                  },
                  {
                    label: "Expected cadence",
                    value: `every ${fmtInterval(connector.freshness.expected_interval)}`,
                    tone: "default" as DiagnosticTone,
                  },
                ].map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <dt className="text-xs text-muted-foreground">{row.label}</dt>
                    <dd className={`text-xs font-medium ${TONE[row.tone]}`}>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* Timeline */}
            <div className="mt-5">
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Recent timeline
              </div>
              {connector.timeline.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">No runs recorded yet.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {connector.timeline.map((e) => (
                    <li key={e.id} className="flex items-start gap-2 text-xs">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {fmtClock(e.at)}
                      </span>
                      <span
                        className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${TL_TONE[e.status]}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="text-foreground">{e.title}</span>
                        {e.detail && <span className="text-muted-foreground"> · {e.detail}</span>}
                      </span>
                      <span
                        className={
                          e.status === "failed" ? "text-destructive" : "text-muted-foreground"
                        }
                      >
                        {e.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Full diagnostics */}
            <div className="mt-5 space-y-5">
              {connector.diagnostics.map((group) => (
                <div key={group.title}>
                  <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {group.title}
                  </div>
                  <dl className="mt-2 divide-y divide-hairline rounded-xl border border-hairline">
                    {group.rows.map((row) => (
                      <div
                        key={row.label}
                        className="flex items-start justify-between gap-3 px-3 py-2"
                      >
                        <dt className="text-xs text-muted-foreground">{row.label}</dt>
                        <dd
                          className={`min-w-0 break-words text-right text-xs font-medium ${
                            TONE[row.tone ?? "default"]
                          }`}
                        >
                          {row.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
