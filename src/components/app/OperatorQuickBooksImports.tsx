import { useEffect, useRef, useState } from "react";
import { OperatorQuickBooksRecurring } from "./OperatorQuickBooksRecurring";
import { getSupabaseClient, supabaseConfig } from "@/lib/supabase";
import type { QuickBooksConnection } from "@/lib/learn-quickbooks";
import {
  quickBooksEntities,
  quickBooksImportState,
  readQuickBooksImports,
  type QuickBooksImportOverview,
  type QuickBooksEntity,
} from "@/lib/learn-quickbooks-import";

export function OperatorQuickBooksImports({
  tenantId,
  actorId,
  canWrite,
  connections,
  onChange,
}: {
  tenantId: string;
  actorId: string;
  canWrite: boolean;
  connections: QuickBooksConnection[];
  onChange: () => Promise<void>;
}) {
  const [data, setData] = useState<QuickBooksImportOverview | null>(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [connectionId, setConnectionId] = useState(""),
    [reason, setReason] = useState(""),
    [entities, setEntities] = useState<QuickBooksEntity[]>([
      "Customer",
      "Invoice",
      "Payment",
      "CreditMemo",
    ]);
  const [budget, setBudget] = useState(100),
    [minor, setMinor] = useState(""),
    [resume, setResume] = useState("");
  const generation = useRef(0),
    working = useRef(false);
  const backend = supabaseConfig.url;
  async function refresh(ticket = generation.current) {
    try {
      const r = await getSupabaseClient().rpc("learn_quickbooks_import_status", {
        p_tenant: tenantId,
      });
      if (r.error) throw Error();
      const next = readQuickBooksImports(r.data, tenantId);
      if (ticket === generation.current) setData(next);
    } catch {
      if (ticket === generation.current) {
        setData(null);
        setNotice("Import status could not be checked. Refresh before making changes.");
      }
    }
  }
  useEffect(() => {
    generation.current++;
    working.current = false;
    setBusy(false);
    setData(null);
    setNotice("");
    setConnectionId("");
    setReason("");
    setResume("");
    setMinor("");
    void refresh();
    return () => {
      generation.current++;
    };
  }, [tenantId, actorId, backend]);
  const selected = connections.find((c) => c.id === connectionId),
    prior = data?.runs.find((r) => r.id === resume && r.connectionId === connectionId);
  const ready = !!selected && selected.status === "paused" && !!selected.confirmedAt;
  const valid =
    entities.length > 0 &&
    Number.isInteger(Number(minor)) &&
    Number(minor) >= 1 &&
    Number(minor) <= 1000 &&
    Number.isInteger(budget) &&
    budget >= 1 &&
    budget <= 10000;
  async function act(kind: "enable" | "disable" | "start") {
    if (!canWrite || working.current || !selected || !data || !reason.trim()) return;
    if (
      kind === "start" &&
      (!ready || data.enabled !== true || data.learnEnabled !== true || (!prior && !valid))
    )
      return;
    working.current = true;
    setBusy(true);
    setNotice("");
    const ticket = generation.current;
    try {
      const r =
        kind === "start"
          ? await getSupabaseClient().rpc("learn_quickbooks_import_start", {
              p_tenant: tenantId,
              p_connection: selected.id,
              p_request: crypto.randomUUID(),
              p_definition: {
                entities: prior?.definition.entities ?? entities,
                pageSize: prior?.definition.pageSize ?? 100,
                minorVersion: prior?.definition.minorVersion ?? Number(minor),
                maxRequests: budget,
                expiresAt: new Date(Date.now() + 24 * 3600000 - 60000).toISOString(),
                reason: reason.trim(),
                resumeFrom: prior?.id ?? null,
              },
            })
          : await getSupabaseClient().rpc("learn_quickbooks_set_enabled", {
              p_tenant: tenantId,
              p_connection: selected.id,
              p_enabled: kind === "enable",
              p_reason: reason.trim(),
            });
      if (r.error) throw Error();
      if (ticket !== generation.current) return;
      setNotice(
        kind === "start"
          ? "Import queued. The configured worker will capture the requested records within this limit."
          : kind === "enable"
            ? "QuickBooks input enabled. Start an import when ready."
            : "QuickBooks input disabled. Saved records are retained.",
      );
      await refresh(ticket);
      await onChange();
    } catch {
      if (ticket === generation.current) {
        setNotice(
          "The change was not confirmed. Refresh to check the saved result before trying again.",
        );
        await refresh(ticket);
        await onChange();
      }
    } finally {
      if (ticket === generation.current) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <section aria-label="QuickBooks imports" className="space-y-4 border-t pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <h4 className="font-semibold">Accounting imports</h4>
        <button className="cp-secondary" disabled={busy} onClick={() => void refresh()}>
          Refresh imports
        </button>
      </div>
      <p className="text-sm text-muted-foreground">
        Saved records add financial context. A completed page scan is not a reconciled set of
        accounts: changes made during capture and deleted transactions need separate reconciliation.
      </p>
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {data && (
        <>
          <p className="text-sm">
            QuickBooks input: {data.enabled === true ? "enabled" : "disabled"} · Checked{" "}
            {new Date(data.checkedAt).toLocaleString("en-GB")}
          </p>
          {data.counts.length > 0 ? (
            <ul className="grid gap-2 sm:grid-cols-2">
              {data.counts.map((c) => (
                <li
                  key={`${c.environment}:${c.realmId}:${c.entity}`}
                  className="rounded-lg border p-3 text-sm"
                >
                  <strong>
                    {c.records.toLocaleString("en-GB")} {c.entity} records
                  </strong>
                  <p>
                    {c.environment === "production" ? "LIVE" : "Sandbox"} · Company {c.realmId}
                  </p>
                  {c.conflictedRecords > 0 && (
                    <p>{c.conflictedRecords} records need version review.</p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm">No accounting records have been captured for this client.</p>
          )}
          {canWrite && (
            <div className="space-y-3 rounded-xl border p-4">
              <label className="grid gap-1 text-sm">
                Company
                <select
                  className="rounded-lg border bg-background p-2"
                  disabled={busy}
                  value={connectionId}
                  onChange={(e) => {
                    setConnectionId(e.target.value);
                    setResume("");
                  }}
                >
                  <option value="">Choose connected company</option>
                  {connections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.companyName ?? "Unconfirmed company"} ·{" "}
                      {c.environment === "production" ? "LIVE" : "Sandbox"} ·{" "}
                      {c.realmId ?? "awaiting connection"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                Reason
                <input
                  className="rounded-lg border bg-background p-2"
                  maxLength={1000}
                  value={reason}
                  disabled={busy}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  className="cp-secondary"
                  disabled={busy || !selected || !reason.trim() || data.enabled === true}
                  onClick={() => void act("enable")}
                >
                  Enable QuickBooks input
                </button>
                <button
                  className="cp-secondary"
                  disabled={busy || !selected || !reason.trim() || data.enabled !== true}
                  onClick={() => void act("disable")}
                >
                  Disable QuickBooks input
                </button>
              </div>
              <label className="grid gap-1 text-sm">
                Capture scope
                <select
                  className="rounded-lg border bg-background p-2"
                  disabled={busy}
                  value={resume}
                  onChange={(e) => setResume(e.target.value)}
                >
                  <option value="">New scan of selected records</option>
                  {data.runs
                    .filter(
                      (r) =>
                        r.connectionId === connectionId &&
                        ["paused", "failed", "limit_reached"].includes(r.state),
                    )
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        Continue {new Date(r.updatedAt).toLocaleString("en-GB")} ·{" "}
                        {r.entity ?? "end of scan"}
                      </option>
                    ))}
                </select>
              </label>
              {!prior && (
                <>
                  <fieldset disabled={busy} className="grid gap-2 sm:grid-cols-3">
                    <legend className="mb-2 text-sm">Record types</legend>
                    {quickBooksEntities.map((e) => (
                      <label key={e} className="flex gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={entities.includes(e)}
                          onChange={(event) =>
                            setEntities((prev) =>
                              event.target.checked ? [...prev, e] : prev.filter((x) => x !== e),
                            )
                          }
                        />
                        {e}
                      </label>
                    ))}
                  </fieldset>
                  <label className="grid gap-1 text-sm">
                    Verified Intuit minor version
                    <input
                      className="rounded-lg border bg-background p-2"
                      type="number"
                      min={1}
                      max={1000}
                      value={minor}
                      disabled={busy}
                      onChange={(e) => setMinor(e.target.value)}
                    />
                  </label>
                </>
              )}
              {prior && (
                <p className="text-sm">
                  Continuing {prior.definition.entities.join(", ")} at the saved position. Previous
                  records remain saved.
                </p>
              )}
              <label className="grid gap-1 text-sm">
                Maximum provider requests
                <input
                  className="rounded-lg border bg-background p-2"
                  type="number"
                  min={1}
                  max={10000}
                  value={budget}
                  disabled={busy}
                  onChange={(e) => setBudget(Number(e.target.value))}
                />
              </label>
              <p className="text-xs text-muted-foreground">
                Up to {prior?.definition.pageSize ?? 100} records per request. This run expires
                within 24 hours and pauses when the scan or request limit is reached. Failed
                requests count towards the limit. Pause the connection above to stop it.
              </p>
              <button
                className="cp-primary"
                disabled={
                  busy ||
                  !ready ||
                  data.enabled !== true ||
                  data.learnEnabled !== true ||
                  !reason.trim() ||
                  (!prior && !valid) ||
                  budget < 1 ||
                  budget > 10000
                }
                onClick={() => void act("start")}
              >
                {prior ? "Continue bounded import" : "Start bounded import"}
              </button>
              {!ready && (
                <p className="text-sm">
                  Select a confirmed, paused company before starting capture.
                </p>
              )}
              {data.learnEnabled !== true && (
                <p className="text-sm">The client’s LEARN module must be enabled before capture.</p>
              )}
            </div>
          )}
          <OperatorQuickBooksRecurring tenantId={tenantId} actorId={actorId} canWrite={canWrite} connections={connections} />
          <ul className="space-y-3">
            {data.runs.map((r) => (
              <li key={r.id} className="rounded-lg border p-3 text-sm">
                <strong>{quickBooksImportState[r.state]}</strong>
                <p>
                  {r.definition.entities.join(", ")} · {r.recordsObserved.toLocaleString("en-GB")}{" "}
                  observations · {r.pagesSaved} saved pages · {r.requestsUsed}/{r.maxRequests}{" "}
                  requests
                </p>
                <p>Updated {new Date(r.updatedAt).toLocaleString("en-GB")}</p>
                {r.lastError && (
                  <details>
                    <summary>Operator diagnostics</summary>
                    <code>{r.lastError}</code>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
