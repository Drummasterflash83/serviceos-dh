import { useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import {
  readVoicemailStatus,
  voicemailReviewHelp,
  voicemailScanState,
  type VoicemailRouteStatus,
  type VoicemailStatusClient,
} from "@/lib/learn-voicemail-status";
const stamp = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "Not yet recorded";
export function OperatorVoicemailStatus({
  tenantId,
  actorId,
  client,
}: {
  tenantId: string;
  actorId: string;
  client?: VoicemailStatusClient;
}) {
  const [routes, setRoutes] = useState<VoicemailRouteStatus[] | null>(null),
    [next, setNext] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(0);
  const scope = `${tenantId}:${actorId}`;
  const [loadedScope, setLoadedScope] = useState("");
  const visibleRoutes = loadedScope === scope ? routes : null;
  async function load(after: string | null = null) {
    const ticket = ++generation.current;
    setBusy(true);
    setError("");
    if (after === null) {
      setRoutes(null);
      setNext(null);
    }
    try {
      const data = await readVoicemailStatus(client ?? getSupabaseClient(), tenantId, after);
      if (ticket !== generation.current) return;
      setRoutes((old) => (after === null ? data.routes : [...(old ?? []), ...data.routes]));
      setNext(data.next_after);
      setLoadedScope(scope);
    } catch (e) {
      if (ticket === generation.current)
        setError(e instanceof Error ? e.message : "Voicemail status is unavailable.");
    } finally {
      if (ticket === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [tenantId, actorId, client]);
  return (
    <section className="cp-card space-y-4" aria-labelledby="operator-voicemail-heading">
      <header className="flex flex-wrap justify-between gap-3">
        <div>
          <h2 id="operator-voicemail-heading" className="text-xl font-semibold">
            Voicemail capture
          </h2>
          <p className="text-sm">
            Historical email discovery and private voicemail imports for this client.
          </p>
        </div>
        <button className="cp-secondary" disabled={busy} onClick={() => void load()}>
          {busy ? "Checking…" : "Refresh voicemail status"}
        </button>
      </header>
      {error && (
        <p role="status" className="rounded-lg border p-3">
          {error}
        </p>
      )}
      {visibleRoutes?.length === 0 && (
        <p>
          No verified voicemail routes are configured. Confirm the receiving mailbox, historical
          ownership and access before enabling capture.
        </p>
      )}
      {visibleRoutes?.map((r) => (
        <article className="rounded-lg border p-4 space-y-3" key={r.route_id}>
          <h3 className="font-semibold">
            {r.extension ? `Mailbox ${r.extension}` : "Unverified mailbox"} ·{" "}
            {voicemailScanState(r)}
          </h3>
          <dl className="grid gap-3 sm:grid-cols-3 text-sm">
            <div>
              <dt>Retained notifications identified</dt>
              <dd className="font-semibold">{r.status.candidates}</dd>
            </div>
            <div>
              <dt>Need source or route review</dt>
              <dd className="font-semibold">{r.status.needs_review}</dd>
            </div>
            <div>
              <dt>Excluded drafts</dt>
              <dd className="font-semibold">{r.status.excluded}</dd>
            </div>
          </dl>
          <p className="text-sm">
            Imports from these notifications:{" "}
            {Object.entries(r.status.jobs).length
              ? Object.entries(r.status.jobs)
                  .map(
                    ([s, n]) =>
                      `${n} ${s === "succeeded" ? "published" : s === "dead_letter" ? "need operator review" : s}`,
                  )
                  .join(" · ")
              : "none queued yet"}
            .
          </p>
          <p className="text-sm">
            Current pass:{" "}
            {r.status.rows_examined === null
              ? "not started"
              : `${r.status.rows_examined} retained emails examined`}
            . Last successful worker scan: {stamp(r.status.dispatch.last_success_at)}.
          </p>
          {r.status.next_scan_at && (
            <p className="text-sm">Next pass eligible: {stamp(r.status.next_scan_at)}.</p>
          )}
          {r.status.dispatch.code && (
            <p className="text-sm">
              {r.status.dispatch.code === "voicemail_capture_paused"
                ? "Check the Email and Phone capture controls above. Retained data remains available."
                : r.status.dispatch.code === "voicemail_route_unverified"
                  ? "Review the route, mailbox account and historical verification before resuming."
                  : "Check worker and database availability. Progress and completed imports are retained."}
            </p>
          )}
          {Object.entries(r.status.review_reasons).length > 0 && (
            <ul className="list-disc pl-5 text-sm space-y-1">
              {Object.entries(r.status.review_reasons).map(([code, n]) => (
                <li key={code}>
                  {n}: {voicemailReviewHelp[code]}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Observed {stamp(r.status.observed_at)}. Counts cover discovered notifications. A
            finished retained-email pass does not prove complete provider history. Published
            voicemails remain restricted to their authorised owner or managers.
          </p>
        </article>
      ))}
      {loadedScope === scope && next && (
        <button className="cp-secondary" disabled={busy} onClick={() => void load(next)}>
          Show more mailboxes
        </button>
      )}
    </section>
  );
}
