/**
 * Marketing Provider Connections (Phase 9/10 — platform seams).
 *
 * HONEST UI CONTRACT: exactly one reviewed adapter exists (Meta — fixture
 * tested, NOT live verified; labelled exactly that), and no tenant is
 * connected to any provider. Providers without an adapter surface the
 * recorded error/'no_adapter' outcome; connected is reachable only through
 * worker-verified adapter evidence; sync is refused for every non-connected
 * account; freshness renders the computed never_run / error / stale / fresh
 * states with their reasons; and NOTHING here shows spend, CPL or a
 * fabricated connected badge. Per-section load failures render as retryable
 * errors — never as a fabricated empty state.
 *
 * Hidden controls are NOT the security boundary — the server enforces every
 * permission again (owner/admin + marketing.ads.manage inside every RPC).
 */

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Cable, Loader2, Plug, RefreshCw, ShieldOff } from "lucide-react";
import {
  type ConnectionAccountRow,
  type ConnectionDescriptor,
  type ConnectionProvider,
  type ConnectionReport,
  type ConnectionRunSummary,
  connectConnection,
  createConnection,
  getConnectionCatalogue,
  getConnectionReport,
  listConnectionRuns,
  listConnections,
  newConnectionRequestId,
  requestConnectionSync,
  revokeConnection,
  selectExternalAccount,
  setConnectionCredential,
} from "@/lib/marketing/connections";

const STATUS_LABEL: Record<string, string> = {
  preview: "Preview",
  connecting: "Connecting",
  connected: "Connected",
  error: "Error",
  revoked: "Revoked",
};

const FRESHNESS_LABEL: Record<string, string> = {
  never_run: "Never synced",
  error: "Sync error",
  stale: "Stale",
  fresh: "Fresh",
};

function StatusBadge({ status, reason }: { status: string; reason: string | null }) {
  const tone =
    status === "connected"
      ? "text-success"
      : status === "error"
        ? "text-destructive"
        : "text-muted-foreground";
  return (
    <span className={`text-xs font-medium ${tone}`}>
      {STATUS_LABEL[status] ?? status}
      {reason ? <span className="font-normal"> · {reason}</span> : null}
    </span>
  );
}

function FreshnessBadge({ account }: { account: ConnectionAccountRow }) {
  const f = account.freshness;
  if (!f) return null;
  const tone =
    f.state === "fresh"
      ? "text-success"
      : f.state === "error"
        ? "text-destructive"
        : "text-muted-foreground";
  return (
    <span className={`text-xs ${tone}`}>
      {FRESHNESS_LABEL[f.state] ?? f.state}
      {f.reason ? ` — ${f.reason}` : ""}
    </span>
  );
}

