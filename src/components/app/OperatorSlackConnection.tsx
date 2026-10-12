import { useEffect, useRef, useState } from "react";
import { getSupabaseClient, supabaseConfig } from "@/lib/supabase";
import { loadSlackConnections, type SlackConnectionOption } from "@/lib/learn-slack-setup";
import {
  resolveSlackSetup,
  validateSlackSetup,
  type SlackSetupRequest,
} from "@/lib/learn-slack-connection";
import { LearnSlackSetup } from "../client-portal/learn/LearnSlackSetup";

/** A credential is a transient input only. Recovery stores the request identity
 * and safe definition; uncertain results never cause an automatic replay. */
export function OperatorSlackConnection({
  tenantId,
  actorId,
  canWrite,
}: {
  tenantId: string;
  actorId: string;
  canWrite: boolean;
}) {
  const backend = supabaseConfig.url.replace(/\/$/, "");
  const key = `serviceos.slack-connection.v1:${backend}:${actorId}:${tenantId}`;
  const [connection, setConnection] = useState<SlackConnectionOption | null>(null);
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<SlackSetupRequest | null>(null);
  const [notice, setNotice] = useState("");
  const [team, setTeam] = useState(""),
    [consentingUser, setConsentingUser] = useState("");
  const [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const [credentialMode, setCredentialMode] = useState<"replace" | "reuse">("replace");
  const [revision, setRevision] = useState(0);
  const secret = useRef<HTMLInputElement>(null),
    generation = useRef(0),
    working = useRef(false);
  const clearSecret = () => {
    if (secret.current) secret.current.value = "";
  };
  function saved() {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    try {
      const request: unknown = JSON.parse(raw);
      validateSlackSetup(request);
      if (request.actorId !== actorId || request.tenantId !== tenantId) throw Error();
      return request;
    } catch {
      throw Error(
        "The saved connection request could not be verified. It has been retained for review.",
      );
    }
  }
  async function refresh(ticket = generation.current) {
    setReady(false);
    try {
      const request = saved();
      const rows = await loadSlackConnections(getSupabaseClient(), tenantId);
      if (ticket !== generation.current) return;
      setPending(request);
      setConnection(rows[0] ?? null);
      setTeam(rows[0]?.teamId ?? "");
      setReady(Boolean(navigator.locks));
      if (!navigator.locks)
        setNotice(
          "This browser cannot lock connection changes. Status is available; use a supported browser to configure Slack.",
        );
    } catch {
      if (ticket === generation.current)
        setNotice(
          "Connection status or saved requests could not be read. Refresh before making changes.",
        );
    }
  }
  useEffect(() => {
    const ticket = ++generation.current;
    working.current = false;
    setBusy(false);
    setPending(null);
    setConnection(null);
    setTeam("");
    setConsentingUser("");
    setReason("");
    setConfirmed(false);
    setNotice("");
    clearSecret();
    void refresh(ticket);
    const changed = (event: StorageEvent) => {
      if (event.key === key || event.key === null) {
        clearSecret();
        setConfirmed(false);
        void refresh(ticket);
      }
    };
    window.addEventListener("storage", changed);
    return () => {
      generation.current++;
      clearSecret();
      window.removeEventListener("storage", changed);
    };
  }, [key]);
  useEffect(() => {
    if (!canWrite) {
      clearSecret();
      setConfirmed(false);
    }
  }, [canWrite]);
  async function execute(mode: "apply" | "check" | "cancel") {
    if (!canWrite || !ready || working.current) return;
    const ticket = generation.current;
    const request: SlackSetupRequest = pending ?? {
      requestId: crypto.randomUUID(),
      tenantId,
      actorId,
      definition: {
        kind: "configure_slack",
        team_id: team.trim(),
        authorized_user_id: consentingUser.trim(),
        expected_revision: connection?.revision ?? null,
        credential_mode: credentialMode,
        reason: reason.trim(),
        same_account_confirmed: true,
      },
    };
    let token =
      mode === "apply" && request.definition.credential_mode === "replace"
        ? secret.current?.value
        : undefined;
    clearSecret();
    working.current = true;
    setBusy(true);
    setNotice("");
    try {
      if (mode === "apply" && !confirmed)
        throw Error("Confirm the company, workspace and consenting user before saving.");
      validateSlackSetup(request);
      await navigator.locks.request(key, { mode: "exclusive", ifAvailable: true }, async (lock) => {
        if (!lock)
          throw Error("Another tab is resolving this connection. Refresh its saved result.");
        if (ticket !== generation.current) return;
        const current = saved();
        if (JSON.stringify(current) !== JSON.stringify(pending))
          throw Error("The saved request changed in another tab. Refresh before continuing.");
        if (!current) {
          localStorage.setItem(key, JSON.stringify(request));
          if (JSON.stringify(saved()) !== JSON.stringify(request))
            throw Error("The recovery request could not be saved.");
          setPending(request);
        }
        const receipt = await resolveSlackSetup(getSupabaseClient(), request, mode, token);
        token = undefined;
        if (ticket !== generation.current) return;
        if (receipt.state === "pending") {
          setNotice(
            "No result has been recorded yet. Check again, retry this saved request, or cancel it before starting a different setup.",
          );
          return;
        }
        if (JSON.stringify(saved()) !== JSON.stringify(request))
          throw Error("The saved request changed; retain it and check the recorded result.");
        localStorage.removeItem(key);
        setPending(null);
        setConfirmed(false);
        setRevision((v) => v + 1);
        await refresh(ticket);
        setNotice(
          receipt.state === "recorded"
            ? "Slack credential stored securely. Provider verification and message capture are still required; no import was started."
            : "Unresolved setup cancelled. A previously completed setup is not undone.",
        );
      });
    } catch (error) {
      if (ticket === generation.current)
        setNotice(
          error instanceof Error
            ? error.message
            : "Setup was not confirmed. Keep the saved request and check its result.",
        );
    } finally {
      token = undefined;
      if (ticket === generation.current) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <div className="space-y-4">
      <p className="text-sm">
        Connect a consenting Slack user's read-only channel access. Individual and group direct
        messages are excluded from capture.
      </p>
      {notice && <p role="status">{notice}</p>}
      <button className="cp-secondary" disabled={busy} onClick={() => void refresh()}>
        Refresh Slack connection
      </button>
      <p className="text-sm">
        {connection
          ? `Configured workspace: ${connection.name}. Configuration alone does not prove capture.`
          : ready
            ? "No Slack input connection is configured for this client."
            : "Checking connection…"}
      </p>
      {pending && (
        <div
          className="rounded-xl border p-3 space-y-2"
          aria-label="Saved Slack connection request"
        >
          <p>
            Saved request for workspace <strong>{pending.definition.team_id}</strong>, consenting
            user <strong>{pending.definition.authorized_user_id}</strong>.
          </p>
          <p>{pending.definition.reason}</p>
          <div className="flex flex-wrap gap-2">
            <button
              className="cp-secondary"
              disabled={!canWrite || !ready || busy}
              onClick={() => void execute("check")}
            >
              Check saved connection result
            </button>
            <button
              className="cp-secondary"
              disabled={!canWrite || !ready || busy}
              onClick={() => void execute("cancel")}
            >
              Cancel unresolved connection
            </button>
          </div>
        </div>
      )}
      <fieldset disabled={!canWrite || !ready || busy} className="space-y-3">
        <legend className="font-semibold">Slack input credential</legend>
        {!pending && (
          <>
            <label className="block">
              Slack workspace ID
              <input
                className="cp-input block w-full"
                value={team}
                onChange={(e) => {
                  setTeam(e.target.value);
                  setConfirmed(false);
                }}
                autoComplete="off"
              />
            </label>
            <label className="block">
              Consenting Slack user ID
              <input
                className="cp-input block w-full"
                value={consentingUser}
                onChange={(e) => {
                  setConsentingUser(e.target.value);
                  setConfirmed(false);
                }}
                autoComplete="off"
              />
            </label>
            <label className="block">
              Credential action
              <select
                className="cp-input block w-full"
                value={credentialMode}
                onChange={(e) => {
                  setCredentialMode(e.target.value as "replace" | "reuse");
                  clearSecret();
                  setConfirmed(false);
                }}
              >
                <option value="replace">Store or replace user credential</option>
                <option value="reuse">Reuse this connection's stored credential</option>
              </select>
            </label>
            <label className="block">
              Reason
              <textarea
                className="cp-input block w-full"
                value={reason}
                maxLength={1000}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          </>
        )}
        {(pending?.definition.credential_mode ?? credentialMode) === "replace" && (
          <label className="block">
            Read-only Slack user token
            <input
              ref={secret}
              className="cp-input block w-full"
              type="password"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        )}
        <p className="text-sm">
          The credential is sent to this environment's encrypted Vault. It is not retained in
          browser recovery storage. Existing history is preserved; workspace and user changes
          require a separate review.
        </p>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          I have verified the selected client, Slack workspace and consenting user, and have
          approval to store this credential here.
        </label>
        <button className="cp-primary" disabled={!confirmed} onClick={() => void execute("apply")}>
          {pending ? "Retry saved connection" : "Save Slack input connection"}
        </button>
      </fieldset>
      <LearnSlackSetup
        key={`${key}:${revision}`}
        tenantId={tenantId}
        actorId={actorId}
        canEdit={canWrite && ready && !busy && !pending}
      />
    </div>
  );
}
