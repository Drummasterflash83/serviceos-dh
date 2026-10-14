import { useEffect, useRef, useState } from "react";
import { getSupabaseClient, supabaseConfig } from "@/lib/supabase";
import { searchOperatorJobs, type JobSearchPage } from "@/lib/learn-operator-job-search";
import {
  readSlackContext,
  readSavedSlackContext,
  resolveSavedSlackContext,
  type SlackContext,
  type SavedSlackContext,
} from "@/lib/learn-slack-work-context";

export function OperatorSlackWorkContext({
  tenantId,
  actorId,
  interactionId,
  accessReason,
}: {
  tenantId: string;
  actorId: string;
  interactionId: string;
  accessReason: string;
}) {
  const scope = { tenantId, actorId, backend: supabaseConfig.url };
  const scopeId = `${scope.backend}:${tenantId}:${actorId}:${interactionId}`;
  const active = useRef(scopeId);
  active.current = scopeId;
  const mounted = useRef(false);
  const generation = useRef(0);
  const [context, setContext] = useState<SlackContext | null>(null);
  const [jobs, setJobs] = useState<JobSearchPage | null>(null);
  const [job, setJob] = useState("");
  const [jobQuery, setJobQuery] = useState("");
  const [reason, setReason] = useState("");
  const [saved, setSaved] = useState<SavedSlackContext | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const allowed = () => mounted.current && active.current === scopeId && !document.hidden;
  useEffect(() => {
    mounted.current = true;
    setContext(null);
    setJobs(null);
    setJob("");
    setJobQuery("");
    setReason("");
    setMessage("");
    setError("");
    setBusy(false);
    try {
      setSaved(readSavedSlackContext(localStorage, scope, interactionId));
      setReady(Boolean(navigator.locks));
    } catch {
      setReady(false);
      setError("Saved review could not be read. Keep browser data and ask OpenFolk to check it.");
    }
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, [scopeId]);
  async function loadJobs(after: string | null = null) {
    const ticket = ++generation.current;
    setBusy(true);
    setJobs(null);
    setJob("");
    setContext(null);
    setError("");
    setMessage("");
    try {
      const result = await searchOperatorJobs(
        getSupabaseClient(),
        {
          tenant: tenantId,
          actor: actorId,
          query: after ? jobs!.query : jobQuery,
          reason: accessReason,
          after,
        },
        AbortSignal.timeout(15000),
      );
      if (allowed() && ticket === generation.current) setJobs(result);
    } catch {
      if (allowed() && ticket === generation.current)
        setError("Jobs could not be loaded. Check your access and try again.");
    } finally {
      if (allowed() && ticket === generation.current) setBusy(false);
    }
  }
  async function inspect() {
    const ticket = ++generation.current;
    setBusy(true);
    setContext(null);
    setError("");
    setMessage("");
    try {
      const result = await readSlackContext(
        getSupabaseClient(),
        scope,
        interactionId,
        job || null,
        accessReason,
      );
      if (allowed() && ticket === generation.current) setContext(result);
    } catch (e) {
      if (allowed() && ticket === generation.current)
        setError(e instanceof Error ? e.message : "Context is unavailable.");
    } finally {
      if (allowed() && ticket === generation.current) setBusy(false);
    }
  }
  async function resolve(mode: "apply" | "check" | "cancel") {
    if (!ready || busy) return;
    const ticket = ++generation.current;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const prior = readSavedSlackContext(localStorage, scope, interactionId);
      if (!prior && (mode !== "apply" || !context || reason.trim().length < 3))
        throw Error("Review current context and enter a reason first.");
      const draft: SavedSlackContext = prior ?? {
        version: 1,
        backend: scope.backend,
        request: {
          tenantId,
          actorId,
          interactionId,
          requestId: crypto.randomUUID(),
          definition: {
            revision: context!.revision,
            job_id: context!.job?.id ?? null,
            reason: reason.trim(),
          },
        },
      };
      const result = await resolveSavedSlackContext(
        getSupabaseClient(),
        localStorage,
        async (key, task) => {
          if (!navigator.locks) throw Error("Browser request locking unavailable.");
          return navigator.locks.request(key, task);
        },
        scope,
        interactionId,
        draft,
        mode,
        allowed,
      );
      if (!allowed() || ticket !== generation.current) return;
      setContext(null);
      setMessage(
        result.state === "committed"
          ? "Review recorded. Reload context to check the current source and link. This confirms the review, not AI analysis or complete Slack coverage."
          : result.state === "cancelled"
            ? "Unrecorded request cancelled. Review current context before making a new decision."
            : "No recorded result yet. Retry this saved request or cancel it before starting another review.",
      );
    } catch (e) {
      if (allowed() && ticket === generation.current)
        setError(e instanceof Error ? e.message : "Result could not be confirmed.");
    } finally {
      if (allowed() && ticket === generation.current) {
        setBusy(false);
        try {
          setSaved(readSavedSlackContext(localStorage, scope, interactionId));
        } catch {
          setReady(false);
          setError("Saved review needs inspection. Keep browser data.");
        }
      }
    }
  }
  return (
    <section className="my-4 space-y-3 rounded border p-4" aria-label="Slack work context">
      <h2 className="font-semibold">Slack work context</h2>
      <p className="text-sm">
        Review this conversation as company context or link it to a verified job. The original
        message stays retained; every decision is recorded.
      </p>
      {saved ? (
        <div className="space-y-2">
          <p>
            A saved review needs its result checked. Cancel only retires an unrecorded request; an
            already recorded decision remains in history.
          </p>
          <p className="text-sm">
            Saved choice:{" "}
            {saved.request.definition.job_id
              ? `Job ${saved.request.definition.job_id}`
              : "Company context"}{" "}
            · {saved.request.definition.reason}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              className="cp-secondary"
              disabled={busy || !ready}
              onClick={() => void resolve("check")}
            >
              Check saved review
            </button>
            <button
              className="cp-secondary"
              disabled={busy || !ready}
              onClick={() => void resolve("apply")}
            >
              Retry saved review
            </button>
            <button
              className="cp-secondary"
              disabled={busy || !ready}
              onClick={() => void resolve("cancel")}
            >
              Cancel unrecorded request
            </button>
          </div>
        </div>
      ) : (
        <>
          <label className="block">
            Find a published job
            <input
              className="mt-1 block w-full rounded border p-2"
              value={jobQuery}
              maxLength={120}
              placeholder="Job number, description, customer or address"
              disabled={busy}
              onChange={(e) => {
                generation.current++;
                setJobQuery(e.target.value);
                setJobs(null);
                setJob("");
                setContext(null);
                setMessage("");
                setError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void loadJobs();
                }
              }}
            />
          </label>
          <label className="block">
            Context
            <select
              className="mt-1 block w-full rounded border p-2"
              value={job}
              disabled={busy}
              onChange={(e) => {
                setJob(e.target.value);
                setContext(null);
                setMessage("");
              }}
            >
              <option value="">Company context — no verified job link</option>
              {jobs?.rows.map((row) => (
                <option key={row.id} value={row.id}>
                  {String(row.fields.job_number ?? "Job")} ·{" "}
                  {String(row.fields.title ?? "Untitled job")} ·{" "}
                  {String(row.fields.customer ?? "Customer unavailable")} ·{" "}
                  {String(row.fields.postcode ?? row.fields.address ?? "Address unavailable")} ·{" "}
                  {String(row.fields.status ?? "Status unavailable")}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="cp-secondary" disabled={busy} onClick={() => void loadJobs()}>
              Search jobs
            </button>
            {jobs?.next_after && (
              <button
                className="cp-secondary"
                disabled={busy}
                onClick={() => void loadJobs(jobs.next_after)}
              >
                Next 25 jobs
              </button>
            )}
            <button className="cp-secondary" disabled={busy} onClick={() => void inspect()}>
              Review current context
            </button>
          </div>
          {jobs && (
            <p className="text-sm">
              {jobs.rows.length === 0
                ? "No published jobs match this search."
                : `${jobs.rows.length} matching published jobs on this page.`}{" "}
              Retained imports may still need publication before appearing here. Check the job and
              customer before saving a link; a shared service code alone does not identify a job.
            </p>
          )}
        </>
      )}
      {context && (
        <div className="space-y-2 rounded border p-3">
          <p>
            Current review:{" "}
            {context.context?.state === "reviewed"
              ? `Reviewed as ${context.context.scope} context`
              : context.context?.state === "source_changed"
                ? "Source changed — review needed"
                : "Not yet reviewed"}
            .
          </p>
          <p>
            Current job link: {context.current_job_id ?? "None"}. Proposed:{" "}
            {context.job
              ? `${context.job.job_number ?? "Job"} · ${context.job.title}`
              : "Company context, without a job link"}
            .
          </p>
          <label className="block">
            Reason for this decision
            <textarea
              className="mt-1 block w-full rounded border p-2"
              value={reason}
              maxLength={500}
              disabled={busy}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button
            className="cp-primary"
            disabled={busy || !ready || Boolean(saved) || reason.trim().length < 3}
            onClick={() => void resolve("apply")}
          >
            Save reviewed context
          </button>
        </div>
      )}
      {busy && <p role="status">Checking Slack context…</p>}
      {!ready && !error && (
        <p>Secure browser storage and request locking are needed to save reviews.</p>
      )}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
