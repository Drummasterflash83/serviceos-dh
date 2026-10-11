import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import {
  readSchedulerHealth,
  type SchedulerHealthItem,
  type SchedulerReaderClient,
} from "@/lib/scheduler-health-reader";
import { schedulerStatusLabels } from "@/lib/scheduler-outcome";

export function OperatorSchedulerHealth({
  tenantId,
  actorId,
  client,
}: {
  tenantId: string;
  actorId: string;
  client?: SchedulerReaderClient;
}) {
  const [items, setItems] = useState<SchedulerHealthItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [scope, setScope] = useState("");
  const generation = useRef(0);
  const currentScope = `${tenantId}:${actorId}`;
  const load = useCallback(async () => {
    const ticket = ++generation.current;
    setBusy(true);
    try {
      const result = await readSchedulerHealth(client ?? getSupabaseClient(), tenantId);
      if (ticket !== generation.current) return;
      setScope(currentScope);
      setItems(result.ok ? result.data : null);
      setError(!result.ok);
    } catch {
      if (ticket !== generation.current) return;
      setItems(null);
      setError(true);
      setScope(currentScope);
    } finally {
      if (ticket === generation.current) setBusy(false);
    }
  }, [tenantId, actorId, client]);
  useEffect(() => {
    setItems(null);
    setError(false);
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30000);
    return () => {
      generation.current++;
      clearInterval(timer);
    };
  }, [load]);
  const visible = scope === currentScope ? items : null;
  return (
    <section className="rounded-xl border p-4 space-y-3" aria-label="Company scheduling checks">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Scheduling checks</h3>
          <p className="text-sm">
            Recorded scheduling activity. Completed capture and source coverage are checked
            separately.
          </p>
        </div>
        <button className="cp-secondary" disabled={busy} onClick={() => void load()}>
          {busy ? "Checking schedules…" : "Refresh scheduling checks"}
        </button>
      </div>
      {error && scope === currentScope && (
        <p role="status">
          Scheduling status could not be verified. Refresh or check operator access.
        </p>
      )}
      {!visible && !error && <p className="text-sm">Checking this company’s scheduling status…</p>}
      {visible && (
        <ul className="divide-y">
          {visible.map((item) => (
            <li key={item.name} className="flex flex-wrap justify-between gap-3 py-2 text-sm">
              <span>{item.label}</span>
              <span>
                <strong
                  className={
                    item.status === "healthy"
                      ? "text-success"
                      : ["failed", "paused", "stale"].includes(item.status)
                        ? "text-warning"
                        : "text-muted-foreground"
                  }
                >
                  {schedulerStatusLabels[item.status]}
                </strong>
                <span className="ml-2 text-xs text-muted-foreground">
                  {item.lastRunAt
                    ? new Date(item.lastRunAt).toLocaleString("en-GB")
                    : "No recorded tick"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {visible?.some((item) => item.status === "failed") && (
        <p className="text-sm">
          Check queued work and recent failures before retrying. An uncertain result may already
          have queued some work.
        </p>
      )}
    </section>
  );
}
