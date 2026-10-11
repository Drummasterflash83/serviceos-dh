import { useEffect, useRef, useState } from "react";
import type { LearnCommunicationClient } from "@/lib/learn-card-communications";
import {
  readSavedPhoneResults,
  phoneResultFreshnessText,
  type SavedPhoneResults,
} from "@/lib/learn-phone-saved-results";
export function LearnPhoneSavedResults(props: {
  tenantId: string;
  recordingId: string;
  client: LearnCommunicationClient;
}) {
  return <SavedResults key={`${props.tenantId}:${props.recordingId}`} {...props} />;
}
function SavedResults({
  tenantId,
  recordingId,
  client,
}: {
  tenantId: string;
  recordingId: string;
  client: LearnCommunicationClient;
}) {
  const [open, setOpen] = useState(false),
    [data, setData] = useState<SavedPhoneResults | null>(null),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const epoch = useRef(0),
    working = useRef(false);
  useEffect(() => {
    epoch.current++;
    working.current = false;
    setBusy(false);
    setData(null);
    setText("");
    setError("");
    return () => {
      epoch.current++;
    };
  }, [client]);
  async function load(more = false) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    const ticket = epoch.current;
    const prior = data?.transcript;
    if (!more) {
      setData(null);
      setText("");
    }
    try {
      if (more && !prior?.next_offset) throw Error("Missing cursor");
      const p = await readSavedPhoneResults(
        client,
        tenantId,
        recordingId,
        more ? { offset: prior!.next_offset!, sha256: prior!.sha256 } : undefined,
      );
      if (ticket !== epoch.current) return;
      if (more && (!p.transcript || p.transcript.id !== prior?.id))
        throw Error("Transcript changed");
      setData(p);
      setText((old) => (more ? old + (p.transcript?.text ?? "") : (p.transcript?.text ?? "")));
    } catch {
      if (ticket === epoch.current) {
        setData(null);
        setText("");
        setError(
          "Saved results could not be verified or changed while reading. Refresh to try again.",
        );
      }
    } finally {
      if (ticket === epoch.current) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <details
      className="mt-3"
      onToggle={(e) => {
        const shown = e.currentTarget.open;
        setOpen(shown);
        if (!shown) {
          epoch.current++;
          working.current = false;
          setBusy(false);
          setData(null);
          setText("");
          setError("");
        }
      }}
    >
      <summary>Saved transcript and analysis</summary>
      {open && (
        <div className="space-y-3 mt-2">
          <p>Retained results only. Reading does not start transcription or contact a provider.</p>
          <button
            type="button"
            className="cp-secondary"
            disabled={busy}
            onClick={() => void load()}
          >
            {data ? "Refresh saved results" : "Read saved results"}
          </button>
          {busy && <p role="status">Reading saved results…</p>}
          {error && <p role="status">{error}</p>}
          {data && (
            <>
              <p className="text-xs">
                Checked {new Date(data.checked_at).toLocaleString("en-GB", { timeZone: "UTC" })}{" "}
                UTC. Source matching uses retained provenance; it is not a fresh audio integrity
                check.
              </p>
              {!data.source_available ? (
                <p>This recording is unavailable with your current access.</p>
              ) : (
                <>
                  <h5>Transcript</h5>
                  {data.transcript ? (
                    <>
                      <p>{phoneResultFreshnessText[data.transcript.freshness]}</p>
                      <p className="text-xs">
                        Saved status: {data.transcript.status}. Updated{" "}
                        {new Date(data.transcript.updated_at).toLocaleString("en-GB", {
                          timeZone: "UTC",
                        })}{" "}
                        UTC.
                      </p>
                      {text ? (
                        <pre className="whitespace-pre-wrap break-words max-h-80 overflow-auto text-sm">
                          {text}
                        </pre>
                      ) : (
                        <p>No transcript text is retained.</p>
                      )}
                      <p className="text-xs">
                        {Array.from(text).length.toLocaleString()} of{" "}
                        {data.transcript.total_characters.toLocaleString()} characters loaded.
                      </p>
                      {data.transcript.next_offset !== null && (
                        <button
                          type="button"
                          className="cp-secondary"
                          disabled={busy}
                          onClick={() => void load(true)}
                        >
                          Read more transcript
                        </button>
                      )}
                    </>
                  ) : (
                    <p>
                      No saved transcript was found. This does not establish that the call had no
                      speech.
                    </p>
                  )}
                  <h5>AI analysis</h5>
                  {data.analysis ? (
                    <>
                      <p>{phoneResultFreshnessText[data.analysis.freshness]}</p>
                      <p>
                        AI-generated and advisory. Review the original communication before acting.
                      </p>
                      <p className="whitespace-pre-wrap break-words">
                        {data.analysis.summary || "No summary text is retained."}
                      </p>
                      {data.analysis.summary_truncated && (
                        <p>Summary shortened to 20,000 characters.</p>
                      )}
                    </>
                  ) : (
                    <p>No saved analysis was found.</p>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </details>
  );
}
