import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Sparkles,
  MessageSquare,
  Clock3,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";
import {
  deskStages,
  deskQueue,
  stageLabel,
  type DeskStage,
  type DeskIssue,
} from "@/lib/feedback-desk";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { CareEvidence } from "./CareEvidence";
import { ReleaseChoice } from "./ReleaseChoice";
import "@/styles/feedback-desk.css";

type Review = {
  id: string;
  state: string;
  safe_error: string | null;
  assistant_version: string | null;
  created_at: string;
  assessment: {
    decision?: "change_recommended" | "clarification_required" | "no_change_recommended";
    feedbackResponse?: string;
    unchanged?: string[];
    summary: string;
    findings: {
      category: string;
      evidence: string;
      explanation: string;
      suggestedChange: string;
    }[];
    limitations: string[];
  } | null;
};
const date = (s: string) =>
  new Date(s).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/London",
  });
export function FeedbackDesk({
  tenantId,
  initialIssueId,
}: {
  tenantId: string;
  initialIssueId?: string;
}) {
  const openedInitial = useRef<string | undefined>(undefined);
  const { user } = useAuth(),
    db = getSupabaseClient();
  const [stage, setStage] = useState<DeskStage>("received"),
    [sort, setSort] = useState("priority"),
    [selected, setSelected] = useState<string | null>(null);
  const issues = useQuery({
    queryKey: ["feedback-desk", user?.id, tenantId],
    enabled: !!user,
    queryFn: async () => {
      // A complete paginated queue: status counts must not silently cap at 200.
      const all: DeskIssue[] = [];
      for (let offset = 0; ; offset += 500) {
        const r = await db
          .from("receptionist_care_issues")
          .select("*")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false })
          .order("id")
          .range(offset, offset + 499);
        if (r.error)
          throw Error("The task board could not be loaded. Your feedback is still saved.");
        all.push(...(r.data as DeskIssue[]));
        if (r.data.length < 500) break;
      }
      return all;
    },
    refetchInterval: 30000,
  });
  const rows = deskQueue(
    (issues.data ?? []).filter((x) => x.stage === stage),
    sort,
  );
  useEffect(() => {
    const initial = issues.data?.find((i) => i.id === initialIssueId);
    if (initial && openedInitial.current !== initial.id) {
      openedInitial.current = initial.id;
      setSelected(initial.id);
      setStage(initial.stage);
    }
  }, [initialIssueId, issues.data]);
  const issue = issues.data?.find((x) => x.id === selected);
  return (
    <section className="fd" aria-label="Feedback task board">
      <header className="fd-heading">
        <div>
          <p className="fd-eyebrow">THE IMPROVEMENT DESK</p>
          <h2>One report. A clear next step.</h2>
          <p>Review the issue. Agree the fix. Test it or publish it.</p>
        </div>
        <ClipboardList size={30} />
      </header>
      {issues.isError ? (
        <div className="fd-error" role="alert">
          {issues.error.message} <button onClick={() => void issues.refetch()}>Try again</button>
        </div>
      ) : (
        <>
          <div className="fd-stages" aria-label="Filter tasks by status">
            {deskStages.map((s) => (
              <button
                key={s.key}
                aria-pressed={stage === s.key}
                aria-controls="feedback-task-queue"
                onClick={() => setStage(s.key)}
              >
                <span>{s.label}</span>
                <strong>
                  {issues.isPending
                    ? "—"
                    : (issues.data?.filter((i) => i.stage === s.key).length ?? 0)}
                </strong>
              </button>
            ))}
          </div>
          <section
            className="fd-queue"
            id="feedback-task-queue"
            aria-label={`${stageLabel(stage)} tasks`}
          >
            <header>
              <div>
                <h3>{stageLabel(stage)}</h3>
                <p>
                  {issues.isPending
                    ? "Loading your tasks…"
                    : `${rows.length} ${rows.length === 1 ? "task" : "tasks"} in this queue`}
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
            {rows.map((i) => (
              <button className="fd-row" key={i.id} onClick={() => setSelected(i.id)}>
                <span className={`fd-priority ${i.priority}`}>{i.priority}</span>
                <span className="fd-row-main">
                  <strong>{i.title}</strong>
                  <span>{i.detail}</span>
                </span>
                <span className="fd-row-meta">
                  <time dateTime={i.created_at}>{date(i.created_at)}</time>
                  <small>{i.owner_id ? "Picked up" : "Awaiting OpenFolk"}</small>
                </span>
                <ArrowRight size={18} />
              </button>
            ))}
            {!issues.isPending && !rows.length && (
              <div className="fd-empty">
                <CheckCircle2 size={26} />
                <h4>Nothing here right now.</h4>
                <p>Choose another status to see the rest of the work.</p>
              </div>
            )}
          </section>
        </>
      )}
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="fd-dialog">
          <DialogHeader>
            <DialogTitle>{issue?.title ?? "Feedback task"}</DialogTitle>
            <DialogDescription>
              Evidence, decisions and customer progress in one place.
            </DialogDescription>
          </DialogHeader>
          {issue && <TaskDetail key={`${issue.id}:${issue.version}`} issue={issue} />}
        </DialogContent>
      </Dialog>
    </section>
  );
}
function TaskDetail({ issue }: { issue: DeskIssue }) {
  const { user } = useAuth(),
    db = getSupabaseClient(),
    qc = useQueryClient();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [diagnosis, setDiagnosis] = useState(issue.diagnosis),
    [proposal, setProposal] = useState(issue.proposal),
    [tests, setTests] = useState(issue.test_plan);
  const review = useQuery({
    queryKey: ["task-review", user?.id, issue.tenant_id, issue.id],
    queryFn: async () => {
      const r = await db
        .from("receptionist_task_reviews")
        .select("id,state,safe_error,assessment,assistant_version,created_at")
        .eq("tenant_id", issue.tenant_id)
        .eq("issue_id", issue.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (r.error) throw Error("Review history could not be loaded.");
      return r.data as Review | null;
    },
    refetchInterval: busy ? 3000 : 30000,
  });
  const history = useQuery({
    queryKey: ["task-history", user?.id, issue.tenant_id, issue.id, issue.version],
    queryFn: async () => {
      const r = await db
        .from("receptionist_care_events")
        .select("id,action,created_at,version")
        .eq("tenant_id", issue.tenant_id)
        .eq("issue_id", issue.id)
        .order("version", { ascending: false });
      if (r.error) throw Error("History unavailable.");
      return r.data;
    },
  });
  async function action(name: string, content: Record<string, string> = {}) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await db.rpc("care_issue_action", {
        p_tenant: issue.tenant_id,
        p_issue: issue.id,
        p_version: issue.version,
        p_action: name,
        p_content: content,
      });
      if (r.error)
        throw Error("This change could not be saved. Reload the task if someone has updated it.");
      await qc.invalidateQueries({ queryKey: ["feedback-desk"] });
      await qc.invalidateQueries({ queryKey: ["receptionist-feedback"] });
      await qc.invalidateQueries({ queryKey: ["task-history"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function analyse() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await db.functions.invoke("receptionist-task-review", {
        body: { tenantId: issue.tenant_id, issueId: issue.id },
      });
      let message = r.data?.error;
      if (r.error?.context instanceof Response) {
        const b = await r.error.context
          .clone()
          .json()
          .catch(() => null);
        message = b?.error ?? message;
      }
      if (r.error || message)
        throw Error(message || "The review could not complete. No change was made to Emma.");
      setNotice("Review saved. Read the evidence before preparing a change.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      await qc.invalidateQueries({ queryKey: ["task-review"] });
    }
  }
  const assessment = review.data?.state === "completed" ? review.data.assessment : null;
  const editable =
    ["reviewing", "approval", "approved"].includes(issue.stage) && issue.owner_id === user?.id;
  function submit(e: FormEvent) {
    e.preventDefault();
    void action("propose", { diagnosis, proposal, test_plan: tests });
  }
  return (
    <div className="fd-task">
      <div className="fd-task-meta">
        <span className="fd-badge">{stageLabel(issue.stage)}</span>
        <span className={`fd-priority ${issue.priority}`}>{issue.priority} priority</span>
        <span>{date(issue.created_at)}</span>
      </div>
      {error && (
        <div role="alert" className="fd-error">
          {error}
        </div>
      )}
      {notice && (
        <p role="status" className="fd-success">
          {notice}
        </p>
      )}
      <section className="fd-block">
        <h3>1. The problem</h3>
        <p className="fd-preserve">{issue.detail}</p>
        {["received", "reviewing"].includes(issue.stage) && issue.owner_id !== user?.id && (
          <button className="fd-primary" disabled={busy} onClick={() => void action("claim")}>
            Pick this up <ArrowRight size={16} />
          </button>
        )}
      </section>
      <details className="fd-block">
        <summary>Original call and recording</summary>
        <CareEvidence
          tenantId={issue.tenant_id}
          issueId={issue.id}
          sourceKey={issue.source_key}
          feedbackId={issue.feedback_id}
        />
      </details>
      <section className="fd-block">
        <div className="fd-block-heading">
          <h3>AI’s recommendation</h3>
          <button
            className="fd-secondary"
            disabled={
              busy ||
              issue.stage === "resolved" ||
              (review.data?.state === "running" &&
                Date.now() - Date.parse(review.data.created_at) < 120000)
            }
            onClick={() => void analyse()}
          >
            <Sparkles size={16} />
            {busy ? "Working…" : "Review this call"}
          </button>
        </div>
        {review.isError ? (
          <p role="alert">{review.error.message}</p>
        ) : review.data?.state === "failed" ? (
          <p role="alert">{review.data.safe_error}</p>
        ) : review.data?.state === "running" ? (
          <p>
            A review was requested at {date(review.data.created_at)}. If interrupted, retry after
            two minutes.
          </p>
        ) : !assessment ? (
          <p>
            Request a read-only AI review of the original call and feedback. It will not change
            Emma.
          </p>
        ) : (
          <>
            {assessment.decision && (
              <p className="fd-badge">
                {
                  {
                    change_recommended: "Change recommended",
                    clarification_required: "Clarification needed",
                    no_change_recommended: "No change recommended for this report",
                  }[assessment.decision]
                }
              </p>
            )}
            <p>{assessment.summary}</p>
            <details>
              <summary>Why this is recommended</summary>
              {assessment.feedbackResponse && (
                <article className="fd-finding">
                  <strong>The client's request</strong>
                  <p>{assessment.feedbackResponse}</p>
                </article>
              )}
              {assessment.findings.map((f, i) => (
                <article className="fd-finding" key={i}>
                  <strong>{f.category}</strong>
                  <blockquote>{f.evidence}</blockquote>
                  <p>{f.explanation}</p>
                  <p>
                    <b>Recommendation:</b> {f.suggestedChange}
                  </p>
                </article>
              ))}
            </details>
            {!!assessment.unchanged?.length && (
              <details>
                <summary>Keep unchanged</summary>
                <ul>
                  {assessment.unchanged.map((text, i) => (
                    <li key={i}>{text}</li>
                  ))}
                </ul>
              </details>
            )}
            <details>
              <summary>Evidence limits</summary>
              <ul>
                {assessment.limitations.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
              <p>
                Current assistant version: {review.data?.assistant_version ?? "Unavailable"}. This
                may differ from the call-time version.
              </p>
            </details>
          </>
        )}
      </section>
      <form className="fd-block fd-form" onSubmit={submit}>
        <h3>2. The proposed fix</h3>
        <p>
          Save the instructions you want Emma to follow, then choose testing or publishing below.
        </p>
        {assessment && editable && !diagnosis && !proposal && (
          <button
            className="fd-secondary"
            type="button"
            disabled={busy}
            onClick={() => {
              setDiagnosis(assessment.summary);
              setProposal(assessment.findings.map((f) => f.suggestedChange).join("\n\n"));
              setNotice(
                "Recommendations copied into your draft. Check the wording and add a test plan before saving.",
              );
            }}
          >
            Use recommendations as a draft
          </button>
        )}
        <label>
          Issue and cause
          <textarea
            value={diagnosis}
            disabled={!editable || busy}
            onChange={(e) => setDiagnosis(e.target.value)}
            placeholder="What the evidence proves—and what remains uncertain."
            required
            minLength={5}
          />
        </label>
        <label>
          Recommended fix
          <textarea
            value={proposal}
            disabled={!editable || busy}
            onChange={(e) => setProposal(e.target.value)}
            placeholder="The exact behaviour or wording to change."
            required
            minLength={5}
          />
        </label>
        <label>
          What to check after the change
          <textarea
            value={tests}
            disabled={!editable || busy}
            onChange={(e) => setTests(e.target.value)}
            placeholder="Repeat the reported scenario, plus the cases that must keep working."
            required
            minLength={5}
          />
        </label>
        {editable && (
          <button className="fd-primary" disabled={busy} type="submit">
            {issue.stage === "approved"
              ? "Revise proposal · requires new approval"
              : "Save proposed fix"}
          </button>
        )}
        {issue.approved_at && issue.stage === "approved" && (
          <p className="fd-success">
            Approved {date(issue.approved_at)}. Emma’s live setup has not changed.
          </p>
        )}
      </form>
      <ReleaseChoice
        issue={issue}
        unsaved={
          diagnosis !== issue.diagnosis || proposal !== issue.proposal || tests !== issue.test_plan
        }
      />
      <section className="fd-block fd-client">
        <h3>
          <MessageSquare size={18} /> What the client sees
        </h3>
        <p>{issue.customer_update}</p>
        <small>
          Saved to their feedback record. Slack follows the configured notification route; delivery
          is tracked separately.
        </small>
      </section>
      <section className="fd-block">
        <h3>Keep this on OpenFolk’s radar</h3>
        <p>
          Publishing is not the same as verifying a fix. Keep the report open until the recorded
          result confirms the improvement.
        </p>
        <p>
          Updates go to the configured OpenFolk Slack channel. No client feedback changes Emma
          without your approval.
        </p>
        {["approved", "verifying", "resolved"].includes(issue.stage) && (
          <button
            className="fd-secondary"
            disabled={busy}
            onClick={() =>
              void action("reopen", { reason: "Reopened by OpenFolk for further review." })
            }
          >
            Return to review
          </button>
        )}
      </section>
      <details className="fd-block">
        <summary>
          <Clock3 size={16} /> Task history
        </summary>
        {history.isError ? (
          <p>{history.error.message}</p>
        ) : (
          history.data?.map((e) => (
            <p key={e.id}>
              {date(e.created_at)} ·{" "}
              {(
                {
                  received: "Report received",
                  claim: "OpenFolk picked this up",
                  propose: "Proposal saved",
                  approve: "Approved for testing",
                  reopen: "Returned to review",
                  rehearsal_completed: "Isolated rehearsal completed · review required",
                  rehearsal_failed: "Isolated rehearsal needs attention",
                } as Record<string, string>
              )[e.action] ?? e.action}
            </p>
          ))
        )}
      </details>
    </div>
  );
}
