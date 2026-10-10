import { useEffect, useRef, useState } from "react";
import { getSupabaseClient, supabaseConfig } from "@/lib/supabase";
import {
  readOperatorInputWriteAccess,
  type OperatorInputClient,
} from "@/lib/learn-operator-inputs";
import {
  captureFlags,
  readCaptureControls,
  readSavedCapture,
  resolveSavedCapture,
  type CaptureControls,
  type CaptureValues,
  type SavedCapture,
} from "@/lib/learn-operator-capture-controls";
import {
  inputOutboxKey,
  captureOutboxKey,
  connectionOutboxKey,
  type InputLock,
} from "@/lib/learn-operator-request-scope";
import "@/styles/operator-learn-inputs.css";

const labels = {
  "learn.enabled": "LEARN input processing",
  "learn.inputs.email.enabled": "Email",
  "learn.inputs.phone.enabled": "Phone",
  "learn.inputs.slack.enabled": "Slack",
};
const empty = {
  "learn.enabled": null,
  "learn.inputs.email.enabled": null,
  "learn.inputs.phone.enabled": null,
  "learn.inputs.slack.enabled": null,
};
export function OperatorCaptureControls({
  tenantId,
  actorId,
  client,
  backend = supabaseConfig.url.replace(/\/$/, ""),
  onRecorded,
}: {
  tenantId: string;
  actorId: string;
  client?: OperatorInputClient;
  backend?: string;
  onRecorded?: () => void;
}) {
  const scope = { tenantId, actorId, backend };
  const [data, setData] = useState<CaptureControls | null>(null);
  const [draft, setDraft] = useState<CaptureControls["flags"]>(empty);
  const [pending, setPending] = useState<SavedCapture | null>(null);
  const [canWrite, setCanWrite] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [reason, setReason] = useState(""),
    [reviewed, setReviewed] = useState(false),
    [otherPending, setOtherPending] = useState(false);
  const generation = useRef(0),
    working = useRef(false);
  const db = () => client ?? getSupabaseClient();
  function restore() {
    try {
      setPending(readSavedCapture(localStorage, scope));
      setOtherPending(
        [inputOutboxKey(scope), connectionOutboxKey(scope)].some(
          (k) => localStorage.getItem(k) !== null,
        ),
      );
      setReady(Boolean(navigator.locks));
    } catch {
      setReady(false);
      setNotice(
        "Saved requests could not be checked. Changes are paused; refresh after restoring browser storage.",
      );
    }
  }
  async function refresh(ticket: number) {
    const [controls, permission] = await Promise.all([
      readCaptureControls(db(), tenantId),
      readOperatorInputWriteAccess(db()),
    ]);
    if (ticket !== generation.current) return;
    setData(controls);
    setDraft({ ...controls.flags });
    setCanWrite(permission);
    setReviewed(false);
  }
  async function operation(work: (ticket: number) => Promise<void>, keepCheckedAccess = false) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setNotice("");
    setReviewed(false);
    const ticket = ++generation.current;
    try {
      await work(ticket);
    } catch (e) {
      if (ticket === generation.current) {
        setData(null);
        if (!keepCheckedAccess) setCanWrite(null);
        setNotice(
          e instanceof Error
            ? e.message
            : "The result could not be confirmed. Check the saved request.",
        );
      }
    } finally {
      if (ticket === generation.current) {
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
    setPending(null);
    setCanWrite(null);
    setDraft(empty);
    setReason("");
    setReviewed(false);
    restore();
    void operation(refresh);
    const changed = (e: StorageEvent) => {
      if (
        e.key === null ||
        [inputOutboxKey(scope), captureOutboxKey(scope), connectionOutboxKey(scope)].includes(e.key)
      ) {
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
  async function resolve(saved: SavedCapture, mode: "apply" | "check" | "cancel") {
    if (canWrite !== true || !ready) return;
    await operation(async (ticket) => {
      const permission = await readOperatorInputWriteAccess(db());
      if (ticket !== generation.current) return;
      setCanWrite(permission);
      if (permission !== true) {
        setNotice(
          "Administrator access is no longer confirmed. The saved request has been retained.",
        );
        return;
      }
      const lock: InputLock = async (key, task) => {
        if (!navigator.locks)
          throw Error("Browser request locking is unavailable. The request is retained.");
        return navigator.locks.request(key, task);
      };
      const receipt = await resolveSavedCapture(
        db(),
        localStorage,
        lock,
        scope,
        saved,
        mode,
        () => ticket === generation.current,
      );
      if (ticket !== generation.current) return;
      const message =
        receipt.state === "recorded"
          ? "Capture settings recorded. Review input evidence to confirm workers and connections are current."
          : receipt.state === "cancelled"
            ? "Unresolved request cancelled. A delayed copy cannot apply it."
            : "No result is recorded yet. Keep this request saved; retry it or cancel it explicitly.";
      if (receipt.state !== "pending") {
        setReason("");
        if (receipt.state === "recorded") onRecorded?.();
        try {
          await refresh(ticket);
        } catch {
          if (ticket === generation.current) {
            setData(null);
            setCanWrite(null);
            setNotice(message + " Refresh current settings before making another change.");
          }
          return;
        }
      }
      if (ticket === generation.current) setNotice(message);
    }, true);
  }
  const disabled = busy || !ready || canWrite !== true || !!pending || otherPending || !data;
  const complete = captureFlags.every((k) => typeof draft[k] === "boolean");
  const changed = !!data && captureFlags.some((k) => data.flags[k] !== draft[k]);
  return (
    <section
      className="cp-card op-learn-inputs space-y-4"
      aria-labelledby="capture-controls-heading"
    >
      <header className="flex flex-wrap justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            OpenFolk · client controls
          </p>
          <h2 id="capture-controls-heading" className="text-xl font-semibold">
            LEARN capture settings
          </h2>
          <p className="text-sm">
            Pause or allow new input for this company. Retained emails, calls and messages stay
            available.
          </p>
        </div>
        <button className="cp-secondary" disabled={busy} onClick={() => void operation(refresh)}>
          {busy ? "Checking…" : "Refresh capture settings"}
        </button>
      </header>
      {notice && (
        <p role="status" className="rounded-lg border p-3">
          {notice}
        </p>
      )}
      {data && canWrite !== true && (
        <p role="status">
          {canWrite === false
            ? "Read-only access. An OpenFolk administrator is required to change capture settings."
            : "Administrator access could not be confirmed. Settings are available for review."}
        </p>
      )}
      {!ready && (
        <p className="text-sm">Changes require working browser storage and request locking.</p>
      )}
      {otherPending && (
        <p role="status">
          Resolve the saved Commusoft module, import or connection request before changing capture.
        </p>
      )}
      {pending && (
        <div className="rounded-xl border p-4 space-y-3" aria-label="Saved capture request">
          <h3 className="font-semibold">Resolve the saved capture change</h3>
          <p>{pending.request.definition.reason}</p>
          <ul className="text-sm">
            {captureFlags.map((k) => (
              <li key={k}>
                {labels[k]}: {pending.request.definition.values[k] ? "On" : "Off"}
              </li>
            ))}
          </ul>
          <p className="text-sm">
            Check the result before retrying. Cancel only prevents an unresolved change; it does not
            undo recorded settings.
          </p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["check", "Check saved capture result"],
                ["apply", "Retry saved capture change"],
                ["cancel", "Cancel unresolved capture change"],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                className="cp-secondary"
                disabled={busy || !ready || canWrite !== true || (mode === "apply" && otherPending)}
                onClick={() => void resolve(pending, mode)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3" aria-label="Recorded capture policy">
            {(["email", "phone", "slack"] as const).map((source) => (
              <div key={source} className="rounded-lg border p-3">
                <h3 className="font-semibold capitalize">{source}</h3>
                <p>
                  {data.sources[source].invalid
                    ? "Setting needs review"
                    : data.sources[source].allowed
                      ? "New capture allowed"
                      : "New capture paused"}
                </p>
                {data.sources[source].inherited && <p className="text-xs">Uses existing setup</p>}
              </div>
            ))}
          </div>
          <fieldset className="space-y-3" disabled={disabled}>
            <legend className="font-semibold">Review capture settings</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {captureFlags.map((k) => (
                <label key={k}>
                  {labels[k]}
                  <select
                    className="cp-select w-full"
                    value={draft[k] === null ? "" : String(draft[k])}
                    onChange={(e) => {
                      setDraft((v) => ({ ...v, [k]: e.target.value === "true" }));
                      setReviewed(false);
                    }}
                  >
                    <option value="" disabled>
                      Choose On or Off · existing setup
                    </option>
                    <option value="true">On</option>
                    <option value="false">Off</option>
                  </select>
                </label>
              ))}
            </div>
            <p className="text-sm">
              LEARN is the master switch, including Commusoft. Each source also needs a configured
              connection and worker. Turning a switch on does not prove capture is running. An
              admitted batch may finish after pausing.
            </p>
            {!complete && (
              <p className="text-sm">
                Choose an explicit setting for each input before saving. No inherited setting
                changes until you save.
              </p>
            )}
            <label className="block">
              Reason for capture change
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
              I have reviewed this company and all four capture settings.
            </label>
            <button
              className="cp-primary"
              disabled={!reviewed || !complete || !changed || !reason.trim()}
              onClick={() => {
                if (disabled || !reviewed || !complete || !changed || !reason.trim()) return;
                void resolve(
                  {
                    version: 1,
                    backend,
                    request: {
                      tenantId,
                      actorId,
                      requestId: crypto.randomUUID(),
                      definition: {
                        reason: reason.trim(),
                        revision: data.revision,
                        values: draft as CaptureValues,
                      },
                    },
                  },
                  "apply",
                );
              }}
            >
              Save capture settings
            </button>
          </fieldset>
        </>
      )}
    </section>
  );
}
