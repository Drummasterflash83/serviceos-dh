import { useEffect, useRef, useState } from "react";
import { getSupabaseClient, supabaseConfig } from "@/lib/supabase";
import {
  correctionOutboxKey,
  prepareCorrectionDraft,
  readCorrectionDraft,
  recoverCorrectionDraft,
  type CorrectionDraft,
  type CorrectionScope,
} from "@/lib/learn-correction-outbox";
import type { CorrectionRequest } from "@/lib/learn-performance-corrections";
import type { RecoveryLock } from "@/lib/learn-slack-recovery-outbox";
const lock: RecoveryLock = async (key, task) => {
  if (!navigator.locks) throw Error("Use a browser that supports saved-request coordination.");
  return navigator.locks.request(key, task);
};
export function useCorrectionRecovery(
  scope: Omit<CorrectionScope, "backend">,
  canReview: boolean,
  onRecorded: () => void,
) {
  const s = { ...scope, backend: supabaseConfig.url.replace(/\/$/, "") },
    key = correctionOutboxKey(s);
  const [pending, setPending] = useState<CorrectionDraft | null>(null),
    [ready, setReady] = useState(false),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const active = useRef(false),
    inFlight = useRef(false),
    current = useRef({ key, canReview });
  current.current = { key, canReview };
  function restore() {
    try {
      setPending(readCorrectionDraft(localStorage, s));
      setReady(true);
    } catch (e) {
      setReady(false);
      setMessage(e instanceof Error ? e.message : "Saved correction unavailable.");
    }
  }
  useEffect(() => {
    active.current = true;
    setReady(false);
    setPending(null);
    setMessage("");
    restore();
    const changed = (e: StorageEvent) => {
      if (e.key === null || e.key === key) {
        restore();
        setMessage(
          "Saved correction details changed in another tab. Review them before continuing.",
        );
      }
    };
    window.addEventListener("storage", changed);
    return () => {
      active.current = false;
      window.removeEventListener("storage", changed);
    };
  }, [key]);
  async function run(action: "submit" | "check" | "cancel", request?: CorrectionRequest) {
    if (inFlight.current || !ready || !canReview) return;
    const allowed = () =>
      active.current && current.current.key === key && current.current.canReview;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      const d = request ? prepareCorrectionDraft(s, request) : pending;
      if (!d) throw Error("No saved correction is available.");
      const result = await recoverCorrectionDraft(
        getSupabaseClient(),
        localStorage,
        lock,
        s,
        d,
        action,
        allowed,
      );
      if (!allowed()) return;
      restore();
      setMessage(
        result.state === "recorded"
          ? "Correction recorded. Its new value still needs a separate evidence review."
          : result.state === "cancelled"
            ? "Pending correction cancelled. The original evidence is unchanged."
            : "No correction is recorded for this request yet. Retry the same correction or cancel it.",
      );
      if (result.state === "recorded") onRecorded();
    } catch (e) {
      if (allowed()) {
        restore();
        setMessage(e instanceof Error ? e.message : "Correction could not be confirmed.");
      }
    } finally {
      inFlight.current = false;
      if (allowed()) setBusy(false);
    }
  }
  const blocked = !ready || busy || !!pending || !canReview;
  const panel = (
    <section aria-label="Correction recovery">
      {pending && (
        <div className="lp-review">
          <h4>Correction awaiting confirmation</h4>
          <p>
            This browser retained your exact request. Check its status before making another
            correction on this card.
          </p>
          <p>
            Requested value:{" "}
            {pending.request.value === null ? "Withheld (not assessed)" : pending.request.value}.
            Reason: {pending.request.reason}
          </p>
          <small>Original observation: {pending.request.measurementId}</small>
          <div className="lp-actions">
            <button
              className="cp-secondary"
              disabled={busy || !ready || !canReview}
              onClick={() => void run("check")}
            >
              Check correction status
            </button>
            <button
              className="cp-secondary"
              disabled={busy || !ready || !canReview}
              onClick={() => void run("submit")}
            >
              Retry same correction
            </button>
            <button
              className="cp-secondary"
              disabled={busy || !ready || !canReview}
              onClick={() => void run("cancel")}
            >
              Cancel pending correction
            </button>
          </div>
          <p>
            Cancelling prevents this pending request from being applied later. If it was already
            recorded, it remains in the history.
          </p>
        </div>
      )}
      {busy && <p role="status">Checking correction…</p>}
      {message && <p role="status">{message}</p>}
    </section>
  );
  return { panel, blocked, submit: (request: CorrectionRequest) => run("submit", request) };
}
