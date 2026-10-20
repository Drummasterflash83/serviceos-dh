import { useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import {
  clearUsersPageOutbox, readUsersPageOutbox, readUsersPageSaved, requestUsersPage,
  saveUsersPageOutbox, usersPageKey, type UsersPageOutbox, type UsersPageSaved,
} from "@/lib/new-dawn-isolated-users-page";

/** Held operator source check. Rendering is gated by the parent tenant flag. */
export function OperatorCommusoftUsersPage({ tenantId, actorId, connectionId, backend, canRun }: {
  tenantId: string; actorId: string; connectionId: string; backend: string; canRun: boolean;
}) {
  const scope = { tenantId, actorId, connectionId, backend };
  const [entry, setEntry] = useState<UsersPageOutbox | null>(null);
  const [reason, setReason] = useState("");
  const [page, setPage] = useState<UsersPageSaved | null>(null);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const generation = useRef(0), working = useRef(false);
  useEffect(() => {
    const ticket = ++generation.current;
    working.current = false;
    setBusy(false); setPage(null); setRetryAt(null); setNotice(""); setEntry(null); setReason("");
    try {
      const saved = readUsersPageOutbox(localStorage, scope);
      if (ticket === generation.current) {
        setEntry(saved);setReason(saved?.request.reason ?? "");
        setStorageReady(Boolean(navigator.locks));
      }
    } catch {
      if (ticket === generation.current) {
        setStorageReady(false);
        setNotice("A saved source-page request could not be verified. It remains stored; review it before another read.");
      }
    }
    const changed = (event: StorageEvent) => {
      if (event.key !== null && event.key !== usersPageKey(scope)) return;
      try {
        const saved = readUsersPageOutbox(localStorage, scope);
        setEntry(saved);setPage(null);setRetryAt(null);setReason(saved?.request.reason ?? "");
      } catch {
        setStorageReady(false);
        setNotice("A saved source-page request could not be verified. It remains stored.");
      }
    };
    window.addEventListener("storage", changed);
    return () => {generation.current++;window.removeEventListener("storage", changed);};
  }, [tenantId, actorId, connectionId, backend]);
  const current = (ticket: number) => generation.current === ticket;
  async function check(saved: UsersPageOutbox) {
    const ticket = generation.current;
    try {
      const result = await readUsersPageSaved(getSupabaseClient(), saved.request);
      if (!current(ticket)) return;
      if (result.state === "complete") {
        setPage(result);setRetryAt(null);setNotice("");
      } else {
        setPage(null);
        setNotice(`The saved request is ${result.state}. No new source page was requested.`);
      }
    } catch {
      if (current(ticket))
        setNotice(`Saved result unconfirmed for request ${saved.request.requestId}. No new source page was requested.`);
    }
  }
  async function run(sameRequest: boolean) {
    if (working.current || !canRun || !storageReady || !navigator.locks ||
      reason.trim().length < 3 || reason.trim().length > 500) return;
    const ticket = generation.current;
    working.current = true;setBusy(true);setNotice("");setPage(null);
    try {
      const key = usersPageKey(scope);
      await navigator.locks.request(key, async () => {
        if (!current(ticket)) return;
        const prior = readUsersPageOutbox(localStorage, scope);
        if (sameRequest ? !prior || !entry || prior.request.requestId !== entry.request.requestId : !!prior)
          throw Error("Resolve the saved source-page request before starting another.");
        const saved = prior ?? {version: 1 as const, savedAt: Date.now(), request: {
          version: 1 as const, backend, tenantId, actorId, connectionId,
          requestId: crypto.randomUUID(), reason: reason.trim(),
        }};
        if (!prior) saveUsersPageOutbox(localStorage, saved);
        if (!current(ticket)) return;
        setEntry(saved);
        try {
          const result = await requestUsersPage(getSupabaseClient(), saved.request);
          if (!current(ticket)) return;
          if (result.state === "waiting") {
            setRetryAt(result.retryAt);
            setNotice(`Commusoft is busy until ${new Date(result.retryAt).toLocaleString("en-GB")}. Retry this same request manually; no page was read.`);
          } else {setPage(result.page);setRetryAt(null);setNotice("");}
        } catch {
          if (current(ticket)) await check(saved); // Read-only reconciliation, never another provider GET.
        }
      });
    } catch (error) {
      if (current(ticket)) setNotice(error instanceof Error ? error.message : "Saved request unavailable.");
    } finally {
      if (current(ticket)) {working.current = false;setBusy(false);}
    }
  }
  function close() {
    if (!entry || busy || (page?.state !== "complete" &&
      Date.now() - entry.savedAt < 5 * 60_000)) return;
    try {
      clearUsersPageOutbox(localStorage, scope);
      setEntry(null);setPage(null);setRetryAt(null);setReason("");setNotice("");
    } catch {setNotice("Saved request could not be cleared. It remains available for review.");}
  }
  const canRetry = !!entry && !page && retryAt !== null &&
    Date.now() - entry.savedAt < 5 * 60_000;
  return (
    <details className="rounded-xl border p-4">
      <summary className="cursor-pointer font-semibold">Source users · operator check</summary>
      <div className="space-y-3 pt-3 text-sm">
        <p>Read at most 10 Commusoft source users from one page for this selected client and connection. The server checks OpenFolk administrator authority before any read. Saved source IDs are directory evidence only: they do not establish an OpenFolk staff identity, job attendance or an appointment.</p>
        <label className="block">Reason for source check
          <input className="cp-input w-full" value={reason} maxLength={500}
            disabled={busy || !!entry || !canRun}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Review source user IDs for this client" />
        </label>
        {!entry && <button className="cp-secondary" disabled={!canRun || busy || !storageReady || reason.trim().length < 3}
          onClick={() => void run(false)}>Read one source page</button>}
        {entry && <p>Saved request: <code>{entry.request.requestId}</code>. No second page is requested automatically.</p>}
        {entry && <div className="flex flex-wrap gap-2">
          <button className="cp-secondary" disabled={busy} onClick={() => void check(entry)}>Check saved result</button>
          {canRetry && <button className="cp-secondary" disabled={busy || !canRun}
            onClick={() => void run(true)}>Retry same request</button>}
          {(page?.state === "complete" || Date.now() - entry.savedAt >= 5 * 60_000) &&
            <button className="cp-secondary" disabled={busy} onClick={close}>Close saved request</button>}
        </div>}
        {!storageReady && <p role="status">This browser cannot safely save and coordinate source-page requests.</p>}
        {notice && <p role="status">{notice}</p>}
        {page && page.state === "complete" && <div role="status" className="space-y-2">
          <p>{page.recordCount} source user IDs saved · checked {new Date(page.checkedAt!).toLocaleString("en-GB")}.
            {page.hasMore ? " More pages may exist; they were not read." : " No further page indicated."}</p>
          {page.sourceUsers.length === 0 ? <p>No source users were returned on this page.</p> :
            <ul className="list-disc pl-5">{page.sourceUsers.map((user) =>
              <li key={user.sourceId}>Commusoft source user ID {user.sourceId} · observed {new Date(user.observedAt).toLocaleString("en-GB")}</li>)}</ul>}
          <p>Saved read audit: <code>{page.auditId}</code>.</p>
        </div>}
      </div>
    </details>
  );
}
