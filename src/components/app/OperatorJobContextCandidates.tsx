import { useEffect, useRef, useState } from "react";
import { getSupabaseClient, supabaseConfig } from "@/lib/supabase";
import {
  readJobContextCandidates,
  type JobContextPage,
} from "@/lib/new-dawn-job-context-candidates";

export function OperatorJobContextCandidates({ tenantId, actorId, jobId, reason }: {
  tenantId: string;
  actorId: string;
  jobId: string;
  reason: string;
}) {
  const [page, setPage] = useState<JobContextPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const scope = `${supabaseConfig.url}:${tenantId}:${actorId}:${jobId}:${reason}`;
  useEffect(() => {
    setPage(null);
    setError("");
    setBusy(false);
    const hide = () => {
      if (document.hidden) {
        request.current?.abort();
        setPage(null);
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      request.current?.abort();
      document.removeEventListener("visibilitychange", hide);
    };
  }, [scope]);
  async function load() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPage(null);
    setError("");
    setBusy(true);
    try {
      const result = await readJobContextCandidates(getSupabaseClient(), {
        tenant: tenantId, actor: actorId, job: jobId, reason,
      }, AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]));
      if (!controller.signal.aborted && !document.hidden) setPage(result);
    } catch {
      if (!controller.signal.aborted && !document.hidden)
        setError("Context could not be checked. It may be unavailable or still awaiting source review.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return <section className="mt-4 space-y-2 rounded border p-3" aria-label="Job communication context review">
    <h3 className="font-semibold">Possible communication context</h3>
    <p className="text-sm">OpenFolk review only. Shared customer evidence can suggest records to inspect; it does not prove they belong to this job. No link, score or payment state changes here.</p>
    <button type="button" className="cp-secondary" disabled={busy || reason.trim().length < 3} onClick={() => void load()}>
      {busy ? "Checking retained context…" : "Check retained context"}
    </button>
    {error && <p role="status">{error}</p>}
    {page && <div className="space-y-2 text-sm">
      <p>Commusoft source job {page.commusoft_job_source_id} · checked {new Date(page.read_at).toLocaleString("en-GB")} · audited read {page.audit_id}</p>
      <p>Job freshness and all proposed job links remain unverified. Financial association is held.</p>
      {page.candidates.length === 0 ? <p>No retained communications matched this job’s reviewed customer identity in the last 90 days.</p> :
        <ul className="space-y-2">{page.candidates.map((item) => <li key={item.interaction_id} className="rounded border p-2">
          {item.source_table.replaceAll("_", " ")} · {new Date(item.occurred_at).toLocaleString("en-GB")} · reviewed customer {item.customer_evidence.replaceAll("_", " + ")} · job unverified
          <span className="block break-all text-xs">Interaction {item.interaction_id}</span>
        </li>)}</ul>}
      {page.has_more && <p>More possible context exists outside this 20-record page.</p>}
    </div>}
  </section>;
}
