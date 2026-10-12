import { useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import {
  readMicrosoftStatus,
  microsoftIssueHelp,
  microsoftCaptureState,
  type MicrosoftAccountStatus,
  type MicrosoftStatusClient,
} from "@/lib/learn-microsoft-status";
const stamp = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "Not yet recorded";
export function OperatorMicrosoftStatus({
  tenantId,
  actorId,
  client,
}: {
  tenantId: string;
  actorId: string;
  client?: MicrosoftStatusClient;
}) {
  const [routes, setRoutes] = useState<MicrosoftAccountStatus[] | null>(null),
    [next, setNext] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [observedAt, setObservedAt] = useState<string | null>(null);
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
      const data = await readMicrosoftStatus(client ?? getSupabaseClient(), tenantId, after);
      if (ticket !== generation.current) return;
      setRoutes((old) => (after === null ? data.accounts : [...(old ?? []), ...data.accounts]));
      setNext(data.next_after);
      setLoadedScope(scope);
      setObservedAt(data.observed_at);
    } catch (e) {
      if (ticket === generation.current)
        setError(e instanceof Error ? e.message : "Microsoft status is unavailable.");
    } finally {
      if (ticket === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    void load();
    return () => { generation.current++; };
  }, [tenantId, actorId, client]);
  return (
    <section className="cp-card space-y-4" aria-labelledby="operator-microsoft-heading">
      <header className="flex flex-wrap justify-between gap-3">
        <div>
          <h2 id="operator-microsoft-heading" className="text-xl font-semibold">Microsoft email capture</h2>
          <p className="text-sm">Saved progress and recovery needs for this client’s Microsoft mailboxes.</p>
        </div>
        <button className="cp-secondary" disabled={busy} onClick={() => void load()}>{busy ? "Checking…" : "Refresh Microsoft status"}</button>
      </header>
      {error && <p role="status" className="rounded-lg border p-3">{error}</p>}
      {visibleRoutes?.length === 0 && <p>No Microsoft mailboxes are configured for this client. Complete authorised consent and mailbox verification before enabling capture.</p>}
      {visibleRoutes?.map(a => (
        <article key={a.account_id} className="rounded-lg border p-4 space-y-3">
          <h3 className="font-semibold">{a.email_address} · {microsoftCaptureState(a)}</h3>
          <dl className="grid gap-3 sm:grid-cols-3 text-sm">
            <div><dt>Source pages saved</dt><dd className="font-semibold">{a.saved_pages}</dd></div>
            <div><dt>Saved pages processed</dt><dd className="font-semibold">{a.settled_pages}</dd></div>
            <div><dt>Held observations retained</dt><dd className="font-semibold">{a.held_observations}</dd></div>
          </dl>
          <p className="text-sm">Mailbox coverage: unverified. Attachment files: not captured.</p>
          <p className="text-sm">Last saved page: {stamp(a.last_saved_at)}. Last completed page processing: {stamp(a.last_settled_at)}.</p>
          <p className="text-sm">Completed folder-discovery passes: {a.discovery_rounds}. Last pass: {stamp(a.last_discovery_at)}.</p>
          <p className="text-sm">Physical-folder capture records: {a.physical_folders}. Search-folder exclusions: {a.search_folders}.</p>
          <p className="text-sm">Observations published: {a.published_observations}. Draft observations excluded: {a.draft_observations}. Folder-removal observations retained: {a.removal_observations}.</p>
          <p className="text-sm">Work: {Object.entries(a.jobs).length ? Object.entries(a.jobs).map(([state,n])=>`${n} ${state === 'dead_letter' ? 'awaiting operator review' : state}`).join(' · ') : 'none recorded'}.</p>
          {a.next_job_at && <p className="text-sm">Next work eligible: {stamp(a.next_job_at)}. Capture must be enabled and mailbox access valid before new provider requests.</p>}
          {!a.capture_allowed && <p className="text-sm">Review the Email capture control above. Saved pages can finish processing while new capture is paused.</p>}
          {(!a.account_active || a.enabled_bindings === 0) && <p className="text-sm">Review mailbox consent, account status and the verified mailbox association before resuming.</p>}
          {a.issue_code && <p role="status" className="text-sm">{microsoftIssueHelp[a.issue_code]} Recorded {stamp(a.issue_at)}.</p>}
          {a.held_observations > 0 && <p className="text-sm">Held observations can be incomplete or conflicting. Review their source history; they are not proof of published messages.</p>}
          <p className="text-xs text-muted-foreground">Counts cover retained history across this account’s bindings and can include repeated observations. They are not unique email totals or a current folder inventory. Completed work does not establish complete or fresh mailbox coverage.</p>
        </article>
      ))}
      {loadedScope === scope && observedAt && <p className="text-xs text-muted-foreground">Latest page observed {stamp(observedAt)}. Refresh to reload all shown status from the first page.</p>}
      {loadedScope === scope && next && <button className="cp-secondary" disabled={busy} onClick={()=>void load(next)}>Show more Microsoft mailboxes</button>}
    </section>
  );
}
