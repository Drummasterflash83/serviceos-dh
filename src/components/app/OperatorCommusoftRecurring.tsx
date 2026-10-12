import { useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import type { InputOverview, OperatorInputClient } from "@/lib/learn-operator-inputs";
import {
  inputOutboxKey,
  connectionOutboxKey,
  captureOutboxKey,
} from "@/lib/learn-operator-request-scope";
import {
  commusoftRecurringOutboxKey,
  commusoftRecurringStates,
  readCommusoftRecurring,
  readSavedCommusoftRecurring,
  resolveSavedCommusoftRecurring,
  type CommusoftRecurringAccount,
  type SavedCommusoftRecurring,
} from "@/lib/learn-commusoft-recurring";
const stamp = (v: string | null) => (v ? new Date(v).toLocaleString("en-GB") : "Not yet verified");
export function OperatorCommusoftRecurring({
  tenantId,
  actorId,
  backend,
  overview,
  canWrite,
  blocked,
  client,
  onBlockingChange,
  onChanged,
}: {
  tenantId: string;
  actorId: string;
  backend: string;
  overview: InputOverview;
  canWrite: boolean | null;
  blocked: boolean;
  client?: OperatorInputClient;
  onBlockingChange: (value: boolean) => void;
  onChanged: () => Promise<void>;
}) {
  const scope = { tenantId, actorId, backend },
    db = () => client ?? getSupabaseClient();
  const [accounts, setAccounts] = useState<CommusoftRecurringAccount[]>([]),
    [selectedId, setSelectedId] = useState("");
  const [ready, setReady] = useState(false),
    [loading, setLoading] = useState(false),
    [storageReady, setStorageReady] = useState(false),
    [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [reason, setReason] = useState(""),
    [reviewed, setReviewed] = useState(false);
  const [pages, setPages] = useState(2000),
    [size, setSize] = useState(50),
    [pending, setPending] = useState<SavedCommusoftRecurring | null>(null);
  const generation = useRef(0),
    working = useRef(false),
    live = useRef(false),
    current = useRef({ tenantId, actorId, backend, canWrite });
  current.current = { tenantId, actorId, backend, canWrite };
  const allowed = () =>
    live.current &&
    current.current.tenantId === tenantId &&
    current.current.actorId === actorId &&
    current.current.backend === backend &&
    current.current.canWrite === true;
  function restore() {
    try {
      const saved = readSavedCommusoftRecurring(localStorage, scope);
      setPending(saved);
      const ok = Boolean(navigator.locks);
      setStorageReady(ok);
      onBlockingChange(working.current || !!saved || !ok);
    } catch (e) {
      setStorageReady(false);
      onBlockingChange(true);
      setNotice(e instanceof Error ? e.message : "Saved request needs review.");
    }
  }
  async function load() {
    const ticket = ++generation.current;
    setLoading(true);
    setReady(false);
    setError("");
    try {
      const d = await readCommusoftRecurring(db(), tenantId);
      if (!live.current || ticket !== generation.current) return;
      setAccounts(d.accounts);
      setReady(true);
    } catch (e) {
      if (live.current && ticket === generation.current)
        setError(e instanceof Error ? e.message : "Capture settings unavailable.");
    } finally {
      if (live.current && ticket === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    live.current = true;
    setPending(null);
    setAccounts([]);
    setSelectedId("");
    setReason("");
    setReviewed(false);
    setNotice("");
    setBusy(false);
    working.current = false;
    restore();
    void load();
    const changed = (e: StorageEvent) => {
      if (
        e.key === null ||
        [
          commusoftRecurringOutboxKey(scope),
          inputOutboxKey(scope),
          connectionOutboxKey(scope),
          captureOutboxKey(scope),
        ].includes(e.key)
      ) {
        restore();
        setReviewed(false);
      }
    };
    window.addEventListener("storage", changed);
    return () => {
      live.current = false;
      generation.current++;
      window.removeEventListener("storage", changed);
    };
  }, [tenantId, actorId, backend, client]);
  const account = overview.accounts.find((a) => a.id === selectedId) ?? overview.accounts[0];
  const config = accounts.find((a) => a.account_id === account?.id),
    connection = overview.connections.find((c) => c.id === account?.connection_id);
  const enabled = config?.enabled === true,
    owns = !config || config.approved_by === actorId;
  const canEnable =
    !!account &&
    owns &&
    account.status === "active" &&
    account.connector_enabled &&
    overview.flags["learn.enabled"] === true &&
    overview.flags["learn.inputs.commusoft.enabled"] === true &&
    !!connection &&
    !connection.revoked &&
    !!connection.verified_at &&
    connection.status === "configured" &&
    (!!config || account.checkpoint.complete === true);
  const disabled = busy || loading || blocked || canWrite !== true || !storageReady;
  async function resolve(mode: "apply" | "check" | "cancel") {
    if (working.current || !allowed() || !storageReady || blocked) return;
    const draft: SavedCommusoftRecurring | null =
      pending ??
      (account
        ? {
            version: 1,
            backend,
            request: {
              tenantId,
              actorId,
              requestId: crypto.randomUUID(),
              definition: {
                account_id: account.id,
                expected_revision: config?.revision ?? 0,
                enabled: !enabled,
                max_pages: config?.max_pages ?? pages,
                page_size: config?.page_size ?? size,
                reason: reason.trim(),
              },
            },
          }
        : null);
    if (
      !draft ||
      (!pending && (!ready || !reviewed || !reason.trim() || !owns || (!enabled && !canEnable)))
    )
      return;
    working.current = true;
    setBusy(true);
    onBlockingChange(true);
    setNotice("");
    const ticket = generation.current;
    try {
      const result = await resolveSavedCommusoftRecurring(
        db(),
        localStorage,
        async (key, task) => {
          if (!navigator.locks) throw Error("Browser request locking unavailable.");
          return navigator.locks.request(key, task);
        },
        scope,
        draft,
        mode,
        allowed,
      );
      if (!allowed() || ticket !== generation.current) return;
      setNotice(
        result.state === "pending"
          ? "No result is recorded yet. Keep this saved request."
          : result.state === "cancelled"
            ? "Unresolved request cancelled; recorded approvals are unchanged."
            : result.enabled
              ? "Ongoing capture approved. Completion and coverage still depend on the worker and provider."
              : "Ongoing capture paused. Retained source history is preserved.",
      );
      setReviewed(false);
      await load();
      await onChanged();
    } catch (e) {
      if (allowed()) setNotice(e instanceof Error ? e.message : "Check the saved result.");
    } finally {
      if (
        live.current &&
        current.current.tenantId === tenantId &&
        current.current.actorId === actorId &&
        current.current.backend === backend
      ) {
        working.current = false;
        setBusy(false);
        restore();
      }
    }
  }
  return (
    <section className="space-y-3 border-t pt-4" aria-label="Ongoing Commusoft capture">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">Ongoing Commusoft capture</h3>
        <button className="cp-secondary" disabled={busy || loading} onClick={() => void load()}>
          Refresh ongoing status
        </button>
      </div>
      <p className="text-sm">
        Each cycle checks the full customer/site inventory, jobs, customer contacts and site
        contacts. The first cycle reads full history; later job/contact stages use fixed update
        windows. A completed cycle advances coverage only after all four stages are verified.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {pending ? (
        <div className="rounded-xl border p-4 space-y-2">
          <h4 className="font-semibold">Saved ongoing-capture request</h4>
          <p>
            {pending.request.definition.enabled ? "Enable or resume" : "Pause"} ·{" "}
            {pending.request.definition.reason}
          </p>
          <p className="text-sm">
            Check the result before retrying. Cancellation does not undo a recorded approval.
          </p>
          <div className="flex flex-wrap gap-2">
            {(["check", "apply", "cancel"] as const).map((mode) => (
              <button
                key={mode}
                className="cp-secondary"
                disabled={disabled}
                onClick={() => void resolve(mode)}
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
      ) : !overview.accounts.length ? (
        <p>Complete the initial Commusoft import before approving ongoing capture.</p>
      ) : (
        <fieldset className="space-y-3" disabled={disabled || !ready}>
          <label className="block">
            Import account
            <select
              className="cp-input w-full"
              value={account?.id ?? ""}
              onChange={(e) => {
                setSelectedId(e.target.value);
                setReviewed(false);
              }}
            >
              {overview.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {overview.connections.find((c) => c.id === a.connection_id)?.account_key ??
                    "Commusoft"}{" "}
                  · {a.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <p>
            {config
              ? `${enabled ? "Enabled" : "Paused"} · ${commusoftRecurringStates[config.last_state]}`
              : "Not enabled"}
          </p>
          {config && (
            <div className="text-sm space-y-1">
              <p>
                Stage:{" "}
                {
                  [
                    "Between cycles",
                    "Customer and site inventory",
                    "Jobs",
                    "Customer contacts",
                    "Site contacts",
                  ][config.phase]
                }{" "}
                · Completed coverage through {stamp(config.watermark)}
              </p>
              <p>
                Next worker check: {stamp(config.next_check_at)} · Status recorded{" "}
                {stamp(config.updated_at)}
              </p>
              <p>
                Limit per stage: {config.max_pages.toLocaleString()} pages, up to {config.page_size}{" "}
                records per page.
              </p>
              {!owns && <p>The approving operator must change this ongoing-capture approval.</p>}
            </div>
          )}
          {!config && (
            <div className="flex flex-wrap gap-3">
              <label>
                Maximum pages per stage
                <input
                  className="cp-input block"
                  type="number"
                  min={1}
                  max={10000}
                  value={pages}
                  onChange={(e) => {
                    setPages(Number(e.target.value));
                    setReviewed(false);
                  }}
                />
              </label>
              <label>
                Records per page
                <input
                  className="cp-input block"
                  type="number"
                  min={1}
                  max={100}
                  value={size}
                  onChange={(e) => {
                    setSize(Number(e.target.value));
                    setReviewed(false);
                  }}
                />
              </label>
            </div>
          )}
          <label className="block">
            Reason
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
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            I have reviewed this company, the recurring read scope and page limits.
          </label>
          <button
            className="cp-secondary"
            disabled={!reviewed || !reason.trim() || !owns || (!enabled && !canEnable)}
            onClick={() => void resolve("apply")}
          >
            {enabled
              ? "Pause ongoing capture"
              : config
                ? "Resume ongoing capture"
                : "Approve ongoing capture"}
          </button>
          {!enabled && !canEnable && (
            <p className="text-sm">
              Verify the connection, enable the input and finish the initial import before starting.
              Existing pauses resume their retained stage.
            </p>
          )}
          <p className="text-sm">
            This approval remains active until paused or revoked. It does not publish customer cards
            or confirm provider coverage. Page-budget or authority failures need operator review.
          </p>
        </fieldset>
      )}
    </section>
  );
}
