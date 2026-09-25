import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import { secureUrl, type ReceptionistCall } from "@/lib/receptionist-data";

async function recordingUrl(tenant: string, callId: string, practiceSessionId?: string) {
  const result = await getSupabaseClient().functions.invoke(
    practiceSessionId ? "receptionist-practice" : "receptionist-calls",
    { body: { tenantId: tenant, action: "recording", callId, sessionId: practiceSessionId } },
  );
  if (result.error || result.data?.error) throw Error("Recording not available yet");
  const fresh = secureUrl(result.data?.url);
  if (!fresh) throw Error("Recording link unavailable");
  return fresh;
}

export function CallRecording({
  tenant,
  call,
  demo,
  practiceSessionId,
  autoLoad = false,
}: {
  tenant: string;
  call: ReceptionistCall;
  demo: boolean;
  practiceSessionId?: string;
  autoLoad?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [state, setState] = useState("");
  useEffect(() => {
    if (!autoLoad || demo) return;
    let cancelled = false;
    setBusy(true);
    void (async () => {
      for (let attempt = 0; attempt < 5 && !cancelled; attempt++) {
        try {
          const fresh = await recordingUrl(tenant, call.id, practiceSessionId);
          if (!cancelled) {
            setUrl(fresh);
            setError("");
            setState("Ready — press play below.");
          }
          break;
        } catch {
          if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 3000));
          else if (!cancelled) setError("Recording is not ready. Try reloading it shortly.");
        }
      }
      if (!cancelled) setBusy(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [autoLoad, call.id, demo, practiceSessionId, tenant]);
  async function load() {
    if (busy) return;
    setBusy(true);
    setError("");
    setUrl(null);
    try {
      const fresh = await recordingUrl(tenant, call.id, practiceSessionId);
      setUrl(fresh);
      setState("Ready — press play below.");
    } catch (e) {
      setError(
        "The recording could not be retrieved. It may still be processing; retry shortly or ask OpenFolk to check this call.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="rw-recording" aria-label="Call recording">
      <h3>Listen to the conversation</h3>
      {!autoLoad && (
        <p className="rw-footnote">
          A fresh private playback link is requested when you open the recording.
        </p>
      )}
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
