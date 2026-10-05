import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { getSupabaseClient } from "@/lib/supabase";
import { CheckCircle2, AlertCircle, Circle, Play, RefreshCw } from "lucide-react";
import { testEvidence, testNextAction } from "@/lib/receptionist-test-evidence";
import "@/styles/receptionist-testing.css";

type Check = { key: string; label: string; state: string; detail: string };
type Item = {
  id: string;
  name: string;
  status: string;
  passed: boolean;
  failure?: string;
  outcome?: string;
  evidenceIssue?: string;
  toolEvents?: { id: string | null; name: string | null; destination: string | null }[];
  transcript?: string;
  recordingUrl?: string;
  evaluations: unknown[];
};
type Run = {
  id: string;
  provider_id: string | null;
  state: string;
  created_at: string;
  assistant_hash: string;
  slack_state: string;
  report: { items?: Item[]; error?: string; configurationChanged?: boolean;
    harnessCheck?: { state: string; detail: string; checkedAt: string } };
};
type Status = {
  settings: { label: string; production: boolean };
  assistant: { name: string; hash: string; updatedAt: string };
  checks: Check[];
  suite: { name: string; scenarioCount: number };
  runs: Run[];
  budget?: { normalRunsPerRolling24Hours: number; launchAllowance: {
    maximumExtraRuns: number; remainingExtraRuns: number; expiresAt: string; serviceOnly: boolean;
  } | null };
  physicalChecks?: { id: string; label: string; detail: string; state: string; checkedAt: string; providerCallId: string }[];
};
const date = (s: string) =>
  new Date(s).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
const label = (s: string) =>
  ({
    passed: "Passed",
    failed: "Needs attention",
    running: "Running",
    preparing: "Starting",
    uncertain: "Check provider history",
    cancelled: "Cancelled",
    not_tested: "Not yet verified",
    queued: "Waiting to run",
    canceled: "Cancelled",
  })[s] ?? s;

