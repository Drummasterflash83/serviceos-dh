import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Bell, CheckCircle2, UserCheck, ArrowRight } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import "@/styles/receptionist-care.css";

type Issue = {
  id: string;
  tenant_id: string;
  source_key: string;
  feedback_id: string | null;
  title: string;
  detail: string;
  stage: string;
  priority: string;
  owner_id: string | null;
  version: number;
  diagnosis: string;
  proposal: string;
  test_plan: string;
  customer_update: string;
  due_at: string | null;
  created_at: string;
};
const labels: Record<string, string> = {
  received: "Needs an owner",
  reviewing: "Being reviewed",
  approval: "Awaiting approval",
  approved: "Approved · not released",
  verifying: "Checking the result",
  resolved: "Verified",
};
const date = (value: string) =>
  new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

export function ReceptionistCare({ tenantId }: { tenantId: string }) {
  const db = getSupabaseClient(),
    qc = useQueryClient(),
    { user } = useAuth();
  const [tab, setTab] = useState("queue"),
    [selected, setSelected] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const query = useQuery({
    queryKey: ["receptionist-care", user?.id, tenantId],
    refetchInterval: 30000,
    queryFn: async () => {
      const issues: Issue[] = [];
      for (let page = 0; ; page++) {
        const r = await db
          .from("receptionist_care_issues")
          .select("*")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false })
          .order("id")
          .range(page * 500, (page + 1) * 500 - 1);
        if (r.error) throw Error("The review desk could not be loaded. Please try again.");
        issues.push(...r.data);
        if (r.data.length < 500) break;
      }
      const [settings, routes, permission, reviews] = await Promise.all([
        db.from("receptionist_review_settings").select("*").eq("tenant_id", tenantId).maybeSingle(),
        db
          .from("module_alert_routes")
          .select("kind,team_id,channel_id,enabled,verified_at,verified_channel_name")
          .eq("tenant_id", tenantId)
          .eq("module", "receptionist"),
        db.rpc("current_user_is_openfolk_operator", {
          required_permission: "platform.controlplane.admin",
        }),
        db
          .from("receptionist_call_reviews")
          .select("call_id", { count: "exact", head: true })
          .eq("tenant_id", tenantId)
          .eq("state", "reviewed"),
      ]);
      if (settings.error || routes.error || permission.error || reviews.error)
        throw Error("Review setup could not be loaded.");
      return {
        issues,
        settings: settings.data,
        routes: routes.data,
        admin: permission.data === true,
        reviewCount: reviews.count,
      };
    },
  });
  async function perform(
    work: () => PromiseLike<{ error: { message?: string; code?: string } | null }>,
    success: string,
  ) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await work();
      if (r.error)
        throw Error(
          r.error.code === "40001"
            ? "This record changed. Reload and review it before continuing."
            : "Not saved. Check the required details, permissions and current stage.",
        );
      setMessage(success);
      await qc.invalidateQueries({ queryKey: ["receptionist-care"] });
      await qc.invalidateQueries({ queryKey: ["care-customer-progress"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The action did not complete.");
    } finally {
      setBusy(false);
    }
  }
  const data = query.data,
    issue = data?.issues.find((i) => i.id === selected),
    admin = data?.admin === true;
  const open = data?.issues.filter((i) => i.stage !== "resolved") ?? [];
  function action(i: Issue, name: string, content: Record<string, string> = {}) {
    void perform(
      () =>
        db.rpc("care_issue_action", {
          p_tenant: tenantId,
          p_issue: i.id,
          p_version: i.version,
          p_action: name,
          p_content: content,
        }),
      name === "approve"
        ? "Improvement approved. Emma has not changed yet."
        : "Saved. Your client’s progress has been updated.",
    );
  }
  function propose(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!issue) return;
    const f = new FormData(e.currentTarget);
    action(issue, "propose", {
      diagnosis: String(f.get("diagnosis")),
      proposal: String(f.get("proposal")),
      test_plan: String(f.get("test_plan")),
    });
  }
  return (
    <section className="care-root">
      <header className="care-intro">
        <div>
          <p className="op-eyebrow">OPENFOLK CARE · AI RECEPTIONIST</p>
          <h2>Keep every improvement moving.</h2>
          <p>
            Your client stays in control. OpenFolk checks the evidence and owns the follow-through.
          </p>
        </div>
        <ShieldCheck aria-hidden="true" size={30} />
      </header>
      {query.isPending && <p role="status">Opening the review desk…</p>}
      {query.isError && (
        <div role="alert">
          <p>{query.error.message}</p>
          <button onClick={() => void query.refetch()}>Try again</button>
        </div>
      )}
      {data && (
        <>
          <div className="care-metrics">
            <div>
              <span>Needs attention</span>
              <strong>{open.length}</strong>
              <small>
                {open.filter((i) => i.priority === "urgent").length} urgent ·{" "}
                {open.filter((i) => !i.owner_id).length} without an owner
              </small>
            </div>
            <div>
              <span>Ready for your decision</span>
              <strong>{open.filter((i) => i.stage === "approval").length}</strong>
              <small>Changes never approve themselves</small>
            </div>
            <div>
              <span>Review coverage</span>
              <strong>{data.reviewCount ?? "—"}</strong>
              <small>
                Saved assessments · not a count of all calls. Continuous monitoring awaits
                activation.
              </small>
            </div>
          </div>
          <nav className="care-tabs" aria-label="OpenFolk care">
            <button aria-pressed={tab === "queue"} onClick={() => setTab("queue")}>
              Review desk
            </button>
            <button aria-pressed={tab === "rules"} onClick={() => setTab("rules")}>
              Review rules
            </button>
            <button aria-pressed={tab === "alerts"} onClick={() => setTab("alerts")}>
              Alert channels
            </button>
          </nav>
          {error && (
            <p className="care-error" role="alert">
              {error}
            </p>
          )}
          {message && (
            <p className="care-success" role="status">
              {message}
            </p>
          )}
          {tab === "queue" && (
            <div className="care-desk">
              <div className="care-list">
                {data.issues.map((i) => (
                  <button
                    className="care-issue"
                    aria-pressed={i.id === selected}
                    key={i.id}
                    onClick={() => setSelected(i.id)}
                  >
                    <span>
                      {i.priority === "urgent" && <Bell size={15} />} {labels[i.stage]}
                    </span>
                    <strong>{i.title}</strong>
                    <small>
                      {date(i.created_at)}
                      {i.owner_id === user?.id
                        ? " · You’re on it"
                        : i.owner_id
                          ? " · Assigned"
                          : " · Needs an owner"}
                    </small>
                  </button>
                ))}
                {!data.issues.length && (
                  <p>No saved issues yet. Call-review coverage is shown separately above.</p>
                )}
              </div>
              <article className="care-detail">
                {issue ? (
                  <>
                    <p className="op-eyebrow">{labels[issue.stage]}</p>
                    <h3>{issue.title}</h3>
                    <p className="care-preserve">{issue.detail}</p>
                    <div className="care-client-message">
                      <strong>What your client sees</strong>
                      <p>{issue.customer_update}</p>
                    </div>
                    {admin &&
                      ["received", "reviewing"].includes(issue.stage) &&
                      issue.owner_id !== user?.id && (
                        <button disabled={busy} onClick={() => action(issue, "claim")}>
                          <UserCheck size={16} /> I’ll take this
                        </button>
                      )}
                    {admin &&
                      issue.owner_id === user?.id &&
                      ["reviewing", "approval", "approved"].includes(issue.stage) && (
                        <form key={`${issue.id}:${issue.version}`} onSubmit={propose}>
                          <label>
                            What happened?
                            <textarea
                              name="diagnosis"
                              required
                              minLength={5}
                              maxLength={10000}
                              defaultValue={issue.diagnosis}
                            />
                          </label>
                          <label>
                            What should change?
                            <textarea
                              name="proposal"
                              required
                              minLength={5}
                              maxLength={10000}
                              defaultValue={issue.proposal}
                            />
                          </label>
                          <label>
                            How will we prove it works?
                            <textarea
                              name="test_plan"
                              required
                              minLength={5}
                              maxLength={10000}
                              defaultValue={issue.test_plan}
                            />
                          </label>
                          <button disabled={busy}>
                            Save for approval <ArrowRight size={16} />
                          </button>
                        </form>
                      )}
                    {issue.proposal && (
                      <details>
                        <summary>Proposed improvement and test</summary>
                        <p className="care-preserve">{issue.proposal}</p>
                        <p className="care-preserve">{issue.test_plan}</p>
                      </details>
                    )}
                    {admin && issue.stage === "approval" && (
                      <button disabled={busy} onClick={() => action(issue, "approve")}>
                        <CheckCircle2 size={16} /> Approve this improvement
                      </button>
                    )}
                    {issue.stage === "approved" && (
                      <p className="care-note">
                        Approval is recorded. Release and verified retesting still need the
                        deployment connection; this has not changed Emma.
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <h3>Start with what needs you.</h3>
                    <p>
                      Choose an issue to see the evidence, take ownership and prepare a clear
                      improvement.
                    </p>
                  </>
                )}
              </article>
            </div>
          )}
          {tab === "rules" && (
            <form
              className="care-detail"
              key={data.settings?.version ?? 0}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void perform(
                  () =>
                    db.rpc("care_save_settings", {
                      p_tenant: tenantId,
                      p_version: data.settings?.version ?? 0,
                      p_rules: String(f.get("rules")),
                      p_enabled: f.get("enabled") === "on",
                    }),
                  "Review rules saved. This does not change Emma’s live instructions.",
                );
              }}
            >
              <h3>What should good look like?</h3>
              <p>
                Record approved opening hours, handover rules and expected responses. Callers cannot
                rewrite these rules.
              </p>
              <label>
                Approved review rules
                <textarea
                  name="rules"
                  required
                  maxLength={20000}
                  rows={10}
                  defaultValue={data.settings?.approved_rules ?? ""}
                  disabled={!admin}
                />
              </label>
              <label className="care-check">
                <input
                  name="enabled"
                  type="checkbox"
                  defaultChecked={data.settings?.enabled ?? false}
                  disabled={!admin}
                />{" "}
                Allow on-demand transcript review against these rules
              </label>
              <p className="care-note">
                Transcripts and feedback are reviewed by OpenAI. Audio stays in Vapi. No live
                instructions or routing are changed by review.
              </p>
              <button disabled={!admin || busy}>Save review rules</button>
              <CallReview
                tenantId={tenantId}
                enabled={admin && data.settings?.enabled === true}
                onDone={() => void query.refetch()}
              />
            </form>
          )}
          {tab === "alerts" && (
            <div className="care-route-grid">
              {["updates", "attention", "urgent"].map((kind) => {
                const route = data.routes.find((r) => r.kind === kind);
                return (
                  <form
                    className="care-detail"
                    key={`${kind}:${route?.channel_id}`}
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void perform(
                        () =>
                          db.rpc("care_save_alert_route", {
                            p_tenant: tenantId,
                            p_kind: kind,
                            p_team: String(f.get("team")).trim(),
                            p_channel: String(f.get("channel")).trim(),
                          }),
                        "Destination saved, awaiting verified Slack connection. No messages have been redirected.",
                      );
                    }}
                  >
                    <h3>
                      {kind === "updates"
                        ? "Improvements made"
                        : kind === "attention"
                          ? "Needs our attention"
                          : "Urgent incidents"}
                    </h3>
                    <p>
                      {route?.enabled
                        ? `Verified: #${route.verified_channel_name}`
                        : "Awaiting destination verification"}
                    </p>
                    <label>
                      OpenFolk workspace ID
                      <input
                        name="team"
                        required
                        pattern="T[A-Z0-9]+"
                        defaultValue={route?.team_id ?? ""}
                        disabled={!admin}
                      />
                    </label>
                    <label>
                      Channel ID
                      <input
                        name="channel"
                        required
                        pattern="C[A-Z0-9]+"
                        defaultValue={route?.channel_id ?? ""}
                        disabled={!admin}
                      />
                    </label>
                    <button disabled={!admin || busy}>Save destination</button>
                    {route && !route.enabled && (
                      <button
                        type="button"
                        disabled={!admin || busy}
                        onClick={() =>
                          void perform(async () => {
                            const r = await db.functions.invoke("receptionist-care", {
                              body: { tenantId, action: "verify_alert_route", kind },
                            });
                            return {
                              error: r.error || (r.data?.error ? { message: r.data.error } : null),
                            };
                          }, "Slack workspace and channel verified. A routing-test message was delivered.")
                        }
                      >
                        Verify and send a routing test
                      </button>
                    )}
                    <small>
                      Changing a destination pauses this route until its workspace and channel are
                      verified.
                    </small>
                  </form>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
function CallReview({
  tenantId,
  enabled,
  onDone,
}: {
  tenantId: string;
  enabled: boolean;
  onDone: () => void;
}) {
  const [callId, setCallId] = useState(""),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState("");
  return (
    <div className="care-on-demand">
      <h3>Review a completed call</h3>
      <label>
        Vapi call ID
        <input
          value={callId}
          onChange={(e) => setCallId(e.target.value)}
          placeholder="Call reference"
        />
      </label>
      <button
        type="button"
        disabled={!enabled || busy || !callId}
        onClick={async () => {
          setBusy(true);
          setResult("");
          try {
            const r = await getSupabaseClient().functions.invoke("receptionist-care", {
              body: { tenantId, callId },
            });
            if (r.error || r.data?.error)
              throw Error(
                r.data?.error ?? "Review unavailable. Check the connection and call reference.",
              );
            setResult(r.data.assessment.summary + " No changes were made to Emma.");
            onDone();
          } catch (e) {
            setResult(e instanceof Error ? e.message : "Review failed.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Checking the conversation…" : "Review this call"}
      </button>
      {result && <p role="status">{result}</p>}
    </div>
  );
}
