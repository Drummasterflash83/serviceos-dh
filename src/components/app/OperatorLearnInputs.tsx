import { useEffect, useRef, useState } from "react";
import "@/styles/operator-learn-inputs.css";
import { getSupabaseClient, supabaseConfig } from "@/lib/supabase";
import {
  inputAccountStatus,
  readOperatorInputs,
  readOperatorInputWriteAccess,
  type InputFlags,
  type InputOverview,
  type OperatorInputClient,
  type OperatorInputDefinition,
} from "@/lib/learn-operator-inputs";
import {
  inputOutboxKey,
  readSavedInput,
  resolveSavedInput,
  type InputLock,
  type SavedInputRequest,
} from "@/lib/learn-operator-input-outbox";

export function OperatorLearnInputs({
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
  const scope = { tenantId, actorId, backend };
  const [data, setData] = useState<InputOverview | null>(null),
    [pending, setPending] = useState<SavedInputRequest | null>(null);
  const [busy, setBusy] = useState(false),
    [storageReady, setStorageReady] = useState(false),
    [notice, setNotice] = useState("");
  const [canWrite, setCanWrite] = useState<boolean | null>(null);
  const [values, setValues] = useState<InputFlags>({
    "learn.enabled": false,
    "learn.inputs.commusoft.enabled": false,
  });
  const [connection, setConnection] = useState(""),
    [resource, setResource] = useState<"properties" | "jobs" | "customer" | "workaddress">(
      "properties",
    );
  const [pages, setPages] = useState(10),
    [pageSize, setPageSize] = useState(50),
    [hours, setHours] = useState(1),
    [reason, setReason] = useState(""),
    [approved, setApproved] = useState(false);
  const generation = useRef(0),
    working = useRef(false);
  const db = () => client ?? getSupabaseClient();
  const current = (ticket: number) => generation.current === ticket;
  function restore() {
    try {
      setPending(readSavedInput(localStorage, scope));
      setStorageReady(Boolean(navigator.locks));
    } catch {
      setStorageReady(false);
      setNotice(
        "Saved requests could not be verified. Changes are paused; existing requests have been retained.",
      );
    }
  }
  async function refresh(ticket: number) {
    setCanWrite(null);
    const [d, permission] = await Promise.all([
      readOperatorInputs(db(), tenantId),
      readOperatorInputWriteAccess(db()),
    ]);
    if (!current(ticket)) return;
    setCanWrite(permission);
    setData(d);
    setValues({
      "learn.enabled": d.flags["learn.enabled"] === true,
      "learn.inputs.commusoft.enabled": d.flags["learn.inputs.commusoft.enabled"] === true,
    });
    setConnection((old) =>
      d.connections.some((c) => c.id === old) ? old : (d.connections[0]?.id ?? ""),
    );
  }
  async function operation(work: (ticket: number) => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setNotice("");
    setApproved(false);
    const ticket = ++generation.current;
    try {
      await work(ticket);
    } catch (e) {
      if (current(ticket)) {
        setData(null);
        setCanWrite(null);
        setNotice(
          e instanceof Error
            ? e.message
            : "The request could not be confirmed. Check the saved receipt.",
        );
      }
    } finally {
      if (current(ticket)) {
        working.current = false;
        setBusy(false);
        restore();
      }
    }
  }
  useEffect(() => {
    working.current = false;
    setBusy(false);
    setData(null);
    setCanWrite(null);
    setPending(null);
    setReason("");
    setApproved(false);
    restore();
    void operation(refresh);
    const changed = (event: StorageEvent) => {
      if (event.key === null || event.key === inputOutboxKey(scope)) {
        restore();
        setApproved(false);
      }
    };
    window.addEventListener("storage", changed);
    return () => {
      generation.current++;
      window.removeEventListener("storage", changed);
    };
  }, [tenantId, actorId, backend, client]);
  async function resolve(input: SavedInputRequest, mode: "apply" | "check" | "cancel") {
    if (canWrite !== true) return;
    await operation(async (ticket) => {
      const permission = await readOperatorInputWriteAccess(db());
      if (!current(ticket)) return;
      setCanWrite(permission);
      if (permission !== true) {
        setNotice(
          "Administrator access could not be confirmed. Any saved request has been retained.",
        );
        return;
      }
      const lock: InputLock = async (key, task) => {
        if (!navigator.locks)
          throw Error(
            "This browser cannot coordinate saved requests. Use a browser with secure storage support.",
          );
        return navigator.locks.request(key, task);
      };
      const receipt = await resolveSavedInput(db(), localStorage, lock, scope, input, mode, () =>
        current(ticket),
      );
      if (!current(ticket)) return;
      const message =
        receipt.state === "pending"
          ? "No receipt is recorded yet. Keep this request saved; retry it or cancel it explicitly."
          : receipt.state === "cancelled"
            ? "Request cancelled. A delayed copy cannot apply it."
            : receipt.kind === "set_modules"
              ? "Module settings recorded."
              : "Import approval recorded and queued. Check progress below; this is not a completed sync.";
      if (receipt.state !== "pending") {
        setReason("");
        try {
          await refresh(ticket);
        } catch {
          if (current(ticket)) {
            setData(null);
            setCanWrite(null);
            setNotice(
              `${message} Current status could not be refreshed. Refresh before making another change.`,
            );
          }
          return;
        }
      }
      if (current(ticket)) setNotice(message);
    });
  }
  function submit(definition: OperatorInputDefinition) {
    if (
      canWrite !== true ||
      !approved ||
      !data ||
      pending ||
      busy ||
      !storageReady ||
      !reason.trim()
    )
      return;
    void resolve(
      {
        version: 1,
        backend,
        request: { tenantId, actorId, requestId: crypto.randomUUID(), definition },
      },
      "apply",
    );
  }
  const selected = data?.connections.find((c) => c.id === connection);
  const canStart =
    selected?.status === "configured" &&
    !selected.revoked &&
    selected.credential_bound &&
    !!selected.verified_at &&
    ["uk", "us"].includes(selected.region ?? "") &&
    data?.flags["learn.enabled"] === true &&
    data.flags["learn.inputs.commusoft.enabled"] === true;
  const disabled = canWrite !== true || busy || !!pending || !data || !storageReady;
  const stamp = (value: string | null) =>
    value ? new Date(value).toLocaleString("en-GB") : "Not verified";
  const flagLabel = (value: boolean | null) =>
    value === null ? "Not configured" : value ? "On" : "Off";
  return (
    <section className="cp-card op-learn-inputs space-y-5" aria-labelledby="operator-learn-heading">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            OpenFolk · LEARN controls
          </p>
          <h2 id="operator-learn-heading" className="text-xl font-semibold">
            Customer and job inputs
          </h2>
          <p className="text-sm">Control this client’s input modules and review bounded imports.</p>
        </div>
        <button className="cp-secondary" disabled={busy} onClick={() => void operation(refresh)}>
          {busy ? "Working…" : "Refresh status"}
        </button>
      </header>
      {notice && (
        <p role="status" className="rounded-lg border p-3">
          {notice}
        </p>
      )}
      {data && canWrite !== true && (
        <p className="rounded-lg border p-3" role="status">
          {canWrite === false
            ? "Read-only access. You can review input status; an OpenFolk administrator is required to change settings or approve imports."
            : "Administrator access could not be verified. Input status is available; changes are paused until access can be checked."}
        </p>
      )}
      {!storageReady && (
        <p className="text-sm">
          Changes require working local storage and browser request locking. Status can still be
          refreshed.
        </p>
      )}
      {pending && (
        <div
          className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3"
          aria-label="Saved operator request"
        >
          <h3 className="font-semibold">Resolve the saved request</h3>
          <p>
            {pending.request.definition.kind === "set_modules"
              ? "Module settings change"
              : "Commusoft import approval"}{" "}
            · {pending.request.definition.reason}
          </p>
          <p className="text-sm">
            Check the recorded result before making another change. Cancelling prevents an
            unresolved request from applying; it does not undo a recorded approval.
          </p>
          {canWrite !== true && (
            <p className="text-sm">
              {canWrite === false
                ? "This request is retained. Restore administrator access for this operator, then refresh status to check its result."
                : "This request is retained. Refresh status to verify this operator’s administrator access before checking its result."}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              className="cp-secondary"
              disabled={canWrite !== true || busy || !storageReady}
              onClick={() => void resolve(pending, "check")}
            >
              Check saved result
            </button>
            <button
              className="cp-secondary"
              disabled={canWrite !== true || busy || !storageReady}
              onClick={() => void resolve(pending, "apply")}
            >
              Retry saved request
            </button>
            <button
              className="cp-secondary"
              disabled={canWrite !== true || busy || !storageReady}
              onClick={() => void resolve(pending, "cancel")}
            >
              Cancel unresolved request
            </button>
          </div>
        </div>
      )}
      {data && (
        <>
          <p className="text-xs text-muted-foreground">
            Last checked {stamp(data.checked_at)}. Status is a snapshot; refresh to check for
            changes.
          </p>
          <fieldset disabled={disabled} className="space-y-3">
            <legend className="font-semibold">Module switches</legend>
            <p className="text-sm">
              Recorded settings: LEARN {flagLabel(data.flags["learn.enabled"])} · Commusoft{" "}
              {flagLabel(data.flags["learn.inputs.commusoft.enabled"])}
            </p>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={(canWrite === true ? values : data.flags)["learn.enabled"] === true}
                onChange={(e) => {
                  setValues((v) => ({ ...v, "learn.enabled": e.target.checked }));
                  setApproved(false);
                }}
              />
              LEARN input processing
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={
                  (canWrite === true ? values : data.flags)["learn.inputs.commusoft.enabled"] ===
                  true
                }
                onChange={(e) => {
                  setValues((v) => ({ ...v, "learn.inputs.commusoft.enabled": e.target.checked }));
                  setApproved(false);
                }}
              />
              Commusoft customer and job input
            </label>
            <p className="text-sm">
              These switches currently govern Commusoft capture. Email, phone and Slack controls are
              still being connected. Disabling capture preserves retained history.
            </p>
            <button
              className="cp-secondary"
              disabled={!approved || !reason.trim()}
              onClick={() =>
                submit({ kind: "set_modules", reason: reason.trim(), expected: data.flags, values })
              }
            >
              Save module settings
            </button>
          </fieldset>
          <fieldset disabled={busy || !!pending || !data} className="space-y-3">
            <legend className="font-semibold">Commusoft connection and import</legend>
            {!data.connections.length ? (
              <p>
                No Commusoft connection has been recorded for this client. API access and a verified
                server-side credential are needed before importing.
              </p>
            ) : (
              <>
                <label className="block">
                  Connection
                  <select
                    className="cp-select w-full"
                    value={connection}
                    onChange={(e) => {
                      setConnection(e.target.value);
                      setApproved(false);
                    }}
                  >
                    {data.connections.map((c) => (
                      <option value={c.id} key={c.id}>
                        {c.account_key ?? "Commusoft connection"}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-sm">
                  {selected?.credential_bound
                    ? "Credential binding recorded"
                    : "Credential setup required"}{" "}
                  ·{" "}
                  {selected?.revoked
                    ? "Connection revoked"
                    : `Verification: ${stamp(selected?.verified_at ?? null)}`}
                </p>
                <fieldset
                  disabled={disabled}
                  className="grid gap-3 sm:grid-cols-2"
                  aria-label="Import limits"
                >
                  <label>
                    Collection
                    <select
                      className="cp-select w-full"
                      value={resource}
                      onChange={(e) => {
                        setResource(e.target.value as typeof resource);
                        setApproved(false);
                      }}
                    >
                      <option value="properties">Customers and work addresses</option>
                      <option value="jobs">Jobs</option>
                      <option value="customer">Customer contacts</option>
                      <option value="workaddress">Work-address contacts</option>
                    </select>
                  </label>
                  <label>
                    Maximum pages
                    <input
                      className="cp-input w-full"
                      type="number"
                      min={1}
                      max={10000}
                      value={pages}
                      onChange={(e) => {
                        setPages(Number(e.target.value));
                        setApproved(false);
                      }}
                    />
                  </label>
                  <label>
                    Records per page
                    <input
                      className="cp-input w-full"
                      type="number"
                      min={1}
                      max={100}
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setApproved(false);
                      }}
                    />
                  </label>
                  <label>
                    Approval valid for (hours)
                    <input
                      className="cp-input w-full"
                      type="number"
                      min={1}
                      max={24}
                      value={hours}
                      onChange={(e) => {
                        setHours(Number(e.target.value));
                        setApproved(false);
                      }}
                    />
                  </label>
                </fieldset>
                <p className="text-sm">
                  The worker reads one collection within these limits. An incomplete earlier import
                  must be reviewed before a new one can start. Contact capture does not yet create
                  reviewed contact cards.
                </p>
                {resource === "workaddress" && (
                  <p className="text-sm">
                    Confirm work-address contact support with this Commusoft account before
                    approving this collection.
                  </p>
                )}
                <button
                  className="cp-primary"
                  disabled={
                    disabled ||
                    !canStart ||
                    !approved ||
                    !reason.trim() ||
                    !Number.isInteger(hours) ||
                    hours < 1 ||
                    hours > 24 ||
                    !Number.isInteger(pages) ||
                    pages < 1 ||
                    pages > 10000 ||
                    !Number.isInteger(pageSize) ||
                    pageSize < 1 ||
                    pageSize > 100
                  }
                  onClick={() => {
                    if (selected)
                      submit({
                        kind: "start_commusoft",
                        reason: reason.trim(),
                        connection_id: selected.id,
                        revision: selected.revision,
                        resource: ["customer", "workaddress"].includes(resource)
                          ? "propertyContacts"
                          : (resource as "properties" | "jobs"),
                        ...(["customer", "workaddress"].includes(resource)
                          ? { contact_type: resource as "customer" | "workaddress" }
                          : {}),
                        max_pages: pages,
                        page_size: pageSize,
                        expires_at: new Date(Date.now() + hours * 3600000).toISOString(),
                      });
                  }}
                >
                  Approve import
                </button>
                {!canStart && (
                  <p className="text-sm">
                    Enable both switches and complete connection verification before approving an
                    import.
                  </p>
                )}
              </>
            )}
          </fieldset>
          <fieldset disabled={disabled} className="space-y-3 border-t pt-4">
            <legend className="font-semibold">Confirm your change</legend>
            <label className="block">
              Reason
              <textarea
                className="cp-input w-full"
                maxLength={1000}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setApproved(false);
                }}
              />
            </label>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={approved}
                onChange={(e) => setApproved(e.target.checked)}
              />
              I have reviewed this client, the settings and the import scope.
            </label>
          </fieldset>
          <div className="space-y-3">
            <h3 className="font-semibold">Import progress</h3>
            {!data.accounts.length && <p>No import account has been recorded.</p>}
            {data.accounts.map((a) => (
              <article key={a.id} className="rounded-xl border p-4 space-y-1">
                <h4 className="font-semibold">{a.resource ?? "Commusoft"}</h4>
                <p>{inputAccountStatus(a, data.flags)}</p>
                <p className="text-sm">
                  {a.checkpoint.pages ?? 0} pages retained · approval expires {stamp(a.expires_at)}
                </p>
                {a.latest_job?.error_code && (
                  <p className="text-sm">
                    Diagnostic: {a.latest_job.error_code}. Review connection authority and retained
                    progress before retrying.
                  </p>
                )}
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