// This report has no mailbox-sync or per-recipient receipt evidence yet.
// Never promote an aggregate simulation/delivery verdict into these four proofs.
// The named emergency mailbox and recipients are specific to the verified DH setup.
const dhVoicemailChecks = [
  {
    key: "connection",
    title: "Birchills message connection",
    detail: "Confirm a supported voicemail message feed and a successful mailbox sync. Ordinary call recordings are a separate source.",
  },
  {
    key: "emergency_message",
    title: "603 · Message saved and playable",
    detail: "Find the labelled test message in the emergency mailbox and play its saved recording. Hearing the greeting does not prove a message was saved.",
  },
  {
    key: "rob_receipt",
    title: "Rob · Notification received",
    detail: "Confirm the same test message reached Rob, with a receipt reference and time. An enabled notification setting is not a receipt.",
  },
  {
    key: "tony_receipt",
    title: "Tony · Notification received",
    detail: "Confirm the same test message reached Tony separately. Rob’s receipt does not prove Tony received his copy.",
  },
] as const;
export function ReceptionistTesting({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<Status | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const mounted = useRef(true),
    request = useRef(false);
  const invoke = useCallback(
    async (action: string, extra: Record<string, unknown> = {}) => {
      const result = await getSupabaseClient().functions.invoke("receptionist-testing", {
        body: { tenantId, action, ...extra },
      });
      if (result.error) {
        let message = "Testing is unavailable. Please try again.";
        try {
          const body = await result.error.context?.json();
          if (typeof body?.error === "string") message = body.error;
        } catch {
          /* no body */
        }
        throw Error(message);
      }
      if (result.data?.error) throw Error(result.data.error);
      return result.data;
    },
    [tenantId],
  );
  const load = useCallback(async () => {
    const next = await invoke("status");
    if (mounted.current) setData(next);
    return next as Status;
  }, [invoke]);
  const refresh = useCallback(async () => {
    if (request.current) return;
    request.current = true;
    try {
      const next = await load();
      for (const r of next.runs.filter(
        (r) => r.provider_id && ["running", "preparing"].includes(r.state),
      ))
        await invoke("refresh", { runId: r.id });
      await load();
      if (mounted.current) setError("");
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : "Could not load tests.");
    } finally {
      request.current = false;
    }
  }, [load, invoke]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 20000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [refresh]);
  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError("");
    try {
      await invoke(action, extra);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action could not complete.");
    } finally {
      setBusy(false);
    }
  }
  const active = data?.runs.some((r) => ["preparing", "running", "uncertain"].includes(r.state));
  const blocked = data?.checks.some(
    (c) => ["transfer_count", "voice"].includes(c.key) && c.state === "failed",
  );
  const showDhVoicemailChecks = tenantId === "00000000-0000-0000-0000-000000000001";
  return (
    <section className="of-tests" aria-label="Automated voice tests">
      <header className="of-test-card of-test-intro">
        <div>
          <p className="op-eyebrow">OPENFOLK · QUALITY CHECKS</p>
          <h2>Prove the change before the next caller.</h2>
          <p>
            Run a synthetic caller through Emma’s voice, review the evidence, then complete the real
            phone checks.
          </p>
        </div>
        <div className="of-test-actions">
          <button
            className="op-button"
            disabled={!data || busy || active || blocked}
            onClick={() => void act("run", { expectedHash: data?.assistant.hash })}
          >
            <Play size={16} />
            Run voice checks
          </button>
          <button className="op-button-secondary" disabled={busy} onClick={() => void refresh()}>
            <RefreshCw size={16} />
            Check results
          </button>
        </div>
        <p className="of-test-note">
          Uses Vapi credits. One run at a time, normally up to 8 runs in a rolling 24 hours. Action tools are intercepted:
          these tests do not ring the team or change the live assistant.
        </p>
        {data?.budget?.launchAllowance && (
          <p className="of-test-note">
            One-off launch allowance: {data.budget.launchAllowance.remainingExtraRuns} of {data.budget.launchAllowance.maximumExtraRuns} extra
            {" "}isolated runs remain until {date(data.budget.launchAllowance.expiresAt)}. OpenFolk service maintenance only; normal safeguards stay in place.
          </p>
        )}
      </header>
      {error && (
        <p className="op-error" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Checking Emma’s current configuration…</p>}
      {data && (
        <>
          <div className="of-test-card">
            <h3>Launch checks</h3>
            <p>
              {data.assistant.name} ·{" "}
              {data.settings.production ? "Current live configuration" : "Test configuration"} ·
              updated {date(data.assistant.updatedAt)}
            </p>
            <div className="of-test-checks">
              {data.checks.filter((c) => !showDhVoicemailChecks || c.key !== "delivery").map((c) => (
                <div key={c.key} className={`of-test-check of-test-${c.state}`}>
                  {c.state === "passed" ? (
                    <CheckCircle2 size={20} />
                  ) : c.state === "failed" ? (
                    <AlertCircle size={20} />
                  ) : (
                    <Circle size={20} />
                  )}
                  <div>
                    <strong>{c.label}</strong>
                    <p>{c.detail}</p>
                  </div>
                  <span>{label(c.state)}</span>
                </div>
              ))}
            </div>
          </div>
          {showDhVoicemailChecks && (
            <section className="of-test-card" aria-labelledby="voicemail-launch-evidence">
              <div className="of-test-delivery-heading">
                <div>
                  <h3 id="voicemail-launch-evidence">Voicemail · what still needs proof</h3>
                  <p>These four outcomes are not yet evidenced in this testing report. Passing voice checks does not confirm mailbox or email delivery.</p>
                </div>
                <Link
                  className="of-test-inbox-link"
                  to="/openfolk/$tenantId"
                  params={{ tenantId }}
                  search={{ module: "receptionist", view: "voicemails", tools: false }}
                >
                  Open voicemail inbox <span aria-hidden="true">→</span>
                </Link>
              </div>
              <div className="of-test-delivery-grid">
                {dhVoicemailChecks.map((check) => (
                  <div className="of-test-delivery-item" key={check.key}>
                    <span className="of-test-awaiting"><Circle size={15} aria-hidden="true" /> Awaiting evidence</span>
                    <h4>{check.title}</h4>
                    <p>{check.detail}</p>
                  </div>
                ))}
              </div>
              <p className="of-test-note">Next: complete the Birchills message connection, then verify one controlled 603 message and both recipients. Office mailbox 601 and personal mailboxes 109/105 remain separate.</p>
            </section>
          )}
          {!!data.physicalChecks?.length && (
            <div className="of-test-card">
              <h3>Real phone checks</h3>
              <p>Recorded observations from authorised calls to the actual Birchills numbers. These are separate from the simulated voice checks.</p>
              <div className="of-test-checks">
                {data.physicalChecks.map(c => (
                  <div key={c.id} className={`of-test-check ${c.state === "needs_attention" ? "of-test-failed" : "of-test-not_tested"}`}>
                    {c.state === "needs_attention" ? <AlertCircle size={20} /> : <Circle size={20} />}
                    <div><strong>{c.label}</strong><p>{c.detail}</p><p className="of-test-note">{date(c.checkedAt)} · Call {c.providerCallId.slice(0, 8)}</p></div>
                    <span>{c.state === "needs_attention" ? "Needs attention" : "Observed"}</span>
                  </div>
                ))}
              </div>
              <p className="of-test-note">Still to prove: two-way handset audio, emergency primary/backup order, emergency mailbox 603 and receipt by both engineers. No automatic live calls run from this page.</p>
            </div>
          )}
          <div className="of-test-card">
            <h3>Voice evidence</h3>
            <p>
              {data.suite.name} · {data.suite.scenarioCount} scenario
              {data.suite.scenarioCount === 1 ? "" : "s"}
            </p>
            <p className="of-test-note">
              A passing simulation is not launch approval. Real handsets, voicemail receipts,
              emergency cover and caller-side network quality still need separate evidence.
            </p>
            {!data.runs.length && (
              <p>No saved OpenFolk runs yet. Earlier Vapi-only runs are not shown here.</p>
            )}
            {data.runs.map((r) => (
              <details className="of-test-run" key={r.id}>
                <summary>
                  <span
                    className={`of-test-state of-test-${r.assistant_hash !== data.assistant.hash ? "not_tested" : r.state}`}
                  >
                    {r.assistant_hash !== data.assistant.hash
                      ? "Previous configuration"
                      : label(r.state)}
                  </span>
                  <strong>{date(r.created_at)}</strong>
                  <span>
                    {r.report.items?.filter((i) => i.passed).length ?? 0}/
                    {r.report.items?.length ?? 0} scenarios passed
                    {r.assistant_hash !== data.assistant.hash ? " at the time" : ""}
                    {!!r.report.items?.filter((i) => i.outcome === "blocked_funding").length &&
                      ` · ${r.report.items.filter((i) => i.outcome === "blocked_funding").length} not started (credit)`}
                  </span>
                </summary>
                <div className="of-test-run-body">
                  {r.assistant_hash !== data.assistant.hash && (
                    <p className="op-error">
                      Emma has changed since this run. These results do not verify the current
                      version.
                    </p>
                  )}
                  <p>
                    Slack:{" "}
                    {r.slack_state === "sent"
                      ? "Accepted by Slack"
                      : r.slack_state === "pending"
                        ? "Awaiting completed results"
                        : r.slack_state === "needs_review"
                          ? "Delivery needs review"
                          : r.slack_state}
                    .
                  </p>
                  {r.report.error && <p role="alert">{r.report.error}</p>}
                  {r.report.harnessCheck && (
                    <p className={["changed", "unavailable"].includes(r.report.harnessCheck.state) ? "op-error" : undefined}>
                      Test setup: {r.report.harnessCheck.detail}
                    </p>
                  )}
                  {r.provider_id && (
                    <a
                      href={`https://dashboard.vapi.ai/simulations/run/${r.provider_id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open provider evidence ↗
                    </a>
                  )}
                  {r.provider_id && !["running", "preparing"].includes(r.state) && (
                    <button
                      className="op-button-secondary"
                      disabled={busy}
                      onClick={() => void act("refresh", { runId: r.id })}
                    >
                      Refresh evidence & recordings
                    </button>
                  )}
                  {r.state === "running" && (
                    <button
                      className="op-button-secondary"
                      disabled={busy}
                      onClick={() => void act("cancel", { runId: r.id })}
                    >
                      Stop this test run
                    </button>
                  )}
                  {r.report.items?.map((i) => (
                    <article className="of-test-item" key={i.id}>
                      <div className="of-test-item-heading">
                        <h4>{i.name}</h4>
                        <span
                          className={`of-test-state of-test-${i.passed ? "passed" : ["passed", "failed"].includes(i.status) ? "failed" : "not_tested"}`}
                        >
                          {i.passed
                            ? "Simulation passed"
                            : i.outcome === "blocked_funding"
                              ? "Not started — credit unavailable"
                              : i.status === "passed"
                                ? "Needs attention"
                                : label(i.status)}
                        </span>
                      </div>
                      {i.outcome === "blocked_funding" && (
                        <p>
                          This was a funding block, not a conversation-quality result. Fund the
                          account, then run a new test.
                        </p>
                      )}
                      {i.failure && <p className="op-error">{i.failure}</p>}
                      {i.evidenceIssue && <p className="op-error">{i.evidenceIssue}</p>}
                      <div
                        className="of-test-evidence-grid"
                        aria-label={`${i.name} evidence coverage`}
                      >
                        {testEvidence(i).map((assessment) => (
                          <div key={assessment.key} className="of-test-evidence">
                            <h5>{assessment.title}</h5>
                            <strong className={`of-test-${assessment.state}`}>
                              {assessment.state === "passed" ? (
                                <CheckCircle2 size={16} />
                              ) : assessment.state === "failed" ? (
                                <AlertCircle size={16} />
                              ) : (
                                <Circle size={16} />
                              )}
                              {assessment.label}
                            </strong>
                            <p>{assessment.detail}</p>
                          </div>
                        ))}
                      </div>
                      <div className="of-test-next-action">
                        <strong>Next step</strong>
                        <p>{testNextAction(i)}</p>
                      </div>
                      {!!i.toolEvents?.length && (
                        <details>
                          <summary>Actions attempted ({i.toolEvents.length})</summary>
                          <ul>
                            {i.toolEvents.map((e, n) => (
                              <li key={`${e.id}-${n}`}>
                                {e.name ?? "Unnamed action"}
                                {e.destination ? ` → ${e.destination}` : ""}
                              </li>
                            ))}
                          </ul>
                          <p className="of-test-note">
                            Intercepted test actions — not proof of a real handover.
                          </p>
                        </details>
                      )}
                      {i.recordingUrl && (
                        <div className="of-test-recording">
                          <strong>Listen to the test</strong>
                          <p className="of-test-note">
                            Includes Emma and an AI-generated caller with a different voice. Audio
                            plays only when you press play.
                          </p>
                          <audio
                            controls
                            preload="none"
                            src={i.recordingUrl}
                            aria-label={`${i.name} recording`}
                          />
                        </div>
                      )}
                      {!i.recordingUrl && ["passed", "failed"].includes(i.status) && (
                        <p className="of-test-note">
                          No recording returned for this scenario. Voice clarity has not been
                          verified.
                        </p>
                      )}
                      <details>
                        <summary>Read the transcript</summary>
                        <pre>{i.transcript || "No transcript returned."}</pre>
                      </details>
                      <details className="of-test-diagnostics">
                        <summary>Technical assessment details</summary>
                        <p className="of-test-note">
                          Provider scoring and rubric definitions for investigation. OpenFolk’s
                          independent checks can override a provider pass.
                        </p>
                        <pre>{JSON.stringify(i.evaluations, null, 2)}</pre>
                      </details>
                    </article>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
