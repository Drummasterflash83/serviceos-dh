import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import { CheckCircle2, AlertCircle, Circle, Play, RefreshCw } from "lucide-react";
import "@/styles/receptionist-testing.css";

type Check = { key: string; label: string; state: string; detail: string };
type Item = {
  id: string;
  name: string;
  status: string;
  passed: boolean;
  failure?: string;
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
  report: { items?: Item[]; error?: string; configurationChanged?: boolean };
};
type Status = {
  settings: { label: string; production: boolean };
  assistant: { name: string; hash: string; updatedAt: string };
  checks: Check[];
  suite: { name: string; scenarioCount: number };
  runs: Run[];
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
  })[s] ?? s;
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
          Uses Vapi credits. One run at a time, up to 8 runs a day. Action tools are intercepted:
          these tests do not ring the team or change the live assistant.
        </p>
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
              {data.checks.map((c) => (
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
                    {r.assistant_hash !== data.assistant.hash ? "Previous configuration" : label(r.state)}
                  </span>
                  <strong>{date(r.created_at)}</strong>
                  <span>
                    {r.report.items?.filter((i) => i.passed).length ?? 0}/
                    {r.report.items?.length ?? 0} passed
                    {r.assistant_hash !== data.assistant.hash ? " at the time" : ""}
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
                      ? "Delivered"
                      : r.slack_state === "pending"
                        ? "Awaiting completed results"
                        : r.slack_state === "needs_review"
                          ? "Delivery needs review"
                          : r.slack_state}
                    .
                  </p>
                  {r.report.error && <p role="alert">{r.report.error}</p>}
                  {r.provider_id && (
                    <a
                      href={`https://dashboard.vapi.ai/simulations/run/${r.provider_id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open provider evidence ↗
                    </a>
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
                      <h4>
                        {i.name} · {i.passed ? "Passed" : label(i.status)}
                      </h4>
                      {i.failure && <p className="op-error">{i.failure}</p>}
                      {i.recordingUrl && (
                        <audio
                          controls
                          preload="none"
                          src={i.recordingUrl}
                          aria-label={`${i.name} recording`}
                        />
                      )}
                      {!i.recordingUrl && ["passed", "failed"].includes(i.status) && (
                        <p className="of-test-note">
                          No recording returned for this scenario. Voice clarity has not been
                          verified.
                        </p>
                      )}
                      <details>
                        <summary>Transcript & assessment</summary>
                        <pre>{i.transcript || "No transcript returned."}</pre>
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
