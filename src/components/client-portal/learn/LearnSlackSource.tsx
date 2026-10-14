import { useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import { readSlackCardSource, type SlackSource } from "@/lib/learn-slack-card-source";
export function LearnSlackSource(props: {
  tenantId: string;
  actorId: string;
  sourceId: string;
  operatorReason?: string;
}) {
  return (
    <SlackSourceView
      key={`${props.tenantId}:${props.actorId}:${props.sourceId}:${props.operatorReason ?? ""}`}
      {...props}
    />
  );
}
function SlackSourceView({
  tenantId,
  actorId,
  sourceId,
  operatorReason,
}: {
  tenantId: string;
  actorId: string;
  sourceId: string;
  operatorReason?: string;
}) {
  const [open, setOpen] = useState(false),
    [data, setData] = useState<SlackSource | null>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    request.current = controller;
    let active = true;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    setData(null);
    setError("");
    void readSlackCardSource(
      getSupabaseClient(),
      { tenant: tenantId, actor: actorId, id: sourceId, operatorReason },
      AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
    ).then(
      (result) => {
        if (!active) return;
        setData(result.record);
        expiry = setTimeout(() => {
          setData(null);
          setError("This source view expired. Refresh to recheck access.");
        }, 60000);
      },
      () => {
        if (active)
          setError(
            "This Slack source is unavailable with your current access. Retained history may need checking.",
          );
      },
    );
    return () => {
      active = false;
      controller.abort();
      if (expiry) clearTimeout(expiry);
    };
  }, [open, revision, tenantId, actorId, sourceId, operatorReason]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) {
        request.current?.abort();
        setData(null);
        setOpen(false);
        setError("");
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);
  const when = (v: string) => new Date(v).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC";
  return (
    <section className="lc-source-evidence" aria-label="Retained Slack message">
      <button
        type="button"
        className="cp-secondary"
        onClick={() => {
          setOpen((v) => !v);
          setData(null);
          setError("");
        }}
      >
        {open ? "Close Slack message" : "Read retained Slack message"}
      </button>
      {open && (
        <>
          <p>
            Retained message captured from a public channel. Historical requests may already be
            resolved. This does not fetch from Slack or confirm complete history.
          </p>
          {error ? (
            <div role="status">
              <p>{error}</p>
              <button
                type="button"
                className="cp-secondary"
                onClick={() => setRevision((v) => v + 1)}
              >
                Refresh Slack source
              </button>
            </div>
          ) : data ? (
            <>
              <p>
                <strong>Message dated {when(data.posted_at)}</strong>
              </p>
              <blockquote className="whitespace-pre-wrap break-words">
                {data.message_text || "No message text was retained."}
              </blockquote>
              {data.text_shortened && <p>Message shortened to 40,000 characters.</p>}
              <dl>
                <div>
                  <dt>Channel reference</dt>
                  <dd>{data.channel_id}</dd>
                </div>
                <div>
                  <dt>Slack author reference</dt>
                  <dd>{data.author_ref ?? "Not available"}</dd>
                </div>
              </dl>
              <p>
                Slack references do not establish a person's customer identity or work ownership.
              </p>
              <details>
                <summary>Slack source provenance</summary>
                <p>Workspace: {data.team_id}</p>
                <p>Message timestamp: {data.provider_timestamp}</p>
                <p>Thread timestamp: {data.thread_timestamp ?? "No thread reference retained"}</p>
                <p>Retained record updated: {when(data.retained_at)}</p>
                <p className="break-all">Revision: {data.source_version}</p>
                <p>Source record: {sourceId}</p>
              </details>
            </>
          ) : (
            <p role="status">Reading retained Slack message…</p>
          )}
        </>
      )}
    </section>
  );
}
