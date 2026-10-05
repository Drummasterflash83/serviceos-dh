/**
 * HealthCard — overall platform health roll-up from healthy/warning/critical
 * counts. Generic: feed it counts from any source (connectors, AI, jobs…).
 */

import { cn } from "@/lib/utils";
import { ConnectorHealthBadge } from "./StatusBadges";
import type { ConnectorHealth } from "@/lib/connectors/types";

export function HealthCard({
  title = "Platform health",
  healthy,
  warning,
  critical,
}: {
  title?: string;
  healthy: number;
  warning: number;
  critical: number;
}) {
  const total = Math.max(1, healthy + warning + critical);
  const overall: ConnectorHealth = critical > 0 ? "critical" : warning > 0 ? "warning" : "healthy";
  const seg = (n: number, cls: string) =>
    n > 0 ? (
      <span className={cn("h-full", cls)} style={{ width: `${(n / total) * 100}%` }} />
    ) : null;

  return (
    <div className="rounded-2xl border border-hairline bg-white p-6">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">{title}</div>
        <ConnectorHealthBadge health={overall} />
      </div>
      <div className="mt-4 flex h-2 w-full overflow-hidden rounded-full bg-surface-alt">
        {seg(healthy, "bg-success")}
        {seg(warning, "bg-warning")}
        {seg(critical, "bg-destructive")}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3 text-center">
        {[
          { label: "Healthy", value: healthy, cls: "text-success" },
          { label: "Warnings", value: warning, cls: "text-warning" },
          { label: "Critical", value: critical, cls: "text-destructive" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-hairline bg-surface-alt p-3">
            <div className={cn("text-display text-xl font-bold tabular", s.cls)}>{s.value}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {s.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
