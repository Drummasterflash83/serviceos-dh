/**
 * MetricCard — a single KPI tile (Healthy Systems, Failed Jobs, Storage…).
 * Generic and reused across every Operations Centre dashboard. Tone maps to the
 * shared token palette so metrics read consistently platform-wide.
 */

import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type MetricTone = "default" | "accent" | "success" | "warning" | "critical";

const TONE_VALUE: Record<MetricTone, string> = {
  default: "text-foreground",
  accent: "text-accent",
  success: "text-success",
  warning: "text-warning",
  critical: "text-destructive",
};

export function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  tone?: MetricTone;
}) {
  return (
    <div className="rounded-2xl border border-hairline bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      </div>
      <div className={cn("text-display mt-2 text-2xl font-bold tabular", TONE_VALUE[tone])}>
        {value}
      </div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
