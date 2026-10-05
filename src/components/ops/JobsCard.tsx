/**
 * JobsCard — reusable background-jobs summary (running, queued, completed,
 * failed, retry, rate). Presentational only; a jobs backend can feed it later.
 */

import { cn } from "@/lib/utils";

export interface JobsSummary {
  running: number;
  queued: number;
  completedToday: number;
  failed: number;
  retryQueue: number;
  /** e.g. "128 / min". */
  processingRate: string;
}

export function JobsCard({ title = "Jobs", jobs }: { title?: string; jobs: JobsSummary }) {
  const tiles: { label: string; value: string | number; cls: string }[] = [
    { label: "Running", value: jobs.running, cls: "text-accent" },
    { label: "Queued", value: jobs.queued, cls: "text-foreground" },
    { label: "Completed", value: jobs.completedToday, cls: "text-success" },
    { label: "Failed", value: jobs.failed, cls: "text-destructive" },
    { label: "Retry", value: jobs.retryQueue, cls: "text-warning" },
    { label: "Rate", value: jobs.processingRate, cls: "text-muted-foreground" },
  ];
  return (
    <div className="rounded-2xl border border-hairline bg-white p-6">
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-4 grid grid-cols-3 gap-3">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-hairline bg-surface-alt p-3">
            <div className={cn("text-display text-lg font-bold tabular", t.cls)}>{t.value}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {t.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
