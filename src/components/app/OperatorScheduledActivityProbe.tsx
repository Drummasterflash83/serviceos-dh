import { useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import {
  readScheduledActivityRetainedState,
  readScheduledActivitySourcePage,
  readScheduledActivityWait,
  type ScheduledActivitySourcePage,
} from "@/lib/new-dawn-scheduled-activity-source-review";

/** Explicit operator-only, default-OFF source discovery; never client job routing. */
export function OperatorScheduledActivityProbe({
  tenantId,
  connectionId,
  canRun,
}: {
  tenantId: string;
  connectionId: string | null;
  canRun: boolean;
}) {
  const [enabled, setEnabled] = useState(false);
  const [reason, setReason] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [page, setPage] = useState<ScheduledActivitySourcePage | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const working = useRef(false);
  useEffect(() => {
    const ticket = ++generation.current;
    working.current = false;
    setBusy(false);
    setEnabled(false);
    setReason("");
    setRequestId(null);
    setRetryAt(null);
    setPage(null);
    setNotice("");
    if (canRun && connectionId) {
      void getSupabaseClient()
        .from("feature_flags")
        .select("value")
        .eq("tenant_id", tenantId)
        .eq("flag", "new_dawn.m2_scheduled_activity_probe")
        .maybeSingle()
        .then(({ data, error }) => {
          if (generation.current === ticket) setEnabled(!error && data?.value === true);
        });
    }
    const generationRef = generation;
    return () => {
      generationRef.current++;
    };
  }, [tenantId, connectionId, canRun]);
  if (!enabled || !connectionId || !canRun) return null;
  const clear = () => {
    generation.current++;
    setRequestId(null);
    setRetryAt(null);
    setPage(null);
    setNotice("");
  };
  async function run(sameRequest: boolean) {
    if (
      working.current ||
      !connectionId ||
      !canRun ||
      reason.trim().length < 3 ||
      reason.trim().length > 500
    )
      return;
    const id = sameRequest && requestId ? requestId : crypto.randomUUID();
    const ticket = generation.current;
    working.current = true;
    setBusy(true);
    setPage(null);
    setNotice("");
    if (!sameRequest) {
      setRequestId(id);
      setRetryAt(null);
    }
    try {
      const db = getSupabaseClient();
      const { data, error } = await db.functions.invoke(
        "learn-commusoft-scheduled-activity-probe",
        {
          body: { tenantId, connectionId, requestId: id, reason: reason.trim() },
        },
      );
      if (error) throw Error("source_check_unconfirmed");
      if (data && typeof data === "object" && "state" in data && data.state === "waiting") {
        const next = readScheduledActivityWait(data, id);
        if (ticket === generation.current) {
          setRetryAt(next);
          setNotice(
            `Commusoft is busy until ${new Date(next).toLocaleString("en-GB")}. Retry this same request manually; no page was read.`,
          );
        }
      } else {
        const checked = readScheduledActivitySourcePage(data, {
          tenant: tenantId,
          connection: connectionId,
          request: id,
        });
        if (ticket === generation.current) {
          setPage(checked);
          setRetryAt(null);
        }
      }
    } catch {
      try {
        const { data, error } = await getSupabaseClient().rpc(
          "new_dawn_commusoft_scheduled_activity_probe_result",
          { p_request: id },
        );
        if (error) throw Error();
        const retained = readScheduledActivityRetainedState(data, id);
        if (ticket === generation.current) {
          if (retained.state === "complete") {
            setPage(
              readScheduledActivitySourcePage(retained.result, {
                tenant: tenantId,
                connection: connectionId,
                request: id,
              }),
            );
            setRetryAt(null);
          } else {
            setNotice(
              `The source check was ${retained.state}. Request ${id}. Review its operator audit before another check.`,
            );
          }
        }
      } catch {
        if (ticket === generation.current)
          setNotice(
            `Source check unconfirmed. Request ${id}. Review its saved audit before retrying.`,
          );
      }
    } finally {
      if (ticket === generation.current) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <details className="rounded-xl border p-4">
      <summary className="cursor-pointer font-semibold">Scheduled activity source check</summary>
      <div className="space-y-3 pt-3 text-sm">
        <p>
          Read one page of up to 10 Commusoft office tasks. A job link, due date or source assignee
          is evidence to review, not an engineer appointment, a verified staff identity or a task
          assigned in OpenFolk. Raw records stay in a private operator receipt.
        </p>
        <label className="block">
          Reason for source check
          <input
            className="cp-input w-full"
            value={reason}
            maxLength={500}
            disabled={busy || !!requestId}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Review office tasks linked to jobs"
          />
        </label>
        {!requestId && (
          <button
            className="cp-secondary"
            disabled={busy || reason.trim().length < 3}
            onClick={() => void run(false)}
          >
            Read one source page
          </button>
        )}
        {requestId && retryAt !== null && (
          <button className="cp-secondary" disabled={busy} onClick={() => void run(true)}>
            Retry same request
          </button>
        )}
        {requestId && retryAt === null && !busy && (
          <button className="cp-secondary" onClick={clear}>
            Close this check
          </button>
        )}
        {notice && <p role="status">{notice}</p>}
        {page && (
          <div role="status" className="space-y-1">
            <p>
              {page.recordCount} office tasks on this page · {page.jobParentCount} with job parent ·{" "}
              {page.dueDatePresentCount} with due date · {page.assignedTooPresentCount} with source
              assignee field.
            </p>
            <p>
              More pages:{" "}
              {page.hasMore === null ? "unknown" : page.hasMore ? "yes, not read" : "no"}. Checked{" "}
              {new Date(page.observedAt).toLocaleString("en-GB")}.
            </p>
            <p>
              Parent types:{" "}
              {page.parentTypeCounts.map((x) => `${x.label} (${x.count})`).join(", ") || "none"}.
              Statuses:{" "}
              {page.statusCounts.map((x) => `${x.label} (${x.count})`).join(", ") || "none"}.
            </p>
          </div>
        )}
      </div>
    </details>
  );
}
