import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { getSupabaseClient, supabaseConfig } from "@/lib/supabase";
import { LearnPhoneSavedResults } from "./LearnPhoneSavedResults";
import {
  readRetainedRecordings,
  openRetainedRecording,
  type PhoneRecordingSource,
  type PhonePlaybackClient,
  type RetainedRecording,
  type PhoneOperatorAccess,
} from "@/lib/learn-phone-playback";
export function LearnPhoneAudio(props: {
  tenantId: string;
  table: PhoneRecordingSource;
  sourceId: string;
}) {
  const { user, profile } = useAuth();
  if (!user || profile?.tenant_id !== props.tenantId || !["owner", "admin"].includes(profile.role))
    return null;
  return (
    <PhoneAudioViewer
      key={`${props.tenantId}:${user.id}:${props.table}:${props.sourceId}`}
      {...props}
      client={getSupabaseClient()}
      backend={supabaseConfig.url}
    />
  );
}
/** URLs stay in memory. Unmount on identity/source changes stops and clears audio. */
type ViewerProps = {
  tenantId: string;
  table: PhoneRecordingSource;
  sourceId: string;
  client: PhonePlaybackClient;
  backend: string;
  operator?: PhoneOperatorAccess;
};
export function PhoneAudioViewer(props: ViewerProps) {
  return (
    <ScopedPhoneAudioViewer
      key={`${props.backend}:${props.tenantId}:${props.table}:${props.sourceId}:${props.operator?.actor ?? ""}:${props.operator?.reason ?? ""}`}
      {...props}
    />
  );
}
function ScopedPhoneAudioViewer({
  tenantId,
  table,
  sourceId,
  client,
  backend,
  operator,
}: ViewerProps) {
  const [rows, setRows] = useState<RetainedRecording[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [playing, setPlaying] = useState<{ id: string; url: string } | null>(null);
  const generation = useRef(0),
    working = useRef(false),
    audio = useRef<HTMLAudioElement | null>(null);
  const stop = () => {
    const a = audio.current;
    if (a) {
      a.pause();
      a.removeAttribute("src");
      a.load();
    }
  };
  const bindAudio = useCallback((element: HTMLAudioElement | null) => {
    const previous = audio.current;
    if (previous && previous !== element) {
      previous.pause();
      previous.removeAttribute("src");
      previous.load();
    }
    audio.current = element;
  }, []);
  useEffect(() => {
    generation.current++;
    working.current = false;
    setBusy(false);
    setRows([]);
    setCursor(null);
    setLoaded(false);
    setError("");
    stop();
    setPlaying(null);
    return () => {
      generation.current++;
      stop();
    };
  }, [tenantId, table, sourceId, client, backend]);
  useEffect(() => {
    const hide = () => {
      if (!document.hidden) return;
      generation.current++;
      working.current = false;
      setBusy(false);
      stop();
      setPlaying(null);
      setRows([]);
      setCursor(null);
      setLoaded(false);
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);
  async function load(after: string | null = null) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    const ticket = generation.current;
    if (after === null) {
      stop();
      setPlaying(null);
      setRows([]);
      setCursor(null);
      setLoaded(false);
    }
    try {
      const p = await readRetainedRecordings(client, tenantId, table, sourceId, after, operator);
      if (ticket !== generation.current) return;
      setRows((old) =>
        after ? [...old, ...p.rows.filter((r) => !old.some((o) => o.id === r.id))] : p.rows,
      );
      setCursor(p.next_cursor);
      setLoaded(true);
    } catch {
      if (ticket === generation.current) {
        setRows([]);
        setCursor(null);
        setLoaded(false);
        setError("Recordings could not be checked. Try again.");
      }
    } finally {
      if (ticket === generation.current) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  async function open(id: string) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    stop();
    setPlaying(null);
    const ticket = generation.current;
    try {
      const link = await openRetainedRecording(client, tenantId, id, backend, Date.now, operator);
      if (ticket === generation.current) setPlaying({ id, url: link.url });
    } catch {
      if (ticket === generation.current)
        setError("Audio is unavailable with your current access. Try opening it again.");
    } finally {
      if (ticket === generation.current) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <section className="mt-3 space-y-3" aria-label="Saved call audio">
      <button type="button" className="cp-secondary" disabled={busy} onClick={() => void load()}>
        {loaded ? "Refresh recordings" : "Check saved recordings"}
      </button>
      {busy && <p role="status">Checking recording access…</p>}
      {error && <p role="status">{error}</p>}
      {loaded && !rows.length && (
        <p>
          No retained recordings were found for this source. This does not confirm that the provider
          recorded no audio.
        </p>
      )}
      {rows.map((r, i) => (
        <div key={r.id} className="rounded-lg border p-3 space-y-2">
          <p>
            Recording {i + 1}
            {r.started_at
              ? " · " + new Date(r.started_at).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC"
              : ""}
            {r.duration_seconds !== null ? " · " + r.duration_seconds + " seconds" : ""}
          </p>
          {r.audio_stored ? (
            <button
              type="button"
              className="cp-secondary"
              disabled={busy}
              onClick={() => void open(r.id)}
            >
              {playing?.id === r.id ? "Open audio again" : "Open saved audio"}
            </button>
          ) : (
            <p>Audio has not been saved for this recording.</p>
          )}
          {playing?.id === r.id && (
            <audio
              ref={bindAudio}
              controls
              preload="none"
              src={playing.url}
              aria-label={`Saved recording ${i + 1}`}
              onError={() => {
                stop();
                setPlaying(null);
                setError("Audio could not play. Open saved audio again to refresh access.");
              }}
              className="max-w-full"
            />
          )}
          {!operator && (
            <LearnPhoneSavedResults tenantId={tenantId} recordingId={r.id} client={client} />
          )}
        </div>
      ))}
      {cursor && (
        <button
          type="button"
          className="cp-secondary"
          disabled={busy}
          onClick={() => void load(cursor)}
        >
          More recordings
        </button>
      )}
      <p className="text-xs">
        Plays audio already held by ServiceOS. Opening audio is recorded in the access log.
      </p>
    </section>
  );
}
