import { useEffect, useRef, useState } from "react";
import { getSupabaseClient, supabaseConfig } from "@/lib/supabase";
import { readSlackEvidence, type SlackEvidencePage } from "@/lib/learn-slack-evidence";
import { LearnSlackSource } from "./LearnSlackSource";

export function LearnSlackEvidence(props: {
  tenantId: string;
  actorId: string;
  operatorReason?: string;
}) {
  return (
    <EvidenceBrowser
      key={`${supabaseConfig.url}:${props.tenantId}:${props.actorId}:${props.operatorReason ?? ""}`}
      {...props}
    />
  );
}
function EvidenceBrowser({
  tenantId,
  actorId,
  operatorReason,
}: {
  tenantId: string;
  actorId: string;
  operatorReason?: string;
}) {
  const [page, setPage] = useState<SlackEvidencePage | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [cursor, setCursor] = useState<string | null>(null),
    [selected, setSelected] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null),
    generation = useRef(0);
  function clear() {
    generation.current++;
    request.current?.abort();
    setPage(null);
    setSelected(null);
    setBusy(false);
  }
  useEffect(() => {
    const hide = () => {
      if (document.hidden) {
        clear();
        setError("This evidence view was closed. Load it again to recheck access.");
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      generation.current++;
      request.current?.abort();
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);
  useEffect(() => {
    if (!page) return;
    const timer = setTimeout(
      () => {
        clear();
        setError("This evidence view expired. Load it again to recheck access.");
      },
      Math.max(0, 60000 - (Date.now() - Date.parse(page.observed_at))),
    );
    return () => clearTimeout(timer);
  }, [page]);
  async function load(after: string | null = null) {
    clear();
    const controller = new AbortController();
    request.current = controller;
    const ticket = ++generation.current;
    setCursor(after);
    setBusy(true);
    setError("");
    try {
      const result = await readSlackEvidence(
        getSupabaseClient(),
        { tenant: tenantId, actor: actorId, after, operatorReason },
        AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      );
      if (ticket === generation.current && !document.hidden) setPage(result);
    } catch {
      if (ticket === generation.current)
        setError(
          "Saved Slack evidence is unavailable with your current access. Refresh to try again.",
        );
    } finally {
      if (ticket === generation.current) setBusy(false);
    }
  }
  const allowed = operatorReason === undefined || operatorReason.trim().length >= 3;
  const when = (v: string) => new Date(v).toLocaleString("en-GB", { timeZone: "Europe/London" });
  return (
    <section className="space-y-4" aria-label="Public Slack evidence">
      <p>
        Saved observations from public channel messages, awaiting customer or job attribution. These
        are rules-based observations, not completed work, AI summaries or employee scores.
      </p>
      <p>
        Only messages with a saved observation and a verified current source appear here. Other
        retained messages, private/shared channels and direct messages are not included in this
        list.
      </p>
      <button className="cp-secondary" disabled={busy || !allowed} onClick={() => void load()}>
        {busy ? "Checking saved evidence…" : "Load Slack evidence"}
      </button>
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button
            className="cp-secondary"
            disabled={busy || !allowed}
            onClick={() => void load(cursor)}
          >
            Retry this page
          </button>
        </div>
      )}
      {page && (
        <>
          <p className="text-sm">
            {page.rows.length} observations on this page · checked {when(page.observed_at)} (UK
            time). This is not a total of all Slack learning or historical coverage.
          </p>
          {page.rows.length === 0 && (
            <p role="status">
              {page.next_after
                ? "No accessible observations in this part of the list. Continue to check the next part."
                : "No accessible current public Slack observations were found in this part of the list."}
            </p>
          )}
          {page.rows.map((row) => (
            <article key={row.id} className="rounded border p-4 space-y-3">
              <h3 className="font-semibold">{row.summary || "Saved company observation"}</h3>
              <p className="text-sm">
                Message dated {when(row.posted_at)} (UK time) · channel {row.channel_id}
              </p>
              <p className="whitespace-pre-wrap break-words">{row.excerpt}</p>
              <p className="text-sm">
                Customer, person and job: not yet attributed. A historical request may already be
                resolved.
              </p>
              <button
                className="cp-secondary"
                aria-expanded={selected === row.id}
                onClick={() => setSelected(selected === row.id ? null : row.id)}
              >
                {selected === row.id ? "Close evidence" : "Open observation evidence"}
              </button>
              {selected === row.id && (
                <>
                  <p className="text-sm">
                    Observation saved {when(row.recorded_at)} (UK time). Opening its message
                    rechecks your access and the source revision.
                  </p>
                  <LearnSlackSource
                    tenantId={tenantId}
                    actorId={actorId}
                    sourceId={row.source_id}
                    operatorReason={operatorReason}
                    expectedSourceVersion={row.source_version}
                  />
                </>
              )}
            </article>
          ))}
          {page.next_after && (
            <button
              className="cp-secondary"
              disabled={busy || !allowed}
              onClick={() => void load(page.next_after)}
            >
              Next evidence page
            </button>
          )}
        </>
      )}
    </section>
  );
}
