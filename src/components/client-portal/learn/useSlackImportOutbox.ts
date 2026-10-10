import { useEffect, useRef, useState } from "react";
import { getSupabaseClient, supabaseConfig } from "@/lib/supabase";
import {
  ImportSubmissionError,
  importOutboxKey,
  prepareImportDraft,
  readImportDraft,
  skipRejectedImport,
  submitImportDraft,
  type ImportDraft,
  type ImportKind,
  type ImportRequest,
} from "@/lib/learn-slack-import-outbox";
import type { RecoveryLock } from "@/lib/learn-slack-recovery-outbox";
const lock: RecoveryLock = async (key, task) => {
  if (!navigator.locks)
    throw Error(
      "This browser cannot coordinate saved approvals. Use a browser that supports Web Locks.",
    );
  return navigator.locks.request(key, task);
};
export function useSlackImportOutbox(
  tenantId: string,
  actorId: string,
  canEdit: boolean,
  kind: ImportKind,
) {
  const scope = { tenantId, actorId, backend: supabaseConfig.url.replace(/\/$/, "") };
  const [draft, setDraft] = useState<ImportDraft | null>(null),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [rejection, setRejection] = useState<ImportSubmissionError | null>(null),
    [completed, setCompleted] = useState<ImportDraft | null>(null);
  const lifetime = useRef(0),
    live = useRef(false),
    inFlight = useRef(false),
    editable = useRef(canEdit);
  editable.current = canEdit;
  function restore() {
    try {
      const saved = readImportDraft(localStorage, scope, kind);
      setDraft(saved);
      setReady(true);
      return saved;
    } catch (e) {
      setReady(false);
      setNotice(e instanceof Error ? e.message : "Saved imports are unavailable.");
      return null;
    }
  }
  useEffect(() => {
    live.current = true;
    lifetime.current++;
    setCompleted(null);
    setRejection(null);
    restore();
    const changed = (e: StorageEvent) => {
      if (e.key === null || e.key === importOutboxKey(scope, kind)) {
        restore();
        setRejection(null);
        setCompleted(null);
        setNotice(
          "Saved imports changed in another tab. Review the current requests before continuing.",
        );
      }
    };
    window.addEventListener("storage", changed);
    return () => {
      live.current = false;
      lifetime.current++;
      window.removeEventListener("storage", changed);
    };
  }, [tenantId, actorId, kind]);
  async function submit(requests?: ImportRequest[]) {
    if (!canEdit || !ready || inFlight.current) return;
    const ticket = lifetime.current;
    const current = () => live.current && ticket === lifetime.current;
    inFlight.current = true;
    setBusy(true);
    setNotice("");
    setRejection(null);
    setCompleted(null);
    try {
      const prepared = draft ?? prepareImportDraft(scope, requests ?? []);
      const result = await submitImportDraft(
        getSupabaseClient(),
        localStorage,
        lock,
        scope,
        prepared,
        () => current() && editable.current,
        (d) => {
          if (current()) setDraft(structuredClone(d));
        },
      );
      if (current()) {
        setDraft(null);
        setCompleted(result);
        setNotice(
          "Requests resolved. Recorded approvals retain their original IDs. Refresh progress to check capture; approval alone does not confirm completion.",
        );
      }
      return result;
    } catch (e) {
      if (current()) {
        restore();
        setNotice(
          e instanceof Error ? e.message : "Approval was not confirmed. Retry the saved requests.",
        );
        setRejection(e instanceof ImportSubmissionError && e.rejected ? e : null);
      }
    } finally {
      inFlight.current = false;
      if (current()) setBusy(false);
    }
  }
  async function skipRejected() {
    if (!draft || !rejection || inFlight.current) return;
    const ticket = lifetime.current;
    inFlight.current = true;
    setBusy(true);
    try {
      const remaining = await skipRejectedImport(localStorage, lock, scope, draft, rejection);
      if (live.current && lifetime.current === ticket) {
        setDraft(remaining);
        setRejection(null);
        setNotice(
          remaining
            ? "Rejected request cleared. The other saved requests remain available to retry."
            : "Rejected review cleared. Refresh the source details before preparing another import.",
        );
      }
    } catch (e) {
      if (live.current && lifetime.current === ticket)
        setNotice(e instanceof Error ? e.message : "Saved request could not be cleared.");
    } finally {
      inFlight.current = false;
      if (live.current && lifetime.current === ticket) setBusy(false);
    }
  }
  return {
    draft,
    ready,
    busy,
    notice,
    rejection,
    completed,
    submit,
    skipRejected,
    reload: restore,
    clearCompleted: () => setCompleted(null),
  };
}
