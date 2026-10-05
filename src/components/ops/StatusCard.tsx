/**
 * StatusCard — a generic panel with a title, optional status badge, optional
 * header action, and arbitrary children. The base layout every Operations
 * Centre panel is built from, so panels stay visually consistent.
 */

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { ConnectorStatusBadge } from "./StatusBadges";
import type { ConnectorStatus } from "@/lib/connectors/types";

export function StatusCard({
  title,
  subtitle,
  icon: Icon,
  status,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  status?: ConnectorStatus;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-hairline bg-white p-6">
      <div className="flex items-center justify-between gap-3 border-b border-hairline pb-4">
        <div className="flex min-w-0 items-center gap-3">
          {Icon && (
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-alt">
              <Icon className="h-4 w-4 text-foreground" />
            </span>
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{title}</div>
            {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {status && <ConnectorStatusBadge status={status} />}
          {action}
        </div>
      </div>
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}
