import { useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import { secureUrl, type ReceptionistCall } from "@/lib/receptionist-data";

export function CallRecording({
  tenant,
  call,
  demo,
  practiceSessionId,
}: {
  tenant: string;
  call: ReceptionistCall;
  demo: boolean;
  practiceSessionId?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [state, setState] = useState("");
  async function load() {
    if (busy) return;
    setBusy(true);
    setError("");
    setUrl(null);
    try {
      const result = await getSupabaseClient().functions.invoke(
        practiceSessionId ? "receptionist-practice" : "receptionist-calls",
        {
          body: {
            tenantId: tenant,
            action: "recording",
            callId: call.id,
            sessionId: practiceSessionId,
          },
        },
      );
      if (result.error || result.data?.error)
        throw Error(
          "The recording could not be retrieved. It may not have been recorded, may have expired, or the connection may need attention. Retry or ask OpenFolk to check this call.",
        );
      const fresh = secureUrl(result.data?.url);
      if (!fresh)
        throw Error(
          "Recording retrieval is not available on this server yet. OpenFolk needs to complete the recording-service update.",
        );
      setUrl(fresh);
      setState("Ready — press play below.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="rw-recording" aria-label="Call recording">
      <h3>Listen to the conversation</h3>
      <p className="rw-footnote">
        A fresh private playback link is requested when you open the recording. Your provider
        credentials never enter this page.
      </p>
      {demo ? (
        <p>Example only — no real recording.</p>
      ) : (
        <>
          <button className="rw-btn rw-btn-light" disabled={busy} onClick={() => void load()}>
            {busy ? "Retrieving recording…" : url || error ? "Reload recording" : "Open recording"}
          </button>
          {url && (
            <audio
              key={url}
              controls
              preload="metadata"
              src={url}
              aria-label="Play call recording"
              style={{ width: "100%", marginTop: 12 }}
              onCanPlay={() => setState("Ready — press play below.")}
              onPlaying={() => setState("Playing")}
              onWaiting={() =>
                setState("Buffering… If playback does not resume, reload the recording.")
              }
              onStalled={() =>
                setState(
                  "Playback is waiting for data. Reload the recording if it does not resume.",
                )
              }
              onError={() => {
                setError(
                  "Playback failed. Reload for a fresh link. If it still fails, ask OpenFolk to check this recording; a call duration alone does not prove audio is available.",
                );
                setState("");
              }}
            />
          )}
          {state && !error && (
            <p role="status" className="rw-footnote">
              {state}
            </p>
          )}
          {error && <p role="alert">{error}</p>}
        </>
      )}
    </section>
  );
}
