import { useEffect, useRef, useState } from "react";
import { OperatorCommusoftRecurring } from "./OperatorCommusoftRecurring";
import { OperatorScheduledActivityProbe } from "./OperatorScheduledActivityProbe";
import { OperatorCommusoftUsersPage } from "./OperatorCommusoftUsersPage";
import { OperatorCommusoftResume } from "./OperatorCommusoftResume";
import { OperatorCommusoftConnection } from "./OperatorCommusoftConnection";
import { OperatorSlackConnection } from "./OperatorSlackConnection";
import { OperatorQuickBooksConnection } from "./OperatorQuickBooksConnection";
import type { ConnectionControlClient } from "@/lib/learn-commusoft-connection-outbox";
import { connectionOutboxKey } from "@/lib/learn-operator-request-scope";
import "@/styles/operator-learn-inputs.css";
import { getSupabaseClient, supabaseConfig } from "@/lib/supabase";
import {
  inputAccountStatus,
  readOperatorInputs,
  readOperatorInputWriteAccess,
  type InputFlags,
  type InputOverview,
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
  client?: ConnectionControlClient;
  backend?: string;
}) {
  const scope = { tenantId, actorId, backend };
  const [data, setData] = useState<InputOverview | null>(null),
    [pending, setPending] = useState<SavedInputRequest | null>(null);
  const [busy, setBusy] = useState(false),
    [storageReady, setStorageReady] = useState(false),
    [notice, setNotice] = useState("");
  const [canWrite, setCanWrite] = useState<boolean | null>(null);
  const [usersCaptureEnabled, setUsersCaptureEnabled] = useState<boolean | null>(null);
  const [slackOpen, setSlackOpen] = useState(false);
  const [quickbooksOpen, setQuickbooksOpen] = useState(false);
  const [recurringBlocked, setRecurringBlocked] = useState(false);
  const [connectionBlocked, setConnectionBlocked] = useState(true);
  const [values, setValues] = useState<InputFlags>({
    "learn.enabled": false,
    "learn.inputs.commusoft.enabled": false,
  });
  const [connection, setConnection] = useState(""),
    [resource, setResource] = useState<"properties" | "jobs" | "users" | "customer" | "workaddress">(
      "properties",
    );
  const [pages, setPages] = useState(10),
    [pageSize, setPageSize] = useState(50),
    [hours, setHours] = useState(1),
    [reason, setReason] = useState(""),
    [approved, setApproved] = useState(false);
  const [updatedOnly, setUpdatedOnly] = useState(false),
    [updatedFrom, setUpdatedFrom] = useState(""),
    [updatedBefore, setUpdatedBefore] = useState("");
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
    setUsersCaptureEnabled(null);
    const [d, permission, usersFlag] = await Promise.all([
      readOperatorInputs(db(), tenantId),
      readOperatorInputWriteAccess(db()),
      getSupabaseClient().from("feature_flags").select("value")
        .eq("tenant_id", tenantId)
        .eq("flag", "learn.inputs.commusoft.users.enabled")
        .maybeSingle(),
    ]);
    if (!current(ticket)) return;
    setCanWrite(permission);
    setUsersCaptureEnabled(usersFlag.error ? null : usersFlag.data?.value === true);
    setData(d);
    setValues({
      "learn.enabled": d.flags["learn.enabled"] === true,
      "learn.inputs.commusoft.enabled": d.flags["learn.inputs.commusoft.enabled"] === true,
    });
    setConnection((old) =>
      d.connections.some((c) => c.id === old) ? old : (d.connections[0]?.id ?? ""),
    );
    if ((usersFlag.error || usersFlag.data?.value !== true) && resource === "users") {
      setResource("properties");
      setPages(10);
      setPageSize(50);
    }
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
    setUsersCaptureEnabled(null);
    setPending(null);
    setReason("");
    setApproved(false);
    setUpdatedOnly(false);
    setUpdatedFrom("");
    setUpdatedBefore("");
    restore();
    void operation(refresh);
    const changed = (event: StorageEvent) => {
      if (
        event.key === null ||
        event.key === inputOutboxKey(scope) ||
        event.key === connectionOutboxKey(scope)
      ) {
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
              : receipt.kind === "resume_commusoft"
                ? "Continuation recorded and queued from the saved position. Retained history is unchanged; check progress below."
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
      connectionBlocked ||
      recurringBlocked ||
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
  const updateWindowsAvailable =
    data?.accounts.some((a) => Object.hasOwn(a, "updated_window")) === true;
  const fromTime = Date.parse(updatedFrom + "Z"),
    beforeTime = Date.parse(updatedBefore + "Z");
  const updateWindowValid =
    updateWindowsAvailable &&
    Number.isFinite(fromTime) &&
    fromTime >= 0 &&
    Number.isFinite(beforeTime) &&
    fromTime < beforeTime &&
    beforeTime <= Date.now();
  const unfinished = data?.accounts.some(
    (a) =>
      a.connection_id === selected?.id &&
      (a.checkpoint.complete !== true ||
        a.checkpoint.approvalId !== a.approval_id ||
        ["queued", "running", "retrying"].includes(a.latest_job?.status ?? "")),
  );
  const canStart =
    !unfinished &&
    selected?.status === "configured" &&
    !selected.revoked &&
    selected.credential_bound &&
    !!selected.verified_at &&
    ["uk", "us"].includes(selected.region ?? "") &&
    data?.flags["learn.enabled"] === true &&
    data.flags["learn.inputs.commusoft.enabled"] === true;
  const disabled =
    canWrite !== true ||
    busy ||
    !!pending ||
    connectionBlocked ||
    recurringBlocked ||
    !data ||
    !storageReady;
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
              : pending.request.definition.kind === "resume_commusoft"
                ? "Commusoft import continuation"
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
      <OperatorCommusoftConnection
        tenantId={tenantId}
        actorId={actorId}
        backend={backend}
        client={client}
        connection={selected ?? null}
        statusReady={!!data}
        canWrite={canWrite}
        blocked={busy || !!pending || recurringBlocked}
        onBlockingChange={setConnectionBlocked}
        onAccessChange={setCanWrite}
        onChanged={() => refresh(generation.current)}
      />
      <OperatorScheduledActivityProbe tenantId={tenantId} connectionId={selected?.id ?? null} canRun={canWrite === true && !busy && !pending} />
      {usersCaptureEnabled === true && selected && canWrite === true && (
        <OperatorCommusoftUsersPage
          key={`${backend}:${tenantId}:${actorId}:${selected.id}`}
          tenantId={tenantId}
          actorId={actorId}
          connectionId={selected.id}
          backend={backend}
          canRun={!busy && !pending && !connectionBlocked && selected.status === "configured" &&
            !selected.revoked && selected.credential_bound && !!selected.verified_at}
        />
      )}
      <details
        className="rounded-xl border p-4"
        open={slackOpen}
        onToggle={(event) => setSlackOpen(event.currentTarget.open)}
      >
        <summary className="cursor-pointer font-semibold">Slack channel capture</summary>
        {slackOpen && (
          <div className="pt-4">
            <OperatorSlackConnection
              key={`${backend}:${tenantId}:${actorId}`}
              tenantId={tenantId}
              actorId={actorId}
              canWrite={canWrite === true && !busy && !pending}
            />
          </div>
        )}
      </details>
      <details className="rounded-xl border p-4" open={quickbooksOpen} onToggle={(event) => setQuickbooksOpen(event.currentTarget.open)}>
        <summary className="cursor-pointer font-semibold">QuickBooks accounting connection</summary>
        {quickbooksOpen && <div className="pt-4"><OperatorQuickBooksConnection
          key={`${backend}:${tenantId}:${actorId}`} tenantId={tenantId} actorId={actorId}
          canWrite={canWrite === true && !busy && !pending}
        /></div>}
      </details>
      {data && (
        <>
          <p className="text-xs text-muted-foreground">
            Last checked {stamp(data.checked_at)}. Status is a snapshot; refresh to check for
            changes.
          </p>
          <fieldset disabled={disabled} className="space-y-3">
            <legend className="font-semibold">Commusoft input switch</legend>
            <p className="text-sm">
              Recorded settings: LEARN {flagLabel(data.flags["learn.enabled"])} · Commusoft{" "}
              {flagLabel(data.flags["learn.inputs.commusoft.enabled"])}
            </p>
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
              Manage the shared LEARN master switch in LEARN capture settings above. This setting
              controls Commusoft input; disabling it preserves retained customer and job history.
            </p>
            <button
              className="cp-secondary"
              disabled={!approved || !reason.trim() || data.flags["learn.enabled"] === null}
              onClick={() =>
                data.flags["learn.enabled"] !== null &&
                submit({
                  kind: "set_modules",
                  reason: reason.trim(),
                  expected: data.flags,
                  values: { ...values, "learn.enabled": data.flags["learn.enabled"] },
                })
              }
            >
              Save Commusoft setting
            </button>
            {data.flags["learn.enabled"] === null && (
              <p className="text-sm">
                Review and save the LEARN master setting above before changing Commusoft input.
              </p>
            )}
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
                        const next = e.target.value as typeof resource;
                        setResource(next);
                        if (next === "users") {
                          setPages(1);
                          setPageSize(10);
                        }
                        setApproved(false);
                      }}
                    >
                      <option value="properties">Customers and work addresses</option>
                      <option value="jobs">Jobs</option>
                      <option value="users" disabled={usersCaptureEnabled !== true}>Source users (held for review)</option>
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
                      max={resource === "users" ? 1 : 10000}
                      disabled={resource === "users"}
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
                      max={resource === "users" ? 10 : 100}
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
                {updateWindowsAvailable && (
                  <fieldset className="space-y-3">
                    <legend className="font-semibold">Refresh existing records</legend>
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={updatedOnly}
                        onChange={(e) => {
                          setUpdatedOnly(e.target.checked);
                          setApproved(false);
                        }}
                      />
                      Read only records updated during a fixed period
                    </label>
                    {updatedOnly && (
                      <>
                        <label className="block">
                          Updated from (UTC, inclusive)
                          <input
                            className="cp-input w-full"
                            type="datetime-local"
                            value={updatedFrom}
                            onChange={(e) => {
                              setUpdatedFrom(e.target.value);
                              setApproved(false);
                            }}
                          />
                        </label>
                        <label className="block">
                          Updated before (UTC, exclusive)
                          <input
                            className="cp-input w-full"
                            type="datetime-local"
                            value={updatedBefore}
                            onChange={(e) => {
                              setUpdatedBefore(e.target.value);
                              setApproved(false);
                            }}
                          />
                        </label>
                        <p className="text-sm">
                          Use a past period and overlap the previous successful refresh. Saved
                          history stays available. This does not check deletions or start an
                          automatic schedule.
                        </p>
                        {!updateWindowValid && (
                          <p className="text-sm">
                            Choose two valid UTC times, with the end after the start and no later
                            than now.
                          </p>
                        )}
                      </>
                    )}
                  </fieldset>
                )}
                <p className="text-sm">
                  The worker reads one collection within these limits. An incomplete earlier import
                  must be reviewed before a new one can start. Captured contacts are available for
                  review and linking to existing people, customers and sites.
                </p>
                {usersCaptureEnabled !== true && (
                  <p className="text-sm">Source-user capture is unavailable for this company. OpenFolk must
                    review and enable its separate source-user setting before an import can be approved.</p>
                )}
                {resource === "users" && (
                  <p className="text-sm">This reads one page of at most 10 Commusoft user records.
                    They remain held source evidence: no person, engineer, appointment, or staff login
                    is confirmed by this import.</p>
                )}
                {["customer", "workaddress"].includes(resource) && (
                  <p className="text-sm">
                    Contacts are read separately for each property in the last completed property
                    import. A later contact import can include newly imported properties.
                  </p>
                )}
                <button
                  className="cp-primary"
                  disabled={
                    disabled ||
                    !canStart ||
                    (resource === "users" && usersCaptureEnabled !== true) ||
                    (updatedOnly && !updateWindowValid) ||
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
                    if (selected && (resource !== "users" || usersCaptureEnabled === true) &&
                        (!updatedOnly || updateWindowValid))
                      submit({
                        kind: "start_commusoft",
                        reason: reason.trim(),
                        connection_id: selected.id,
                        revision: selected.revision,
                        resource: ["customer", "workaddress"].includes(resource)
                          ? "propertyContacts"
                          : (resource as "properties" | "jobs" | "users"),
                        ...(["customer", "workaddress"].includes(resource)
                          ? { contact_type: resource as "customer" | "workaddress" }
                          : {}),
                        max_pages: pages,
                        page_size: pageSize,
                        ...(updatedOnly && updateWindowValid
                          ? {
                              updatedFrom: new Date(fromTime).toISOString(),
                              updatedBefore: new Date(beforeTime).toISOString(),
                            }
                          : {}),
                        expires_at: new Date(Date.now() + hours * 3600000).toISOString(),
                      });
                  }}
                >
                  Approve import
                </button>
                {!canStart && (
                  <p className="text-sm">
                    {unfinished
                      ? "This connection has unfinished work. Review its progress below and continue from the saved position when the current job has settled."
                      : "Enable LEARN and the Commusoft input, then complete connection verification before approving an import."}
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
          <OperatorCommusoftRecurring
            key={`${backend}:${actorId}:${tenantId}`}
            tenantId={tenantId}
            actorId={actorId}
            backend={backend}
            overview={data}
            canWrite={canWrite}
            blocked={busy || !!pending || connectionBlocked}
            client={client}
            onBlockingChange={setRecurringBlocked}
            onChanged={() => refresh(generation.current)}
          />
          <div className="space-y-3">
            <h3 className="font-semibold">Import progress</h3>
            {!data.accounts.length && <p>No import account has been recorded.</p>}
            {data.accounts.map((a) => (
              <article key={a.id} className="rounded-xl border p-4 space-y-1">
                <h4 className="font-semibold">{a.resource ?? "Commusoft"}</h4>
                <p>{inputAccountStatus(a, data.flags)}</p>
                {a.updated_window && (
                  <p className="text-sm">
                    Changed-record window (your local time): {stamp(a.updated_window.updatedFrom)}{" "}
                    to {stamp(a.updated_window.updatedBefore)} (end excluded). This covers the
                    selected period, not the full collection.
                  </p>
                )}
                <p className="text-sm">
                  {a.checkpoint.pages ?? 0} pages retained · approval expires {stamp(a.expires_at)}
                </p>
                {a.resource === "propertyContacts" && a.contact_target_count != null && (
                  <p className="text-sm">
                    {a.checkpoint.propertiesCompleted ?? 0} of {a.contact_target_count} properties
                    checked for contacts. Retained pages are preserved when work pauses.
                  </p>
                )}
                {a.latest_job?.error_code && (
                  <p className="text-sm">
                    Diagnostic: {a.latest_job.error_code}. Review connection authority and retained
                    progress before retrying.
                  </p>
                )}
                <OperatorCommusoftResume
                  key={`${a.id}:${a.latest_job?.id}:${a.checkpoint.pages}`}
                  account={a}
                  connection={data.connections.find((c) => c.id === a.connection_id)}
                  flags={data.flags}
                  disabled={disabled}
                  approved={approved}
                  usersCaptureEnabled={usersCaptureEnabled === true}
                  reason={reason}
                  onChange={() => setApproved(false)}
                  onSubmit={submit}
                />
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
