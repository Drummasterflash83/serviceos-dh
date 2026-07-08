/**
 * AlertCard — a reusable alerts list (auth failure, connector offline, webhook
 * failure, rate limit…). Data-driven; a real alerts backend can feed it later.
 */

import { AlertTriangle, Info, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type AlertSeverity = "info" | "warning" | "critical";

export interface AlertItem {
  id: string;
  title: string;
  detail?: string;
  severity: AlertSeverity;
  /** ISO timestamp or a pre-formatted label. */
  at?: string;
  /** Optional suggested action (e.g. "Open Health", "Reconnect Gmail"). */
  action?: { label: string; onClick: () => void };
}

const SEV: Record<AlertSeverity, { icon: typeof Info; cls: string }> = {
  info: { icon: Info, cls: "text-muted-foreground" },
  warning: { icon: AlertTriangle, cls: "text-warning" },
  critical: { icon: XCircle, cls: "text-destructive" },
};

export function AlertCard({
  title = "Recent alerts",
  alerts,
  emptyLabel = "No active alerts.",
}: {
  title?: string;
  alerts: AlertItem[];
  emptyLabel?: string;
}) {
  return (
    <div className="rounded-2xl border border-hairline bg-white p-6">
      <div className="text-sm font-semibold">{title}</div>
      {alerts.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="mt-3 divide-y divide-hairline">
          {alerts.map((a) => {
            const s = SEV[a.severity];
            return (
              <li key={a.id} className="flex items-start gap-3 py-2.5">
                <s.icon className={cn("mt-0.5 h-4 w-4 shrink-0", s.cls)} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-foreground">{a.title}</div>
                  {a.detail && (
                    <div className="truncate text-[11px] text-muted-foreground">{a.detail}</div>
                  )}
                  {a.action && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-1.5 h-7 px-2 text-[11px]"
                      onClick={a.action.onClick}
                    >
                      {a.action.label}
                    </Button>
                  )}
                </div>
                {a.at && (
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {a.at}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
