/**
 * HealthBreakdownCard — per-domain health at a glance (Email / Phone / AI /
 * Business …). Complements the platform KPI row instead of repeating the
 * healthy/warning/critical counts. Generic: feed it any labelled health rows.
 */

import type { LucideIcon } from "lucide-react";

import { ConnectorHealthBadge } from "./StatusBadges";
import type { ConnectorHealth } from "@/lib/connectors/types";

export interface HealthBreakdownItem {
  label: string;
  health: ConnectorHealth;
  detail?: string;
  icon?: LucideIcon;
}

export function HealthBreakdownCard({
  title = "System health",
  items,
}: {
  title?: string;
  items: HealthBreakdownItem[];
}) {
  return (
    <div className="rounded-2xl border border-hairline bg-white p-6">
      <div className="text-sm font-semibold">{title}</div>
      <ul className="mt-3 divide-y divide-hairline">
        {items.map((it) => (
          <li key={it.label} className="flex items-center justify-between gap-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              {it.icon && (
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-surface-alt">
                  <it.icon className="h-3.5 w-3.5 text-muted-foreground" />
                </span>
              )}
              <div className="min-w-0">
                <div className="truncate text-xs font-medium text-foreground">{it.label}</div>
                {it.detail && (
                  <div className="truncate text-[11px] text-muted-foreground">{it.detail}</div>
                )}
              </div>
            </div>
            <ConnectorHealthBadge health={it.health} />
          </li>
        ))}
      </ul>
    </div>
  );
}
