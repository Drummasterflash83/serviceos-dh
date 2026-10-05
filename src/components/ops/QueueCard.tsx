/**
 * QueueCard — reusable queue-depth panel (sync queue, AI queue, processing
 * queue…). Presentational; a real queue backend can feed it later.
 */

import { cn } from "@/lib/utils";
import { ConnectorStatusBadge } from "./StatusBadges";
import type { ConnectorStatus } from "@/lib/connectors/types";

export interface QueueRow {
  id: string;
  name: string;
  depth: number;
  rate?: string;
  status?: ConnectorStatus;
}

export function QueueCard({
  title = "Queues",
  queues,
  emptyLabel = "No active queues.",
}: {
  title?: string;
  queues: QueueRow[];
  emptyLabel?: string;
}) {
  return (
    <div className="rounded-2xl border border-hairline bg-white p-6">
      <div className="text-sm font-semibold">{title}</div>
      {queues.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="mt-3 divide-y divide-hairline">
          {queues.map((q) => (
            <li key={q.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-xs font-medium text-foreground">{q.name}</div>
                {q.rate && <div className="text-[11px] text-muted-foreground">{q.rate}</div>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {q.status && <ConnectorStatusBadge status={q.status} />}
                <span
                  className={cn(
                    "text-display text-sm font-bold tabular",
                    q.depth > 0 ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {q.depth}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