export function MarketingConnections({ canManage }: { canManage: boolean }) {
  const [loading, setLoading] = useState(true);
  // per-section load failures — a swallowed read must NEVER render as a
  // truthful "no connections"; it is shown as an honest, retryable error.
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [providers, setProviders] = useState<ConnectionDescriptor[]>([]);
  const [accounts, setAccounts] = useState<ConnectionAccountRow[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newProvider, setNewProvider] = useState<ConnectionProvider>("meta");
  const [newName, setNewName] = useState("");
  const [credentialFor, setCredentialFor] = useState<ConnectionAccountRow | null>(null);
  const [credentialValue, setCredentialValue] = useState("");
  const [selectRef, setSelectRef] = useState("");
  const [reportFor, setReportFor] = useState<string | null>(null);
  const [report, setReport] = useState<ConnectionReport | null>(null);
  const [reportRuns, setReportRuns] = useState<ConnectionRunSummary[]>([]);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  const openReport = async (accountId: string) => {
    setReportFor(accountId);
    setReport(null);
    setReportRuns([]);
    setReportError(null);
    setReportLoading(true);
    const [rep, rr] = await Promise.all([
      getConnectionReport(accountId),
      listConnectionRuns(accountId),
    ]);
    setReportLoading(false);
    if (!rep.ok) {
      // NEVER render a fabricated empty report from a failed fetch
      setReportError(rep.error.message);
      return;
    }
    setReport(rep.data);
    setReportRuns(rr.ok ? (rr.data.runs ?? []) : []);
    if (!rr.ok) setReportError(`Run history unavailable: ${rr.error.message}`);
  };

  const reload = useCallback(async () => {
    setLoading(true);
    const [cat, list] = await Promise.all([getConnectionCatalogue(), listConnections()]);
    setLoading(false);
    if (cat.ok) {
      setProviders(cat.data.providers ?? []);
      setCatalogError(null);
    } else {
      setProviders([]);
      setCatalogError(cat.error.message);
    }
    if (list.ok) {
      setAccounts(list.data.accounts ?? []);
      setAccountsError(null);
    } else {
      // do NOT fabricate an empty list from a failed fetch
      setAccounts([]);
      setAccountsError(list.error.message);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = async (
    key: string,
    fn: () => Promise<{ ok: boolean; error?: { message: string } }>,
  ) => {
    setBusy(key);
    setNotice(null);
    const res = await fn();
    setBusy(null);
    if (!res.ok && res.error) {
      setNotice(res.error.message);
    }
    await reload();
  };

  if (loading && accounts.length === 0 && !accountsError) {
    return (
      <div role="status" className="rounded-2xl border border-hairline bg-white p-6">
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading provider
          connections…
        </span>
      </div>
    );
  }

  return (
    <section aria-label="Provider connections" className="space-y-4">
      <div className="rounded-2xl border border-hairline bg-white p-6">
        <div className="flex items-center justify-between border-b border-hairline pb-4">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Cable className="h-4 w-4" aria-hidden="true" /> Provider connections
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              The connection seam for ad and data providers. One reviewed adapter exists (Meta —
              fixture tested, not live verified); no tenant is connected to any provider, nothing
              polls, and no metric is fabricated. Credentials go straight to the tenant Vault and
              are never shown again.
            </p>
          </div>
          {canManage && (
            <button
              type="button"
              onClick={() => setCreateOpen((v) => !v)}
              className="rounded-lg border border-hairline px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-alt"
            >
              {createOpen ? "Close" : "New connection"}
            </button>
          )}
        </div>

        <div aria-live="polite" role="status">
          {notice && (
            <div className="mt-3 rounded-lg border border-hairline bg-surface-alt px-3 py-2 text-xs text-foreground">
              {notice}
            </div>
          )}
        </div>

        {canManage && createOpen && (
          <form
            className="mt-4 flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newName.trim()) {
                setNotice("Give the connection a name first.");
                return;
              }
              void run("create", () =>
                createConnection(newProvider, newName.trim(), newConnectionRequestId()),
              ).then(() => {
                setNewName("");
                setCreateOpen(false);
              });
            }}
          >
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Provider
              <select
                value={newProvider}
                onChange={(e) => setNewProvider(e.target.value as ConnectionProvider)}
                className="rounded-lg border border-hairline bg-white px-2 py-1.5 text-sm text-foreground"
              >
                {providers.map((p) => (
                  <option key={p.provider} value={p.provider}>
                    {p.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Name
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={120}
                className="rounded-lg border border-hairline bg-white px-2 py-1.5 text-sm text-foreground"
                placeholder="e.g. Main ad account"
              />
            </label>
            <button
              type="submit"
              disabled={busy === "create"}
              className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {busy === "create" ? "Creating…" : "Create"}
            </button>
          </form>
        )}

        {accountsError ? (
          <div role="alert" className="mt-4 rounded-lg border border-hairline bg-surface-alt p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Couldn&apos;t load
              connections: {accountsError}
            </div>
            <button
              type="button"
              onClick={() => void reload()}
              className="mt-2 rounded-lg border border-hairline px-2.5 py-1 text-xs text-foreground hover:bg-white"
            >
              <RefreshCw className="mr-1 inline h-3 w-3" aria-hidden="true" /> Retry
            </button>
          </div>
        ) : accounts.length === 0 ? (
          <p className="mt-4 text-xs text-muted-foreground">
            No connections yet.{" "}
            {canManage
              ? "Create one to prepare a provider for a future reviewed adapter."
              : "An owner or admin can create one."}
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {accounts.map((a) => (
              <li key={a.id} className="rounded-xl border border-hairline p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium text-foreground">{a.display_name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-3">
                      <span className="text-xs text-muted-foreground">{a.provider}</span>
                      <StatusBadge status={a.status} reason={a.status_reason} />
                      <FreshnessBadge account={a} />
                      {a.last_synced_at && (
                        <span className="text-xs text-muted-foreground">
                          last synced {new Date(a.last_synced_at).toLocaleString()}
                        </span>
                      )}
                      {a.latest_run?.status === "failed" && (
                        <span className="text-xs text-destructive">
                          last run failed · {a.latest_run.error_class ?? "unknown"}
                        </span>
                      )}
                      {a.external_account_name && (
                        <span className="text-xs text-muted-foreground">
                          external account: {a.external_account_name}
                        </span>
                      )}
                    </div>
                  </div>
                  {canManage && a.status !== "revoked" && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy !== null || !["preview", "error"].includes(a.status)}
                        onClick={() =>
                          void run(`connect-${a.id}`, async () => {
                            const r = await connectConnection(
                              a.id,
                              a.version,
                              newConnectionRequestId(),
                            );
                            if (r.ok && r.data.status === "error") {
                              setNotice(
                                "Connect attempt recorded honestly: no provider adapter exists in this build, so the connection stays in error/no_adapter until a reviewed adapter ships.",
                              );
                            } else if (r.ok && r.data.status === "connecting") {
                              setNotice(
                                "Connection validation queued — the adapter verifies the credential server-side; refresh to see the genuine outcome.",
                              );
                            }
                            return r;
                          })
                        }
                        className="rounded-lg border border-hairline px-2.5 py-1 text-xs text-foreground hover:bg-surface-alt disabled:opacity-40"
                      >
                        <Plug className="mr-1 inline h-3 w-3" aria-hidden="true" />
                        {busy === `connect-${a.id}` ? "Attempting…" : "Attempt connect"}
                      </button>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => {
                          setCredentialFor(a);
                          setCredentialValue("");
                        }}
                        className="rounded-lg border border-hairline px-2.5 py-1 text-xs text-foreground hover:bg-surface-alt disabled:opacity-40"
                      >
                        {a.credential_state === "configured"
                          ? "Rotate credential"
                          : "Add credential"}
                      </button>
                      <button
                        type="button"
                        disabled={busy !== null || a.status !== "connected"}
                        title={
                          a.status !== "connected"
                            ? "Sync requires a genuinely connected account"
                            : undefined
                        }
                        onClick={() =>
                          void run(`sync-${a.id}`, () =>
                            requestConnectionSync(a.id, newConnectionRequestId()),
                          )
                        }
                        className="rounded-lg border border-hairline px-2.5 py-1 text-xs text-foreground hover:bg-surface-alt disabled:opacity-40"
                      >
                        <RefreshCw className="mr-1 inline h-3 w-3" aria-hidden="true" /> Sync now
                      </button>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Revoke "${a.display_name}"? This is permanent — a revoked connection cannot be reconnected.`,
                            )
                          ) {
                            void run(`revoke-${a.id}`, () =>
                              revokeConnection(a.id, a.version, newConnectionRequestId()),
                            );
                          }
                        }}
                        className="rounded-lg border border-hairline px-2.5 py-1 text-xs text-destructive hover:bg-surface-alt disabled:opacity-40"
                      >
                        <ShieldOff className="mr-1 inline h-3 w-3" aria-hidden="true" /> Revoke
                      </button>
                    </div>
                  )}
                </div>

                {canManage && credentialFor?.id === a.id && (
                  <form
                    className="mt-3 flex flex-wrap items-end gap-2 border-t border-hairline pt-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (credentialValue.length < 8) {
                        setNotice("Credential must be at least 8 characters.");
                        return;
                      }
                      void run(`cred-${a.id}`, async () => {
                        const r = await setConnectionCredential(
                          a.id,
                          a.version,
                          credentialValue,
                          newConnectionRequestId(),
                        );
                        if (r.ok)
                          setNotice(r.data.note ?? "Credential stored in the tenant Vault.");
                        return r;
                      }).then(() => {
                        setCredentialFor(null);
                        setCredentialValue("");
                      });
                    }}
                  >
                    <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs text-muted-foreground">
                      Provider credential (stored once in the tenant Vault; never shown again;
                      unusable until a reviewed adapter exists)
                      <input
                        type="password"
                        value={credentialValue}
                        onChange={(e) => setCredentialValue(e.target.value)}
                        autoComplete="off"
                        className="rounded-lg border border-hairline bg-white px-2 py-1.5 text-sm text-foreground"
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={busy === `cred-${a.id}`}
                      className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                    >
                      {busy === `cred-${a.id}` ? "Storing…" : "Store in Vault"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCredentialFor(null)}
                      className="rounded-lg border border-hairline px-3 py-1.5 text-xs text-foreground"
                    >
                      Cancel
                    </button>
                  </form>
                )}

                {canManage &&
                  a.status === "connected" &&
                  !a.external_account_ref &&
                  (a.discovered_accounts?.length ?? 0) > 0 && (
                    <form
                      className="mt-3 flex flex-wrap items-end gap-2 border-t border-hairline pt-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!selectRef) {
                          setNotice("Choose an external account first.");
                          return;
                        }
                        void run(`select-${a.id}`, () =>
                          selectExternalAccount(
                            a.id,
                            a.version,
                            selectRef,
                            newConnectionRequestId(),
                          ),
                        ).then(() => setSelectRef(""));
                      }}
                    >
                      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                        External account (discovered by the adapter)
                        <select
                          value={selectRef}
                          onChange={(e) => setSelectRef(e.target.value)}
                          className="rounded-lg border border-hairline bg-white px-2 py-1.5 text-sm text-foreground"
                        >
                          <option value="">Choose…</option>
                          {a.discovered_accounts.map((d) => (
                            <option key={d.ref} value={d.ref}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="submit"
                        disabled={busy === `select-${a.id}`}
                        className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                      >
                        {busy === `select-${a.id}` ? "Selecting…" : "Select account"}
                      </button>
                    </form>
                  )}

                <div className="mt-3 border-t border-hairline pt-3">
                  <button
                    type="button"
                    onClick={() => {
                      if (reportFor === a.id) {
                        setReportFor(null);
                      } else {
                        void openReport(a.id);
                      }
                    }}
                    aria-expanded={reportFor === a.id}
                    className="rounded-lg border border-hairline px-2.5 py-1 text-xs text-foreground hover:bg-surface-alt"
                  >
                    {reportFor === a.id ? "Hide details" : "Details & report"}
                  </button>

                  {reportFor === a.id && (
                    <div className="mt-3 space-y-3">
                      {reportLoading && (
                        <div role="status" className="text-xs text-muted-foreground">
                          <Loader2
                            className="mr-1 inline h-3 w-3 animate-spin"
                            aria-hidden="true"
                          />
                          Loading report…
                        </div>
                      )}
                      {reportError && (
                        <div
                          role="alert"
                          className="rounded-lg border border-hairline bg-surface-alt px-3 py-2 text-xs text-destructive"
                        >
                          <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden="true" />
                          {reportError}
                          <button
                            type="button"
                            onClick={() => void openReport(a.id)}
                            className="ml-2 rounded border border-hairline px-2 py-0.5 text-xs text-foreground hover:bg-white"
                          >
                            Retry
                          </button>
                        </div>
                      )}
                      {report && (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-lg border border-hairline p-3">
                            <div className="text-xs font-semibold text-foreground">
                              Health: {report.health}
                            </div>
                            <dl className="mt-2 space-y-1 text-xs text-muted-foreground">
                              <div>
                                <dt className="inline font-medium">Spend: </dt>
                                <dd className="inline">
                                  {report.totals.spend !== null
                                    ? `${report.totals.spend} ${report.totals.currencies[0] ?? ""}`
                                    : `Unavailable — ${report.totals.spend_unavailable_reason ?? "no facts"}`}
                                </dd>
                              </div>
                              <div>
                                <dt className="inline font-medium">Leads: </dt>
                                <dd className="inline">
                                  {report.totals.leads !== null
                                    ? report.totals.leads
                                    : `Unavailable — ${report.totals.leads_unavailable_reason ?? "no facts"}`}
                                </dd>
                              </div>
                              <div>
                                <dt className="inline font-medium">Cost per lead: </dt>
                                <dd className="inline">
                                  {report.cpl.value !== null
                                    ? report.cpl.value
                                    : `Unavailable — ${report.cpl.unavailable_reason ?? "not derivable"}`}
                                </dd>
                              </div>
                              {report.metrics_status.state === "unavailable" && (
                                <div role="alert" className="text-destructive">
                                  Metrics unavailable — {report.metrics_status.reason}
                                </div>
                              )}
                            </dl>
                          </div>
                          <div className="rounded-lg border border-hairline p-3">
                            <div className="text-xs font-semibold text-foreground">
                              Campaign feed ({report.campaigns.length})
                            </div>
                            {report.campaigns.length === 0 ? (
                              <p className="mt-1 text-xs text-muted-foreground">
                                No campaign facts have been synced.
                              </p>
                            ) : (
                              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                                {report.campaigns.slice(0, 8).map((c) => (
                                  <li key={c.external_ref}>{c.name ?? c.external_ref}</li>
                                ))}
                              </ul>
                            )}
                            <div className="mt-2 text-xs font-semibold text-foreground">
                              Recent sync runs
                            </div>
                            {reportRuns.length === 0 ? (
                              <p className="mt-1 text-xs text-muted-foreground">No runs yet.</p>
                            ) : (
                              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                                {reportRuns.slice(0, 6).map((rr) => (
                                  <li key={rr.id}>
                                    {rr.kind} · {rr.status}
                                    {rr.error_class ? ` · ${rr.error_class}` : ""} · attempts{" "}
                                    {rr.attempts}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-hairline bg-white p-6">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Provider readiness — the honest state
        </h4>
        {catalogError ? (
          <div role="alert" className="mt-3 rounded-lg border border-hairline bg-surface-alt p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Couldn&apos;t load the
              provider catalogue: {catalogError}
            </div>
            <button
              type="button"
              onClick={() => void reload()}
              className="mt-2 rounded-lg border border-hairline px-2.5 py-1 text-xs text-foreground hover:bg-white"
            >
              <RefreshCw className="mr-1 inline h-3 w-3" aria-hidden="true" /> Retry
            </button>
          </div>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {providers.map((p) => (
              <li key={p.provider} className="rounded-xl border border-hairline p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{p.displayName}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">Not connected</span>
                </div>
                {p.verification === "fixture_tested" && (
                  <p className="mt-1 text-xs font-medium text-foreground">
                    Adapter implemented — fixture tested — not live verified.
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {p.verification === "none"
                    ? "No adapter in this build. Requires: "
                    : "Requires: "}
                  {p.requirements.map((r, i) => (
                    <span key={r}>
                      {i > 0 ? "; " : ""}
                      {r}
                    </span>
                  ))}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
