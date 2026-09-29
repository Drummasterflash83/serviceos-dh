import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";
import { ArrowRight, CircleAlert } from "lucide-react";
import { useEmmaHealth, type HealthIssue } from "@/lib/use-emma-health";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogHeader,
  DialogDescription,
} from "@/components/ui/dialog";
import "./emma-health.css";

const healthAreas = [
  { id: "service", label: "Call handling" },
  { id: "experience", label: "Caller experience" },
  { id: "help", label: "People needing help" },
  { id: "handover", label: "Handovers" },
  { id: "general", label: "Other feedback" },
] as const;
function OperatorReviewStatus({
  tenant,
  issues,
  onOpen,
}: {
  tenant: string;
  issues: HealthIssue[];
  onOpen: (issue?: HealthIssue) => void;
}) {
  const { user } = useAuth();
  const reviews = useQuery({
    queryKey: ["operator-review-health", user?.id, tenant],
    enabled: !!user,
    queryFn: async () => {
      const latest = new Map<string, string>();
      for (let offset = 0; ; offset += 500) {
        const r = await getSupabaseClient()
          .from("receptionist_task_reviews")
          .select("id,issue_id,state,created_at")
          .eq("tenant_id", tenant)
          .order("created_at", { ascending: false })
          .order("id")
          .range(offset, offset + 499);
        if (r.error) throw Error("Feedback analysis checks could not be refreshed.");
        for (const row of r.data)
          if (!latest.has(row.issue_id)) latest.set(row.issue_id, row.state);
        if (r.data.length < 500) break;
      }
      return latest;
    },
    refetchInterval: 30_000,
  });
  const failed = issues.filter((i) => reviews.data?.get(i.id) === "failed");
  if (reviews.isError) return <p role="alert">{reviews.error.message}</p>;
  if (reviews.isPending) return <p>Checking feedback analysis…</p>;
  return (
    <div className="eh-review-alerts">
      {failed.length ? (
        <>
          <strong>
            {failed.length} feedback {failed.length === 1 ? "review needs" : "reviews need"} another
            look
          </strong>
          <p>The latest analysis failed. These reports remain open; no fix is implied.</p>
          {failed.map((issue) => (
            <button key={issue.id} onClick={() => onOpen(issue)}>
              {issue.title} · review failed <ArrowRight size={14} />
            </button>
          ))}
        </>
      ) : (
        <p>No failed latest analyses on open feedback reports.</p>
      )}
    </div>
  );
}
export function HealthIssueList({
  issues,
  onOpen,
  onCall,
  availableCallIds,
  operator = false,
}: {
  issues: HealthIssue[];
  onOpen?: (issue: HealthIssue) => void;
  onCall?: (id: string) => void;
  availableCallIds?: string[];
  operator?: boolean;
}) {
  return (
    <div className="eh-issues">
      {issues.map((issue) => (
        <article key={issue.id}>
          <div>
            <span className={`eh-priority eh-${issue.priority}`}>
              {issue.priority === "normal" ? issue.status : `${issue.priority} · ${issue.status}`}
            </span>
            <strong>{issue.title}</strong>
            <p>{issue.message}</p>
          </div>
          <div className="eh-issue-actions">
            {issue.call_id && availableCallIds?.includes(issue.call_id) && onCall && (
              <button onClick={() => onCall(issue.call_id!)}>
                See call <ArrowRight size={14} />
              </button>
            )}
            {onOpen && (operator || issue.feedback_id) && (
              <button onClick={() => onOpen(issue)}>
                Open report <ArrowRight size={14} />
              </button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
export function EmmaIssueSummary({
  tenant,
  operator = false,
  onOpen,
}: {
  tenant?: string;
  operator?: boolean;
  onOpen: (issue?: HealthIssue) => void;
}) {
  const health = useEmmaHealth(tenant);
  const [area, setArea] = useState<string | null>(null);
  const data = health.isError ? undefined : health.data;
  const issues = data?.issues ?? [];
  const selected = issues.filter((i) =>
    i.categories.includes(area as HealthIssue["categories"][number]),
  );
  return (
    <section className="eh-summary" aria-label="OpenFolk care overview">
      <header>
        <div>
          <p className="eh-eyebrow">
            {operator ? "OPENFOLK · ACTION CENTRE" : "OPENFOLK IS LOOKING AFTER YOUR RECEPTIONIST"}
          </p>
          <h2>
            {health.isError
              ? "Report status needs a check"
              : !data
                ? "Checking open reports…"
                : issues.length
                  ? `${issues.length} open ${issues.length === 1 ? "report" : "reports"}`
                  : "No open reports"}
          </h2>
          <p>
            {operator
              ? "See where attention is needed. Open a report to investigate and act."
              : "Your feedback and issues picked up by OpenFolk, in one place."}
          </p>
        </div>
        <button onClick={() => onOpen()}>
          View feedback <ArrowRight size={16} />
        </button>
      </header>
      {health.isError && (
        <p role="alert">
          <CircleAlert size={16} /> {health.error.message}{" "}
          <button onClick={() => void health.refetch()}>Retry</button>
        </p>
      )}
      <div className="eh-areas">
        {healthAreas.map((a) => {
          const count = issues.filter((i) => i.categories.includes(a.id)).length;
          return (
            <button
              key={a.id}
              onClick={() => setArea(a.id)}
              className={count ? "eh-attention" : ""}
              disabled={!data}
            >
              <span>{a.label}</span>
              <strong>{data ? count : "—"}</strong>
              <small>{!data ? "Checking" : count ? "Open reports" : "No open reports"}</small>
            </button>
          );
        })}
      </div>
      <small>
        No open reports is not a full health check. Call evidence appears in the receptionist cards.
      </small>
      {operator && data && (
        <div className="eh-review-proof">
          <span>
            <strong>{data.reviewed_calls}</strong> call reviews recorded
          </span>
          <span>
            <strong>{data.feedback_reviewed}</strong> reports analysed
          </span>
          <span>
            <strong>{data.reviews_failed}</strong> call reviews failed
          </span>
          <span>
            <strong>{data.resolved_reports}</strong> reports resolved
          </span>
          <p>
            {data.last_call_review
              ? `Latest recorded call review: ${new Date(data.last_call_review).toLocaleString("en-GB")}.`
              : "No completed call reviews are recorded. Reviewing feedback is separate from reviewing every call."}{" "}
            These counts do not prove continuous monitoring or audio testing.
          </p>
        </div>
      )}
      {operator && tenant && data && (
        <OperatorReviewStatus tenant={tenant} issues={issues} onOpen={onOpen} />
      )}
      <Dialog open={!!area} onOpenChange={(open) => !open && setArea(null)}>
        <DialogContent className="eh-dialog">
          <DialogHeader>
            <DialogTitle>{healthAreas.find((a) => a.id === area)?.label}</DialogTitle>
            <DialogDescription>
              {operator
                ? "Open reports to investigate and move the fix forward."
                : "OpenFolk handles the next step. Your latest updates are below."}
            </DialogDescription>
          </DialogHeader>
          <HealthIssueList
            issues={selected}
            operator={operator}
            onOpen={(issue) => {
              setArea(null);
              onOpen(issue);
            }}
          />
          {!selected.length && (
            <p>No open reports in this area. Conversation assessments are shown separately.</p>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
