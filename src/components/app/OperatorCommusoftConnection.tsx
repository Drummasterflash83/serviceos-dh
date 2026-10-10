import { useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import { readOperatorInputWriteAccess, type InputConnection } from "@/lib/learn-operator-inputs";
import {
  connectionOutboxKey,
  readSavedConnection,
  resolveSavedConnection,
  connectionResultMessage,
  type SavedConnectionRequest,
  type ConnectionControlClient,
  type ConnectionResult,
} from "@/lib/learn-commusoft-connection-outbox";
import { inputOutboxKey, type InputLock } from "@/lib/learn-operator-request-scope";

export function OperatorCommusoftConnection({
  tenantId,
  actorId,
  backend,
  client,
  connection,
  statusReady,
  canWrite,
  blocked,
  onBlockingChange,
  onAccessChange,
  onChanged,
}: {
  tenantId: string;
  actorId: string;
  backend: string;
  client?: ConnectionControlClient;
  connection: InputConnection | null;
  statusReady: boolean;
  canWrite: boolean | null;
  blocked: boolean;
  onBlockingChange: (blocked: boolean) => void;
  onAccessChange: (access: boolean | null) => void;
  onChanged: () => Promise<void>;
}) {
  const scope = { tenantId, actorId, backend };
  const [pending, setPending] = useState<SavedConnectionRequest | null>(null);
  const [storageReady, setStorageReady] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [accountKey, setAccountKey] = useState(""),
    [region, setRegion] = useState<"uk" | "us">("uk");
  const [credentialMode, setCredentialMode] = useState<"reuse" | "replace">("reuse");
  const [reason, setReason] = useState(""),
    [sameAccount, setSameAccount] = useState(false),
    [oneRead, setOneRead] = useState(false);
  const [result, setResult] = useState<ConnectionResult | null>(null);
  const secret = useRef<HTMLInputElement>(null),
    retrySecret = useRef<HTMLInputElement>(null);
  const generation = useRef(0),
    working = useRef(false);
  const db = () => client ?? getSupabaseClient();
  const current = (ticket: number) => generation.current === ticket;
  const clearSecrets = () => {
    if (secret.current) secret.current.value = "";
    if (retrySecret.current) retrySecret.current.value = "";
  };
  function restore() {
    try {
      const saved = readSavedConnection(localStorage, scope),
        ready = Boolean(navigator.locks);
      setPending(saved);
      setStorageReady(ready);
      onBlockingChange(working.current || !!saved || !ready);
    } catch {
      setStorageReady(false);
      onBlockingChange(true);
      setNotice(
        "Saved connection requests could not be verified. They are retained; changes are paused until recovery storage can be read.",
      );
    }
  }
  useEffect(() => {
    generation.current++;
    working.current = false;
    setBusy(false);
    setPending(null);
    setNotice("");
    setResult(null);
    setReason("");
    setSameAccount(false);
    setOneRead(false);
    clearSecrets();
    restore();
    const changed = (event: StorageEvent) => {
      if (
        event.key === null ||
        event.key === connectionOutboxKey(scope) ||
        event.key === inputOutboxKey(scope)
      ) {
        clearSecrets();
        setSameAccount(false);
        setOneRead(false);
        restore();
      }
    };
    window.addEventListener("storage", changed);
    return () => {
      generation.current++;
      clearSecrets();
      window.removeEventListener("storage", changed);
    };
  }, [tenantId, actorId, backend, client]);
  useEffect(() => {
    setAccountKey(connection?.account_key ?? "");
    setRegion(connection?.region === "us" ? "us" : "uk");
    setCredentialMode("reuse");
    clearSecrets();
    setSameAccount(false);
    setOneRead(false);
  }, [tenantId, actorId, backend, connection?.id, connection?.revision]);
  useEffect(() => {
    if (canWrite !== true || blocked) clearSecrets();
  }, [canWrite, blocked]);

  async function resolve(
    input: SavedConnectionRequest,
    mode: "apply" | "check" | "cancel",
    apiKey?: string,
  ) {
    clearSecrets();
    if (working.current || blocked || canWrite !== true || !storageReady) return;
    working.current = true;
    setBusy(true);
    onBlockingChange(true);
    setNotice("");
    setSameAccount(false);
    setOneRead(false);
    const ticket = ++generation.current;
    try {
      const access = await readOperatorInputWriteAccess(db());
      if (!current(ticket)) return;
      onAccessChange(access);
      if (access !== true) {
        setNotice(
          "Administrator access could not be confirmed. Any saved connection request has been retained.",
        );
        return;
      }
      const lock: InputLock = async (key, task) => {
        if (!navigator.locks)
          throw Error("This browser cannot coordinate saved requests. Changes are paused.");
        return navigator.locks.request(key, task);
      };
      const response = await resolveSavedConnection(
        db(),
        localStorage,
        lock,
        scope,
        input,
        mode,
        () => current(ticket),
        apiKey,
      );
      if (!current(ticket)) return;
      setResult(response);
      const message = connectionResultMessage(response);
      if (response.receipt.state === "recorded" || response.receipt.state === "cancelled") {
        setReason("");
        try {
          await onChanged();
        } catch {
          if (current(ticket))
            setNotice(
              `${message} Current status could not be refreshed. Refresh status before making another change.`,
            );
          return;
        }
      }
      if (current(ticket)) setNotice(message);
    } catch (error) {
      if (current(ticket))
        setNotice(
          error instanceof Error
            ? error.message
            : "The connection request was not confirmed. Check its saved result.",
        );
    } finally {
      if (current(ticket)) {
        working.current = false;
        setBusy(false);
        clearSecrets();
        restore();
      }
    }
  }
  const disabled =
    blocked || busy || !!pending || !storageReady || canWrite !== true || !statusReady;
  const recoveryDisabled = blocked || busy || !storageReady || canWrite !== true;
  const hasIdentity = !!connection?.account_key;
  const unsupportedRegion = !!connection?.region && !["uk", "us"].includes(connection.region);
  const canVerify =
    connection?.status === "configured" &&
    !connection.revoked &&
    connection.credential_bound &&
    ["uk", "us"].includes(connection.region ?? "");
  const retryWaiting =
    result?.kind === "verify_commusoft" &&
    (result.receipt.state === "running" || result.receipt.state === "expired");
  function saved(request: SavedConnectionRequest["request"]): SavedConnectionRequest {
    return { version: 1, backend, request };
  }
  return (
    <section aria-labelledby="commusoft-setup-heading" className="rounded-xl border p-4 space-y-4">
      <header>
        <h3 id="commusoft-setup-heading" className="font-semibold">
          Commusoft access
        </h3>
        <p className="text-sm">
          Save the connection, check access, then approve an import separately.
        </p>
      </header>
      {notice && (
        <p role="status" className="rounded-lg border p-3">
          {notice}
        </p>
      )}
      {!storageReady && (
        <p className="text-sm">
          Connection changes require readable recovery storage and browser request locking.
        </p>
      )}
      {pending && (
        <div
          aria-label="Saved connection request"
          className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3"
        >
          <h4 className="font-semibold">Resolve the saved connection request</h4>
          <p>
            {pending.request.definition.kind === "configure_commusoft"
              ? "Connection setup"
              : "Connection access check"}{" "}
            · {pending.request.definition.reason}
          </p>
          <p className="text-xs break-all">Request reference: {pending.request.requestId}</p>
          <p className="text-sm">
            Check the recorded result first. A retry uses this same request; cancellation prevents
            an unresolved request from completing.
          </p>
          {canWrite !== true && (
            <p className="text-sm">
              The request is retained. Restore administrator access for this operator and refresh
              status before checking its result.
            </p>
          )}
          {pending.request.definition.kind === "configure_commusoft" &&
            pending.request.definition.credential_mode === "replace" && (
              <label className="block text-sm">
                Credential for retry
                <input
                  ref={retrySecret}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={4096}
                  className="cp-input w-full"
                  disabled={recoveryDisabled}
                  aria-label="Credential for saved connection retry"
                />
                <span>
                  Only needed if setup was not recorded. The credential is never saved in browser
                  recovery storage.
                </span>
              </label>
            )}
          <div className="flex flex-wrap gap-2">
            <button
              className="cp-secondary"
              disabled={recoveryDisabled}
              onClick={() => void resolve(pending, "check")}
            >
              Check connection result
            </button>
            <button
              className="cp-secondary"
              disabled={recoveryDisabled || retryWaiting}
              onClick={() =>
                void resolve(pending, "apply", retrySecret.current?.value || undefined)
              }
            >
              Retry saved connection request
            </button>
            <button
              className="cp-secondary"
              disabled={recoveryDisabled}
              onClick={() => void resolve(pending, "cancel")}
            >
              Cancel saved connection request
            </button>
          </div>
        </div>
      )}
      <fieldset disabled={disabled} className="space-y-3">
        <legend className="font-semibold">Connection setup</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            Commusoft account reference
            <input
              className="cp-input w-full"
              maxLength={2000}
              value={accountKey}
              readOnly={hasIdentity}
              onChange={(e) => {
                setAccountKey(e.target.value);
                setSameAccount(false);
              }}
            />
          </label>
          <label>
            Account region
            <select
              className="cp-select w-full"
              value={unsupportedRegion ? "" : region}
              disabled={!!connection?.region}
              onChange={(e) => {
                setRegion(e.target.value as "uk" | "us");
                setSameAccount(false);
              }}
            >
              {unsupportedRegion && <option value="">Unsupported stored region</option>}
              <option value="uk">United Kingdom</option>
              <option value="us">United States</option>
            </select>
          </label>
        </div>
        <p className="text-sm">
          Use a stable reference for this client’s Commusoft account. Existing account identity is
          retained when maintaining its credential.
        </p>
        <label className="block">
          Credential choice
          <select
            className="cp-select w-full"
            value={credentialMode}
            onChange={(e) => {
              setCredentialMode(e.target.value as "reuse" | "replace");
              clearSecrets();
              setSameAccount(false);
            }}
          >
            <option value="reuse">Reuse this client’s stored credential</option>
            <option value="replace">Save a new or replacement credential</option>
          </select>
        </label>
        {credentialMode === "replace" && (
          <label className="block">
            Commusoft private-application API key
            <input
              ref={secret}
              type="password"
              autoComplete="off"
              spellCheck={false}
              maxLength={4096}
              className="cp-input w-full"
            />
            <span className="text-sm">
              Sent to secure server storage on save. It will not be included in the saved request or
              shown again.
            </span>
          </label>
        )}
        <label className="block">
          Connection change reason
          <textarea
            className="cp-input w-full"
            maxLength={1000}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setSameAccount(false);
              setOneRead(false);
            }}
          />
        </label>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={sameAccount}
            onChange={(e) => setSameAccount(e.target.checked)}
          />
          I confirm this credential belongs to this client’s Commusoft account and selected region.
        </label>
        <button
          className="cp-secondary"
          disabled={unsupportedRegion || !sameAccount || !reason.trim() || !accountKey.trim()}
          onClick={() => {
            if (
              disabled ||
              unsupportedRegion ||
              !sameAccount ||
              !reason.trim() ||
              !accountKey.trim()
            )
              return;
            const apiKey = credentialMode === "replace" ? secret.current?.value : undefined;
            if (
              credentialMode === "replace" &&
              (!apiKey || !/^[\x21-\x7e]{1,4096}$/.test(apiKey))
            ) {
              setNotice("Enter a valid private-application credential before saving.");
              return;
            }
            void resolve(
              saved({
                tenantId,
                actorId,
                requestId: crypto.randomUUID(),
                definition: {
                  kind: "configure_commusoft",
                  reason: reason.trim(),
                  account_key: accountKey.trim(),
                  region,
                  expected_revision: connection?.revision ?? null,
                  credential_mode: credentialMode,
                  same_account_confirmed: true,
                },
              }),
              "apply",
              apiKey,
            );
          }}
        >
          Save Commusoft connection
        </button>
        <p className="text-sm">
          Saving clears previous verification. It does not enable capture or start an import.
        </p>
      </fieldset>
      <fieldset disabled={disabled} className="space-y-3 border-t pt-3">
        <legend className="font-semibold">Check connection access</legend>
        <p className="text-sm">
          The check uses the stored key to read at most one property. It retains the result, not
          customer data, and does not start an import.
        </p>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={oneRead} onChange={(e) => setOneRead(e.target.checked)} />
          I approve this one read from this client’s Commusoft account.
        </label>
        <button
          className="cp-primary"
          disabled={!canVerify || !oneRead || !reason.trim()}
          onClick={() => {
            if (disabled || !connection || !canVerify || !oneRead || !reason.trim()) return;
            void resolve(
              saved({
                tenantId,
                actorId,
                requestId: crypto.randomUUID(),
                definition: {
                  kind: "verify_commusoft",
                  reason: reason.trim(),
                  connection_id: connection.id,
                  revision: connection.revision,
                  one_read_confirmed: true,
                },
              }),
              "apply",
            );
          }}
        >
          Check Commusoft access
        </button>
        {!canVerify && (
          <p className="text-sm">
            Save a configured connection and credential binding before checking access.
          </p>
        )}
        <p className="text-sm">
          Enter a connection change reason above for either action. A successful properties check
          does not establish job/contact access or full account coverage.
        </p>
      </fieldset>
    </section>
  );
}
