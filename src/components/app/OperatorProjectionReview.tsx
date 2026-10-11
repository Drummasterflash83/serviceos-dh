import { useEffect, useRef, useState } from "react";
import { getSupabaseClient, supabaseConfig } from "@/lib/supabase";
import {
  readOperatorInputWriteAccess,
  type OperatorInputClient,
} from "@/lib/learn-operator-inputs";
import {
  readProjectionReviews,
  readProjectionReviewDetail,
  projectionReviewAdvice,
  projectionFieldLabels,
  projectionReviewOutboxKey,
  readSavedProjectionReview,
  resolveSavedProjectionReview,
  type ProjectionPage,
  type ProjectionHold,
  type ProjectionDetail,
  type ProjectionReviewRequest,
} from "@/lib/learn-projection-review";
export function OperatorProjectionReview({
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
    scopeKey = projectionReviewOutboxKey(scope),
    db = () => client ?? getSupabaseClient();
  const [rows, setRows] = useState<ProjectionHold[]>([]),
    [page, setPage] = useState<ProjectionPage | null>(null),
    [detail, setDetail] = useState<ProjectionDetail | null>(null),
    [pending, setPending] = useState<ProjectionReviewRequest | null>(null);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [reason, setReason] = useState(""),
    [reviewed, setReviewed] = useState(false),
    [canWrite, setCanWrite] = useState<boolean | null>(null),
    [storageReady, setStorageReady] = useState(false);
  const generation = useRef(0),
    working = useRef(false),
    renderScope = useRef(scopeKey);
  renderScope.current = scopeKey;
  function restore() {
    try {
      setPending(readSavedProjectionReview(localStorage, scope));
      setStorageReady(Boolean(navigator.locks));
    } catch {
      setStorageReady(false);
      setNotice(
        "The saved review request needs inspection. It is retained; no new action can be sent.",
      );
    }
  }
  async function operation(work: (current: () => boolean) => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    const ticket = generation.current;
    const current = () => ticket === generation.current && renderScope.current === scopeKey;
    try {
      await work(current);
    } catch (e) {
      if (current()) {
        setDetail(null);
        setReviewed(false);
        setNotice(
          e instanceof Error
            ? e.message
            : "Review could not be confirmed. Refresh before proceeding.",
        );
      }
    } finally {
      if (current()) {
        working.current = false;
        setBusy(false);
        restore();
      }
    }
  }
  async function load(after: string | null = null) {
    await operation(async (current) => {
      setNotice("");
      setDetail(null);
      setReviewed(false);
      setCanWrite(null);
      try {
        const [p, access] = await Promise.all([
          readProjectionReviews(db(), tenantId, after),
          readOperatorInputWriteAccess(db()),
        ]);
        if (!current()) return;
        setPage(p);
        setRows((old) =>
          after
            ? [...old, ...p.rows.filter((r) => !old.some((x) => x.hold_id === r.hold_id))]
            : p.rows,
        );
        setCanWrite(access);
      } catch {
        if (current()) {
          setPage(null);
          setRows([]);
        }
        throw Error("Review history is unavailable. This does not mean there are no held inputs.");
      }
    });
  }
  useEffect(() => {
    generation.current++;
    working.current = false;
    setBusy(false);
    setPage(null);
    setRows([]);
    setDetail(null);
    setPending(null);
    setCanWrite(null);
    setReason("");
    setReviewed(false);
    setNotice("");
    restore();
    void load();
    const changed = (e: StorageEvent) => {
      if (e.key === null || e.key === scopeKey) {
        restore();
        setReviewed(false);
      }
    };
    window.addEventListener("storage", changed);
    return () => {
      generation.current++;
      window.removeEventListener("storage", changed);
    };
  }, [tenantId, actorId, backend, client]);
  async function inspect(row: ProjectionHold) {
    await operation(async (current) => {
      setDetail(null);
      setReviewed(false);
      setReason("");
      setNotice("");
      const d = await readProjectionReviewDetail(db(), tenantId, row);
      if (current()) setDetail(d);
    });
  }
  async function resolve(saved: ProjectionReviewRequest, mode: "apply" | "check" | "cancel") {
    await operation(async (current) => {
      setNotice("");
      const permission = await readOperatorInputWriteAccess(db());
      if (!current()) return;
      setCanWrite(permission);
      if (permission !== true)
        throw Error(
          "Current OpenFolk administrator access is required. Any saved request is retained.",
        );
      const receipt = await resolveSavedProjectionReview(
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
        current,
      );
      if (!current()) return;
      setDetail(null);
      setReviewed(false);
      setReason("");
      setNotice(
        receipt.state === "recorded"
          ? "Source values applied. The previous canonical record is retained in audit history. Customer-card processing is pending."
          : receipt.state === "cancelled"
            ? "Unresolved request cancelled. Existing source values and the review hold are unchanged."
            : "No receipt is recorded yet. Check this same saved request before making another change.",
      );
      if (receipt.state !== "pending") {
        setPage(null);
        setRows([]);
        try {
          const p = await readProjectionReviews(db(), tenantId);
          if (current()) {
            setPage(p);
            setRows(p.rows);
          }
        } catch {
          if (current())
            setNotice(
              "The receipt was recorded, but current review status could not be refreshed. Refresh status before making another change.",
            );
        }
      }
    });
  }
  const disabled = busy || !!pending || !storageReady || canWrite !== true;
  const value = (v: unknown) => (v === null ? "—" : Array.isArray(v) ? v.join(", ") : String(v));
  return (
    <section className="cp-card space-y-4" aria-labelledby="projection-review-heading">
      <header className="flex flex-wrap justify-between gap-3">
        <div>
          <h2 id="projection-review-heading" className="text-xl font-semibold">
            Communication records needing review
          </h2>
          <p className="text-sm">
            Compare retained Phone and Email values with their current LEARN record before
            reconciling a held update.
          </p>
        </div>
        <button className="cp-secondary" disabled={busy} onClick={() => void load()}>
          Refresh reviews
        </button>
      </header>
      {notice && (
        <p role="status" className="rounded-lg border p-3">
          {notice}
        </p>
      )}
      {canWrite !== true && (
        <p className="text-sm">
          {canWrite === false
            ? "Read-only access. An OpenFolk administrator must approve changes."
            : "Administrator access has not been verified. Changes are unavailable."}
        </p>
      )}
      {!storageReady && (
        <p className="text-sm">Changes require secure local storage and browser request locking.</p>
      )}
      {pending && (
        <div
          className="rounded-lg border p-4 space-y-2"
          aria-label="Saved communication review request"
        >
          <h3 className="font-semibold">Resolve the saved review request</h3>
          <p>
            Check its recorded result before another change. Cancellation prevents an unresolved
            request from applying later.
          </p>
          <div className="flex flex-wrap gap-2">
            {(["check", "apply", "cancel"] as const).map((mode) => (
              <button
                key={mode}
                className="cp-secondary"
                disabled={busy || !storageReady || canWrite !== true}
                onClick={() => void resolve(pending, mode)}
              >
                {mode === "check"
                  ? "Check saved result"
                  : mode === "apply"
                    ? "Retry saved request"
                    : "Cancel unresolved request"}
              </button>
            ))}
          </div>
        </div>
      )}
      {page && (
        <>
          <p className="text-xs text-muted-foreground">
            Checked {new Date(page.checked_at).toLocaleString("en-GB")}. This list covers projection
            holds; identity matching and provider-processing reviews are separate.
          </p>
          {!rows.length && <p>No projection holds are recorded in this snapshot.</p>}
          <div className="space-y-2">
            {rows.map((row) => (
              <article key={row.hold_id} className="rounded-lg border p-3">
                <h3 className="font-semibold">
                  {row.source_kind === "phone" ? "Phone" : "Email"} ·{" "}
                  {new Date(row.recorded_at).toLocaleString("en-GB")}
                </h3>
                <p className="text-sm">{projectionReviewAdvice(row.reason)}</p>
                <button
                  className="cp-secondary mt-2"
                  disabled={busy || !!pending}
                  onClick={() => void inspect(row)}
                >
                  Compare values
                </button>
              </article>
            ))}
          </div>
          {page.next_cursor && (
            <button
              className="cp-secondary"
              disabled={busy}
              onClick={() => void load(page.next_cursor)}
            >
              Load more reviews
            </button>
          )}
        </>
      )}
      {detail && (
        <div
          className="space-y-3 rounded-lg border p-4"
          aria-label="Communication value comparison"
        >
          <h3 className="font-semibold">Review retained source values</h3>
          <p>{projectionReviewAdvice(detail.reason)}</p>
          {!detail.capture_allowed && (
            <p>
              Processing is paused for this input. Retained records remain available; resume the
              input before applying values.
            </p>
          )}
          {detail.evidence_too_large ? (
            <p>
              This comparison exceeds the safe display size and needs a separate operator
              investigation. No replacement can be applied here.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="p-2 text-left">Field</th>
                    <th className="p-2 text-left">Current LEARN value</th>
                    <th className="p-2 text-left">Retained source value</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(detail.source_fields ?? {}).map(([key, source]) => (
                    <tr key={key} className="border-t">
                      <th className="p-2 text-left align-top">{projectionFieldLabels[key]}</th>
                      <td className="p-2 align-top whitespace-pre-wrap break-all">
                        {value(detail.canonical_fields?.[key])}
                      </td>
                      <td className="p-2 align-top whitespace-pre-wrap break-all">
                        {value(source)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-sm">
            Applying these values replaces the displayed canonical fields. The full previous
            canonical record is retained in audit history; source messages, calls, identity links
            and other metadata are preserved. This does not confirm mailbox ownership or complete
            source coverage.
          </p>
          <fieldset disabled={disabled || !detail.can_apply} className="space-y-3">
            <label className="block">
              Review reason
              <textarea
                className="cp-input w-full"
                maxLength={1000}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setReviewed(false);
                }}
              />
            </label>
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(e) => setReviewed(e.target.checked)}
              />
              I reviewed this comparison and approve using the retained source values.
            </label>
            <button
              className="cp-primary"
              disabled={!reason.trim() || !reviewed}
              onClick={() => {
                if (disabled || !detail.can_apply || !reviewed || !reason.trim()) return;
                void resolve(
                  {
                    version: 1,
                    backend,
                    tenantId,
                    actorId,
                    requestId: crypto.randomUUID(),
                    holdId: detail.hold_id,
                    revision: detail.revision,
                    reason: reason.trim(),
                  },
                  "apply",
                );
              }}
            >
              Apply reviewed source values
            </button>
          </fieldset>
        </div>
      )}
    </section>
  );
}
