import { useEffect, useRef, useState } from "react";
import { OperatorQuickBooksImports } from "./OperatorQuickBooksImports";
import { getSupabaseClient, supabaseConfig } from "@/lib/supabase";
import {
  readQuickBooksOverview,
  verifiedQuickBooksAuthorizationUrl,
  quickBooksStatusLabel,
  readQuickBooksDisconnections,
  quickBooksDisconnectLabel,
  type QuickBooksDisconnect,
  type QuickBooksOverview,
  type QuickBooksConnection,
} from "@/lib/learn-quickbooks";

export function OperatorQuickBooksConnection({
  tenantId,
  actorId,
  canWrite,
}: {
  tenantId: string;
  actorId: string;
  canWrite: boolean;
}) {
  const [data, setData] = useState<QuickBooksOverview | null>(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [appId, setAppId] = useState("");
  const [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState<string | null>(null);
  const [disconnections, setDisconnections] = useState<QuickBooksDisconnect[]>([]),
    [disconnectConfirmed, setDisconnectConfirmed] = useState<string | null>(null),
    [reviewConfirmed, setReviewConfirmed] = useState<string | null>(null);
  const generation = useRef(0),
    working = useRef(false);
  const backend = supabaseConfig.url.replace(/\/$/, "");
  const storageKey = `serviceos.quickbooks-start.v1:${backend}:${actorId}:${tenantId}`;
  async function refresh(ticket = generation.current) {
    try {
      const result = await getSupabaseClient().rpc("learn_quickbooks_status", {
        p_tenant: tenantId,
      });
      if (result.error) throw Error();
      const overview = readQuickBooksOverview(result.data, tenantId);
      const disconnects = await getSupabaseClient().rpc("learn_quickbooks_disconnect_status", {
        p_tenant: tenantId,
      });
      if (disconnects.error) throw Error();
      const savedDisconnects = readQuickBooksDisconnections(disconnects.data, tenantId);
      if (ticket !== generation.current) return;
      setData(overview);
      setDisconnections(savedDisconnects);
      setAppId((previous) =>
        overview.apps.some((a) => a.id === previous)
          ? previous
          : overview.apps.length === 1
            ? overview.apps[0].id
            : "",
      );
    } catch {
      if (ticket === generation.current) {
        setData(null);
        setNotice("QuickBooks status is unavailable. Refresh to check setup and access.");
      }
    }
  }
  useEffect(() => {
    generation.current++;
    working.current = false;
    setData(null);
    setNotice("");
    setConfirmed(null);
    setDisconnectConfirmed(null);
    setReviewConfirmed(null);
    setDisconnections([]);
    setReason("");
    setAppId("");
    setBusy(false);
    void refresh();
    return () => {
      generation.current++;
    };
  }, [tenantId, actorId, backend]);
  async function connect(existing?: QuickBooksConnection) {
    if (!canWrite || working.current || !data || !reason.trim() || !appId) return;
    working.current = true;
    setBusy(true);
    setNotice("");
    const ticket = generation.current;
    try {
      // Keep only a non-secret connection ID for resolving a lost response. A
      // fresh authorisation fences old state; never automatically repeat a POST.
      let connectionId = existing?.id;
      if (!connectionId) {
        const saved = localStorage.getItem(storageKey);
        connectionId =
          saved && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(saved)
            ? saved
            : crypto.randomUUID();
      }
      localStorage.setItem(storageKey, connectionId);
      const result = await getSupabaseClient().functions.invoke("quickbooks-oauth-start", {
        body: {
          tenantId,
          connectionId,
          appId,
          requestId: crypto.randomUUID(),
          reason: reason.trim(),
        },
      });
      if (result.error) throw Error();
      const url = verifiedQuickBooksAuthorizationUrl(result.data, connectionId, backend);
      if (ticket !== generation.current) return;
      window.location.assign(url);
    } catch {
      if (ticket === generation.current) {
        setNotice(
          "Authorisation was not confirmed. Refresh status before trying again; any saved connection is retained.",
        );
        await refresh(ticket);
      }
    } finally {
      if (ticket === generation.current) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  async function disconnect(c: QuickBooksConnection, review?: QuickBooksDisconnect) {
    const prior = disconnections.find((d) => d.connectionId === c.id && d.state === "queued");
    if (
      !canWrite ||
      working.current ||
      (!prior && !reason.trim()) ||
      (review
        ? reviewConfirmed !== review.id || reason.trim().length < 20
        : disconnectConfirmed !== c.id)
    )
      return;
    working.current = true;
    setBusy(true);
    setNotice("");
    const ticket = generation.current;
    try {
      if (review) {
        const saved = await getSupabaseClient().rpc("learn_quickbooks_disconnect_review", {
          p_tenant: tenantId,
          p_request: review.id,
          p_reason: reason.trim(),
        });
        if (saved.error || saved.data?.state !== "reviewed") throw Error();
      } else {
        // An explicit resume uses the saved request. The single-use server lease
        // prevents another provider call if an earlier attempt already acquired it.
        const saved = await getSupabaseClient().functions.invoke("quickbooks-disconnect", {
          body: {
            tenantId,
            connectionId: c.id,
            requestId: prior?.id ?? crypto.randomUUID(),
            revision: prior?.requestRevision ?? c.revision,
            reason: prior?.reason ?? reason.trim(),
          },
        });
        if (
          saved.error ||
          saved.data?.connectionId !== c.id ||
          saved.data?.localCaptureStopped !== true
        )
          throw Error();
      }
      if (ticket !== generation.current) return;
      setNotice(
        review
          ? "Provider disconnection review recorded. Check status before reconnecting."
          : "Disconnect requested. The saved status below distinguishes stopped capture from revoked access.",
      );
      setDisconnectConfirmed(null);
      setReviewConfirmed(null);
      await refresh(ticket);
    } catch {
      if (ticket === generation.current) {
        setNotice(
          "The result needs checking. Refresh status before another action; do not assume Intuit access was revoked.",
        );
        await refresh(ticket);
      }
    } finally {
      if (ticket === generation.current) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  async function control(c: QuickBooksConnection, action: "confirm" | "pause") {
    if (
      !canWrite ||
      working.current ||
      !reason.trim() ||
      (action === "confirm" && confirmed !== c.id)
    )
      return;
    working.current = true;
    setBusy(true);
    const ticket = generation.current;
    setNotice("");
    try {
      const result = await getSupabaseClient().rpc("learn_quickbooks_control", {
        p_tenant: tenantId,
        p_connection: c.id,
        p_revision: c.revision,
        p_action: action,
        p_realm: c.realmId,
        p_reason: reason.trim(),
      });
      if (result.error || result.data?.id !== c.id || result.data?.status !== "paused")
        throw Error();
      if (ticket !== generation.current) return;
      setConfirmed(null);
      setNotice(
        action === "confirm"
          ? "Company confirmed. Capture remains paused until an import is started."
          : "Capture paused.",
      );
      await refresh(ticket);
    } catch {
      if (ticket === generation.current) {
        setNotice(
          "The change was not confirmed. Refresh to check the saved result before another action.",
        );
        await refresh(ticket);
      }
    } finally {
      if (ticket === generation.current) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <section className="space-y-4" aria-label="QuickBooks connection">
      <p className="text-sm text-muted-foreground">
        Connect this client’s QuickBooks company to add accounting context to LEARN. ServiceOS reads
        accounting records; Intuit’s Accounting permission itself includes read and write access.
      </p>
      <button className="cp-secondary" disabled={busy} onClick={() => void refresh()}>
        Refresh QuickBooks status
      </button>
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {data && (
        <>
          <p className="text-xs text-muted-foreground">
            Checked {new Date(data.checkedAt).toLocaleString("en-GB")}. A connection does not
            establish complete financial coverage.
          </p>
          {canWrite && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                App registration
                <select
                  className="rounded-lg border bg-background p-2"
                  value={appId}
                  disabled={busy}
                  onChange={(e) => setAppId(e.target.value)}
                >
                  <option value="">Choose registration</option>
                  {data.apps.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.environment === "production" ? "LIVE" : "Sandbox"} · {a.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                Reason for this change
                <input
                  className="rounded-lg border bg-background p-2"
                  value={reason}
                  maxLength={1000}
                  disabled={busy}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
            </div>
          )}
          {data.apps.length === 0 && (
            <p className="text-sm">
              The QuickBooks app registration still needs server-side setup.
            </p>
          )}
          {data.connections.length === 0 && (
            <p className="text-sm">No QuickBooks company has been connected for this client.</p>
          )}
          {data.connections.map((c) => {
            const d = disconnections.find((item) => item.connectionId === c.id);
            const unresolved = d && !["revoked", "reviewed"].includes(d.state);
            return (
              <article key={c.id} className="space-y-3 rounded-xl border p-4">
                <div>
                  <h4 className="font-semibold">{c.companyName ?? "QuickBooks company"}</h4>
                  <p className="text-sm">
                    {quickBooksStatusLabel[c.status]} ·{" "}
                    {c.environment === "production" ? "LIVE" : "Sandbox"}
                  </p>
                  {c.realmId && (
                    <p className="break-all text-xs text-muted-foreground">
                      Company reference {c.realmId}
                    </p>
                  )}
                </div>
                {d && (c.status === "disconnected" || unresolved) && (
                  <div className="space-y-2 text-sm" role="status">
                    <p>{quickBooksDisconnectLabel[d.state]}</p>
                    {d.code === "shared_provider_grant" && (
                      <p>
                        Another ServiceOS connection uses this Intuit grant. Coordinate those
                        connections before removing the app in QuickBooks.
                      </p>
                    )}
                    {d.state === "queued" && canWrite && d.actorId === actorId && (
                      <>
                        <label className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            disabled={busy}
                            checked={disconnectConfirmed === c.id}
                            onChange={(e) => setDisconnectConfirmed(e.target.checked ? c.id : null)}
                          />
                          Complete the saved disconnect request.
                        </label>
                        <p>Uses the saved request reason: {d.reason}</p>
                        <button
                          className="cp-secondary"
                          disabled={busy || disconnectConfirmed !== c.id}
                          onClick={() => void disconnect(c)}
                        >
                          Complete pending disconnection
                        </button>
                      </>
                    )}
                    {["manual_review", "queued"].includes(d.state) && canWrite && (
                      <>
                        <p>
                          Check the company’s connected apps in QuickBooks and remove this ServiceOS
                          app if still connected. Record what you checked in the reason above (at
                          least 20 characters).
                        </p>
                        <label className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            disabled={busy}
                            checked={reviewConfirmed === d.id}
                            onChange={(e) => setReviewConfirmed(e.target.checked ? d.id : null)}
                          />
                          I have verified provider disconnection and checked any shared connections.
                          This is an operator review, not an API confirmation.
                        </label>
                        <button
                          className="cp-secondary"
                          disabled={busy || reviewConfirmed !== d.id || reason.trim().length < 20}
                          onClick={() => void disconnect(c, d)}
                        >
                          Record provider review
                        </button>
                      </>
                    )}
                  </div>
                )}
                {c.status === "awaiting_confirmation" && canWrite && (
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={confirmed === c.id}
                      onChange={(e) => setConfirmed(e.target.checked ? c.id : null)}
                    />
                    I have checked that this is the correct QuickBooks company for the selected
                    client.
                  </label>
                )}
                {canWrite && (
                  <div className="flex flex-wrap gap-2">
                    {c.status === "awaiting_confirmation" && (
                      <button
                        className="cp-primary"
                        disabled={busy || confirmed !== c.id || !reason.trim()}
                        onClick={() => void control(c, "confirm")}
                      >
                        Confirm company
                      </button>
                    )}
                    <button
                      className="cp-secondary"
                      disabled={
                        busy ||
                        !!unresolved ||
                        !appId ||
                        !reason.trim() ||
                        data.apps.find((a) => a.id === appId)?.environment !== c.environment
                      }
                      onClick={() => void connect(c)}
                    >
                      Reconnect through Intuit
                    </button>
                    <button
                      className="cp-secondary"
                      disabled={
                        busy ||
                        !!unresolved ||
                        !reason.trim() ||
                        c.status === "paused" ||
                        c.status === "disconnected"
                      }
                      onClick={() => void control(c, "pause")}
                    >
                      Pause connection
                    </button>
                  </div>
                )}
                {canWrite && !unresolved && c.status !== "disconnected" && (
                  <details className="space-y-2 text-sm">
                    <summary className="cursor-pointer">Disconnect QuickBooks</summary>
                    <p>
                      Stop new imports and request revocation of this app’s QuickBooks access. Saved
                      accounting records remain in LEARN.
                    </p>
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        disabled={busy}
                        checked={disconnectConfirmed === c.id}
                        onChange={(e) => setDisconnectConfirmed(e.target.checked ? c.id : null)}
                      />
                      Disconnect this client’s selected QuickBooks company.
                    </label>
                    <button
                      className="cp-secondary"
                      disabled={busy || disconnectConfirmed !== c.id || !reason.trim()}
                      onClick={() => void disconnect(c)}
                    >
                      Stop capture and revoke access
                    </button>
                  </details>
                )}
              </article>
            );
          })}
          {canWrite && data.connections.length === 0 && (
            <button
              className="cp-primary"
              disabled={busy || !appId || !reason.trim()}
              onClick={() => void connect()}
            >
              Connect QuickBooks
            </button>
          )}
          <OperatorQuickBooksImports
            tenantId={tenantId}
            actorId={actorId}
            canWrite={canWrite}
            connections={data.connections}
            onChange={() => refresh()}
          />
        </>
      )}
    </section>
  );
}
