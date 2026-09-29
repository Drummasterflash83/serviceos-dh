import { useState, type ReactNode } from "react";
import { ArrowRight, CheckCircle2, ClipboardList } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getSupabaseClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { deskQueue, type DeskStage } from "@/lib/feedback-desk";
import {
  clientFeedbackStages,
  clientFeedbackStage,
  clientFeedbackLabel,
  type ClientFeedbackStage,
} from "@/lib/client-feedback";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import "@/styles/feedback-desk.css";

export type ClientFeedback = {
  id: string;
  title: string;
  body: string;
  priority: string;
  status: string;
  response: string;
  created_at: string;
};
type Progress = { feedback_id: string; stage: DeskStage; message: string; updated_at: string };
const fallback: Record<string, DeskStage> = {
  New: "received",
  Reviewing: "reviewing",
  "In progress": "approved",
  "Ready to test": "verifying",
  Resolved: "resolved",
};
const date = (s: string) =>
  new Date(s).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/London",
  });
export function ClientFeedbackDesk<T extends ClientFeedback>({
  tenant,
  notes,
  loading,
  error,
  demo,
  evidence,
}: {
  tenant: string;
  notes: T[];
  loading: boolean;
  error?: string;
  demo: boolean;
  evidence: (note: T) => ReactNode;
}) {
  const { user } = useAuth();
  const [stage, setStage] = useState<ClientFeedbackStage>("submitted"),
    [sort, setSort] = useState("priority"),
    [selected, setSelected] = useState<string | null>(null);
  // Only the safe client projection. Never query operator issues, proposals or releases here.
  const progress = useQuery({
    queryKey: ["client-care-progress", user?.id, tenant],
    enabled: !!user && !demo,
    queryFn: async () => {
      const r = await getSupabaseClient().rpc("care_customer_progress", { p_tenant: tenant });
      if (r.error)
        throw Error("Progress updates could not be refreshed. Your reports are still saved.");
      return r.data as Progress[];
    },
    refetchInterval: 30000,
  });
  const rows = notes.map((n) => ({
    ...n,
    stage: clientFeedbackStage(
      progress.data?.find((p) => p.feedback_id === n.id)?.stage ?? fallback[n.status] ?? "received",
    ),
  }));
  const queue = deskQueue(
    rows.filter((n) => n.stage === stage),
    sort,
  );
  const note = rows.find((n) => n.id === selected);
  const update = progress.data?.find((p) => p.feedback_id === selected);
  return (
    <section className="fd" aria-label="Feedback task board">
      <header className="fd-heading">
        <div>
          <p className="fd-eyebrow">OPENFOLK IS HERE TO HELP</p>
          <h2>Your feedback. Clear progress.</h2>
          <p>Choose a status to see what’s happening. OpenFolk handles the next step.</p>
        </div>
        <ClipboardList size={30} />
      </header>
      {(error || progress.isError) && (
        <p className="fd-error" role="alert">
          {error || progress.error?.message}
        </p>
      )}
      <div className="fd-stages fd-client-stages" aria-label="Filter tasks by status">
        {clientFeedbackStages.map((s) => (
          <button
            key={s.key}
            aria-pressed={stage === s.key}
            aria-controls="client-feedback-queue"
            onClick={() => setStage(s.key)}
          >
            <span>{s.label}</span>
            <strong>{loading ? "—" : rows.filter((n) => n.stage === s.key).length}</strong>
          </button>
        ))}
      </div>
      <section
        className="fd-queue"
        id="client-feedback-queue"
        aria-label={`${clientFeedbackLabel(stage)} tasks`}
      >
        <header>
          <div>
            <h3>{clientFeedbackLabel(stage)}</h3>
            <p>
              {loading
                ? "Loading your reports…"
                : `${queue.length} ${queue.length === 1 ? "report" : "reports"} in this queue`}
            </p>
          </div>
          <label>
            Order
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="priority">Priority · newest first</option>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </label>
        </header>
        {queue.map((n) => (
          <button className="fd-row" key={n.id} onClick={() => setSelected(n.id)}>
            <span className={`fd-priority ${n.priority}`}>{n.priority}</span>
            <span className="fd-row-main">
              <strong>{n.title}</strong>
              <span>{n.body}</span>
            </span>
            <span className="fd-row-meta">
              <time dateTime={n.created_at}>{date(n.created_at)}</time>
              <small>
                {n.stage === "submitted"
                  ? "Saved for OpenFolk"
                  : n.stage === "resolved"
                    ? "Completed by OpenFolk"
                    : "OpenFolk is looking after this"}
              </small>
            </span>
            <ArrowRight size={18} />
          </button>
        ))}
        {!loading && !queue.length && (
          <div className="fd-empty">
            <CheckCircle2 size={26} />
            <h4>Nothing here right now.</h4>
            <p>Choose another status to see the rest of your feedback.</p>
          </div>
        )}
      </section>
      <Dialog
        open={!!note}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="fd-dialog">
          <DialogHeader>
            <DialogTitle>{note?.title ?? "Your feedback"}</DialogTitle>
            <DialogDescription>Your report and the latest update from OpenFolk.</DialogDescription>
          </DialogHeader>
          {note && (
            <div className="fd-task">
              <div className="fd-task-meta">
                <span className="fd-badge">{clientFeedbackLabel(note.stage)}</span>
                <span>{date(note.created_at)}</span>
              </div>
              <section className="fd-block">
                <h3>What you told us</h3>
                <p className="fd-preserve">{note.body}</p>
              </section>
              <section className="fd-block fd-client">
                <h3>OpenFolk’s update</h3>
                <p className="fd-preserve">
                  {update?.message ||
                    note.response ||
                    "Your report is saved. OpenFolk will review it and keep you updated here."}
                </p>
                {update && <small>Updated {date(update.updated_at)}</small>}
              </section>
              {evidence(note)}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
