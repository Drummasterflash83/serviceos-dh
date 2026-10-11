import { useEffect, useRef, useState } from "react";
import { getSupabaseClient, supabaseConfig } from "@/lib/supabase";
import {
  readOperatorInputWriteAccess,
  type OperatorInputClient,
} from "@/lib/learn-operator-inputs";
import {
  readPhoneAttempts,
  phoneAttemptAction,
  readSavedPhoneReconciliation,
  resolveSavedPhoneReconciliation,
  phoneReviewOutboxKey,
  type PhoneAttemptPage,
  type PhoneAttempt,
  type PhoneReconciliation,
} from "@/lib/learn-phone-attempt-review";
export function OperatorPhoneAttempts({
  tenantId,
  actorId,
  client,
  backend = supabaseConfig.url.replace(/\/$/, ""),
}: {
  tenantId: string;
  actorId: string;
  client?: OperatorInputClient;
  backend?: string;
}) {
  const scope = { tenantId, actorId, backend },
    scopeKey = phoneReviewOutboxKey(scope);
  const [page, setPage] = useState<PhoneAttemptPage | null>(null),
    [rows, setRows] = useState<PhoneAttempt[]>([]),
    [held, setHeld] = useState(true),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [canWrite, setCanWrite] = useState<boolean | null>(null),
    [pending, setPending] = useState<PhoneReconciliation | null>(null),
    [selected, setSelected] = useState<PhoneAttempt | null>(null),
    [reason, setReason] = useState(""),
    [reviewed, setReviewed] = useState(false),
    [storageReady, setStorageReady] = useState(false);
  const generation = useRef(0),
    working = useRef(false),
    renderScope = useRef(scopeKey);
  renderScope.current = scopeKey;
  const db = () => client ?? getSupabaseClient();
  function restore() {
    try {
      setPending(readSavedPhoneReconciliation(localStorage, scope));
      setStorageReady(Boolean(navigator.locks));
    } catch {
      setStorageReady(false);
      setNotice(
        "The saved recovery request needs inspection. It has been retained; no recovery request will be sent.",
      );
    }
  }
  async function load(after: string | null = null) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    const ticket = generation.current;
    try {
      const [p, write] = await Promise.all([
        readPhoneAttempts(db(), tenantId, held, after),
        readOperatorInputWriteAccess(db()),
      ]);
      if (ticket !== generation.current || renderScope.current !== scopeKey) return;
      setPage(p);
      setCanWrite(write);
      setRows((old) =>
        after ? [...old, ...p.rows.filter((r) => !old.some((o) => o.run_id === r.run_id))] : p.rows,
      );
    } catch {
      if (ticket === generation.current) {
        setPage(null);
        setRows([]);
        setNotice(
          "Attempt history is unavailable. Check the operator service and access before treating this list as empty.",
        );
      }
    } finally {
      if (ticket === generation.current) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    generation.current++;
    working.current = false;
    setPage(null);
    setRows([]);
    setSelected(null);
    setReason("");
    setReviewed(false);
    setNotice("");
    restore();
    void load();
    const changed = (e: StorageEvent) => {
      if (e.key === scopeKey || e.key === null) restore();
    };
    window.addEventListener("storage", changed);
    return () => {
      generation.current++;
      window.removeEventListener("storage", changed);
    };
  }, [tenantId, actorId, backend, client, held]);
  async function reconcile(saved: PhoneReconciliation, mode: "apply" | "check" | "cancel") {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setNotice("");
    const ticket = generation.current;
    const allowed = () => ticket === generation.current && renderScope.current === scopeKey;
    try {
      const access = await readOperatorInputWriteAccess(db());
      if (!allowed()) return;
      setCanWrite(access);
      if (access !== true)
        throw Error(
          "Current OpenFolk administrator access is required. The request remains saved.",
        );
      const receipt = await resolveSavedPhoneReconciliation(
        db(),
        localStorage,
        async (key, task) => {
          if (!navigator.locks)
            throw Error("Browser request locking is unavailable. Nothing was sent.");
          return navigator.locks.request(key, task);
        },
        scope,
        saved,
        mode,
        allowed,
      );
      if (!allowed()) return;
      setNotice(
        receipt.state === "recorded"
          ? receipt.already_completed
            ? "The original completion was confirmed. No new processing was started."
            : "The saved result was published and its recovery receipt recorded."
          : receipt.state === "cancelled"
            ? "The unresolved recovery request was cancelled. The original processing hold and saved result remain retained."
            : "No recovery receipt is recorded yet. Check again, apply this same saved request, or cancel it.",
      );
      setSelected(null);
      setReviewed(false);
      setReason("");
      restore();
    } catch (e) {
      if (allowed()) {
        restore();
        setNotice(
          e instanceof Error
            ? e.message
            : "Recovery is unconfirmed. Check the saved request before retrying.",
        );
      }
    } finally {
      if (allowed()) {
        working.current = false;
        setBusy(false);
      }
    }
    if (allowed()) void load();
  }
  const stamp = (v: string | null) => (v ? new Date(v).toLocaleString("en-GB") : "Not recorded");
  return (
    <section
      className="rounded-xl border p-4 space-y-4"
      aria-label="Phone processing attempt review"
    >
      <header className="flex flex-wrap justify-between gap-3">
        <div>
          <h3 className="font-semibold">Phone processing attempts and recovery</h3>
          <p className="text-sm">
            Includes held replacement attempts even when an older result is still available. Source
            content and credentials remain private.
          </p>
        </div>
        <button className="cp-secondary" disabled={busy} onClick={() => void load()}>
          Refresh attempts
        </button>
      </header>
      <label className="flex gap-2 text-sm">
        <input
          type="checkbox"
          checked={held}
          disabled={busy}
          onChange={(e) => setHeld(e.target.checked)}
        />
        Show held attempts only
      </label>
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {pending && (
        <div className="rounded-lg border p-3 space-y-2">
          <p className="font-medium">Saved recovery request needs resolution</p>
          <p className="text-sm">
            Attempt {pending.runId}. Check the original receipt before trying another action.
            Cancelling this request does not clear the processing hold.
          </p>
          <div className="flex flex-wrap gap-2">
            {(["check", "apply", "cancel"] as const).map((mode) => (
              <button
                key={mode}
                className="cp-secondary"
                disabled={busy || !storageReady || canWrite !== true}
                onClick={() => void reconcile(pending, mode)}
              >
                {mode === "check"
                  ? "Check saved receipt"
                  : mode === "apply"
                    ? "Apply saved request"
                    : "Cancel saved request"}
              </button>
            ))}
          </div>
        </div>
      )}
      {page && (
        <>
          <p className="text-xs text-muted-foreground">
            Checked {stamp(page.checked_at)}.{" "}
            {page.capture_allowed ? "Phone capture is permitted." : "Phone capture is paused."}{" "}
            Expired review times do not release ownership.
          </p>
          {!rows.length && (
            <p className="text-sm">
              No {held ? "held " : ""}processing attempts were returned. This does not establish
              complete capture or processing coverage.
            </p>
          )}
          <div className="space-y-3">
            {rows.map((a) => (
              <article key={a.run_id} className="rounded-lg border p-3 space-y-2">
                <h4 className="font-medium">
                  {a.stage === "transcription"
                    ? "Transcription"
                    : a.stage === "analysis"
                      ? "Analysis"
                      : "Audio download"}{" "}
                  · {a.state.replaceAll("_", " ")}
                </h4>
                <p className="text-sm">{phoneAttemptAction(a, page.capture_allowed)}</p>
                <dl className="text-xs space-y-1">
                  <div>
                    <dt className="inline">Recording: </dt>
                    <dd className="inline break-all">{a.recording_id}</dd>
                  </div>
                  <div>
                    <dt className="inline">Attempt: </dt>
                    <dd className="inline break-all">{a.run_id}</dd>
                  </div>
                  <div>
                    <dt className="inline">Started: </dt>
                    <dd className="inline">{stamp(a.started_at)}</dd>
                  </div>
                  <div>
                    <dt className="inline">Review after: </dt>
                    <dd className="inline">{stamp(a.review_after)}</dd>
                  </div>
                  {a.error_code && (
                    <div>
                      <dt className="inline">Diagnostic: </dt>
                      <dd className="inline">{a.error_code}</dd>
                    </div>
                  )}
                </dl>
                <p className="text-xs">
                  Saved result: {a.has_prepared_result ? "yes" : "no"} · Completion receipt:{" "}
                  {a.has_receipt ? "yes" : "no"} · Prior result archived:{" "}
                  {a.retained_previous_result ? "yes" : "not recorded"} · Prior attribution
                  archived: {a.retained_previous_attribution ? "yes" : "not recorded"}
                </p>
                {a.can_reconcile && (
                  <button
                    className="cp-secondary"
                    disabled={busy || Boolean(pending) || !storageReady || canWrite !== true}
                    onClick={() => {
                      setSelected(a);
                      setReason("");
                      setReviewed(false);
                    }}
                  >
                    Review saved-result recovery
                  </button>
                )}
              </article>
            ))}
          </div>
          {page.next_cursor && (
            <button
              className="cp-secondary"
              disabled={busy}
              onClick={() => void load(page.next_cursor)}
            >
              Load more attempts
            </button>
          )}
        </>
      )}
      {selected && !pending && (
        <div className="rounded-lg border p-3 space-y-3">
          <h4 className="font-medium">Recover saved {selected.stage} result</h4>
          <p className="text-sm">
            The server will recheck this attempt’s source and capture permission before publication.
            It will preserve the previous result and record your reason. No new provider request is
            made.
          </p>
          <label className="block text-sm">
            Review reason
            <textarea
              className="mt-1 w-full rounded border p-2"
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
              disabled={busy}
            />
            I have reviewed this attempt and want to publish its saved result.
          </label>
          <button
            className="cp-secondary"
            disabled={busy || !reviewed || !reason.trim() || canWrite !== true || !storageReady}
            onClick={() =>
              void reconcile(
                {
                  version: 1,
                  ...scope,
                  requestId: crypto.randomUUID(),
                  runId: selected.run_id,
                  reason: reason.trim(),
                },
                "apply",
              )
            }
          >
            Publish saved result
          </button>
        </div>
      )}
    </section>
  );
}
