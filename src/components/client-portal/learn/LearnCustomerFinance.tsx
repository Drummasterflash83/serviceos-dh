import { useEffect, useRef, useState } from "react";
import { getSupabaseClient, supabaseConfig } from "@/lib/supabase";
import {
  financeAmount,
  financeEntities,
  readFinanceCandidates,
  readFinancePage,
  type FinanceCandidate,
  type FinancePage,
  type FinanceScope,
} from "@/lib/learn-quickbooks-finance";

export function LearnCustomerFinance({
  tenantId,
  actorId,
  cardId,
  operatorReason,
}: {
  tenantId: string;
  actorId: string;
  cardId: string;
  operatorReason?: string;
}) {
  const [environment, setEnvironment] = useState<"production" | "sandbox">("production");
  const [page, setPage] = useState<FinancePage | null>(null);
  const [candidates, setCandidates] = useState<{
    rows: FinanceCandidate[];
    next_after: string | null;
  } | null>(null);
  const [selected, setSelected] = useState<FinanceCandidate | null>(null);
  const [reason, setReason] = useState("");
  const [customerQuery, setCustomerQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadedScope, setLoadedScope] = useState("");
  const generation = useRef(0),
    request = useRef<AbortController | null>(null),
    working = useRef(false);
  const scope: FinanceScope = {
    tenant: tenantId,
    actor: actorId,
    card: cardId,
    environment,
    operatorReason,
  };
  const key = JSON.stringify([
    supabaseConfig.url,
    tenantId,
    actorId,
    cardId,
    environment,
    operatorReason,
    customerQuery,
  ]);
  const visible = loadedScope === key ? page : null;
  const shownCandidates = loadedScope === key ? candidates : null;
  const shownSelection = loadedScope === key ? selected : null;
  function clear() {
    generation.current++;
    request.current?.abort();
    working.current = false;
    setBusy(false);
    setPage(null);
    setCandidates(null);
    setSelected(null);
    setLoadedScope("");
  }
  useEffect(() => {
    clear();
    setReason("");
    setNotice("");
    return clear;
  }, [key]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) {
        clear();
        setNotice("Refresh to recheck access to financial records.");
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);
  useEffect(() => {
    if (!page && !candidates) return;
    const timer = setTimeout(() => {
      clear();
      setNotice("This financial view expired. Refresh to check current access.");
    }, 60000);
    return () => clearTimeout(timer);
  }, [page, candidates]);
  async function load(kind: "finance" | "customers", after: string | null = null) {
    if (working.current) return;
    clear();
    working.current = true;
    setBusy(true);
    setNotice("");
    const ticket = generation.current,
      controller = new AbortController();
    request.current = controller;
    try {
      const args =
        kind === "finance"
          ? {
              p_tenant: tenantId,
              p_card: cardId,
              p_environment: environment,
              p_after: after,
              p_operator_reason: operatorReason ?? null,
            }
          : {
              p_tenant: tenantId,
              p_environment: environment,
              p_after: after,
              p_reason: operatorReason,
              p_query: customerQuery.trim(),
            };
      const { data, error } = await getSupabaseClient()
        .rpc(
          kind === "finance"
            ? "learn_quickbooks_customer_finance"
            : "learn_quickbooks_customer_search",
          args,
        )
        .abortSignal(AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]));
      if (error) throw Error();
      const result =
        kind === "finance"
          ? readFinancePage(data, scope, after)
          : readFinanceCandidates(data, scope, after);
      if (ticket !== generation.current) return;
      setLoadedScope(key);
      if (kind === "finance") setPage(result as FinancePage);
      else setCandidates(result as { rows: FinanceCandidate[]; next_after: string | null });
    } catch {
      if (ticket === generation.current)
        setNotice(
          "Financial records are not available to this account yet. OpenFolk can check the connection and access.",
        );
    } finally {
      if (ticket === generation.current) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  async function link(unlink: boolean) {
    if (
      !shownSelection ||
      !operatorReason ||
      working.current ||
      reason.trim().length < 3 ||
      reason.trim().length > 500
    )
      return;
    const reviewed = shownSelection;
    clear();
    working.current = true;
    setBusy(true);
    setNotice("");
    const ticket = generation.current;
    try {
      const { error } = await getSupabaseClient().rpc("learn_quickbooks_customer_link", {
        p_tenant: tenantId,
        p_version: reviewed.version_id,
        p_card: unlink ? null : cardId,
        p_revision: reviewed.revision,
        p_reason: reason.trim(),
      });
      if (error) throw Error();
      if (ticket === generation.current)
        setNotice(
          unlink
            ? "Customer link removed. Source records and review history are retained."
            : "Customer link saved. Load finances to see the retained records.",
        );
    } catch {
      if (ticket === generation.current)
        setNotice(
          "The link change was not confirmed. Reload QuickBooks customers and check the saved link before trying again.",
        );
    } finally {
      if (ticket === generation.current) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <section aria-label="Customer finances" className="space-y-3 rounded border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold">Customer finances</h3>
        <button className="cp-secondary" disabled={busy} onClick={() => void load("finance")}>
          Load QuickBooks finances
        </button>
      </div>
      <p className="text-sm text-muted-foreground">
        Invoices, payments and credit notes recorded against this reviewed QuickBooks customer or
        its QuickBooks subaccounts. This source hierarchy does not match a transaction to a
        Commusoft job. Recent changes or deleted transactions may still need reconciliation.
      </p>
      {operatorReason && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            QuickBooks environment
            <select
              className="ml-2 rounded border p-2"
              value={environment}
              disabled={busy}
              onChange={(e) => setEnvironment(e.target.value as "production" | "sandbox")}
            >
              <option value="production">Live company</option>
              <option value="sandbox">Sandbox demonstration</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Find QuickBooks customer
            <input
              className="rounded border p-2"
              value={customerQuery}
              maxLength={200}
              disabled={busy}
              placeholder="Name, email, postcode or reference"
              onChange={(e) => setCustomerQuery(e.target.value)}
            />
          </label>
          <button className="cp-secondary" disabled={busy} onClick={() => void load("customers")}>
            Review customer links
          </button>
        </div>
      )}
      {environment === "sandbox" && (
        <p className="font-semibold">Sandbox records — these are not your live company accounts.</p>
      )}
      {busy && <p role="status">Checking QuickBooks records…</p>}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {visible && (
        <>
          <p className="text-sm">
            {visible.linked_customers} reviewed customer links · {visible.records} usable records
            captured
          </p>
          {visible.links_needing_review > 0 && (
            <p>
              {visible.links_needing_review} customer links need review after a source identity
              change. Their figures are withheld.
            </p>
          )}
          {visible.conflicted_records > 0 && (
            <p>
              {visible.conflicted_records} conflicting records are excluded while OpenFolk checks
              them.
            </p>
          )}
          {!visible.linked_customers && (
            <p>
              QuickBooks customers have not been linked to this card yet. This does not mean the
              customer has no financial activity.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {visible.groups.map((g) => (
              <article
                className="min-w-0 rounded border p-3"
                key={JSON.stringify([g.realm_id, g.currency, g.entity])}
              >
                <h4 className="font-semibold">
                  {financeEntities[g.entity]} · {g.currency ?? "Currency not verified"}
                </h4>
                <p>
                  {g.records} captured · Total {financeAmount(g.total, g.currency)}
                </p>
                {g.entity === "Invoice" && (
                  <p className="font-semibold">
                    Outstanding on captured invoices: {financeAmount(g.outstanding, g.currency)}
                  </p>
                )}
                {(g.missing_amounts > 0 || g.missing_balances > 0) && (
                  <p className="text-sm">
                    Some amounts are missing or invalid. Incomplete totals are withheld.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Records last observed between{" "}
                  {new Date(g.oldest_observation).toLocaleString("en-GB")} and{" "}
                  {new Date(g.newest_observation).toLocaleString("en-GB")}
                </p>
                <details className="text-xs">
                  <summary>Source company</summary>
                  <p className="break-all">QuickBooks company {g.realm_id}</p>
                </details>
              </article>
            ))}
          </div>
          {visible.groups.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Payments and credits are shown separately; they are not deducted again from invoice
              balances. Estimates are proposed work. These figures are not a profit calculation.
            </p>
          )}
          <div className="space-y-2">
            {visible.rows.map((r) => (
              <article
                key={r.version_id}
                className="flex min-w-0 flex-wrap justify-between gap-2 rounded border p-3 text-sm"
              >
                <div>
                  <strong>
                    {financeEntities[r.entity]} · {r.document_number ?? r.external_id}
                  </strong>
                  <p>
                    Date {r.transaction_date ?? "not recorded"}
                    {r.due_date ? ` · Due ${r.due_date}` : ""}
                  </p>
                </div>
                <div>
                  <p>{financeAmount(r.amount, r.currency)}</p>
                  {r.entity === "Invoice" && (
                    <p>Outstanding {financeAmount(r.balance, r.currency)}</p>
                  )}
                </div>
                <details className="w-full text-xs">
                  <summary>Source evidence</summary>
                  <p className="break-all">
                    Company {r.realm_id} · Source {r.external_id} · Version {r.version_id}
                  </p>
                  <p>Last observed {new Date(r.last_observed_at).toLocaleString("en-GB")}</p>
                </details>
              </article>
            ))}
          </div>
          {visible.next_after && (
            <button
              className="cp-secondary"
              disabled={busy}
              onClick={() => void load("finance", visible.next_after)}
            >
              Next 25 records
            </button>
          )}
        </>
      )}
      {shownCandidates && (
        <div className="space-y-2">
          <p className="text-sm">
            Check the identity before linking. QuickBooks subaccounts under a reviewed main customer
            can contribute recorded finance through their source hierarchy. Linking a subaccount to
            a different card still needs its own review; existing links to other cards are shown.
          </p>
          {!shownCandidates.rows.length && <p>No captured QuickBooks customers on this page.</p>}
          {shownCandidates.rows.map((c) => (
            <button
              className="block w-full rounded border p-3 text-left text-sm"
              key={c.version_id}
              disabled={busy || c.conflicted}
              aria-pressed={shownSelection?.version_id === c.version_id}
              onClick={() => setSelected(c)}
            >
              <strong>{c.name}</strong>
              <span className="block break-words">
                {c.email ?? "No email"} · {c.phone ?? "No phone"}
              </span>
              <span className="block break-words">{c.address ?? "No billing address"}</span>
              <span className="block">
                {c.card_id === cardId
                  ? "Linked to this card"
                  : c.card_id
                    ? "Already linked to another card"
                    : "Not linked"}
                {c.conflicted ? " · Conflicting source; unavailable for linking" : ""}
              </span>
              <span className="block break-all">
                Company {c.realm_id} · Customer {c.external_id}
                {c.parent_id ? ` · Parent ${c.parent_id}` : ""}
              </span>
            </button>
          ))}
          {shownCandidates.next_after && (
            <button
              className="cp-secondary"
              disabled={busy}
              onClick={() => void load("customers", shownCandidates.next_after)}
            >
              Next 25 QuickBooks customers
            </button>
          )}
        </div>
      )}
      {shownSelection && (
        <div className="space-y-2 rounded border p-3">
          <p>
            Review <strong>{shownSelection.name}</strong> for this ServiceOS customer card.
          </p>
          {shownSelection.card_id && shownSelection.card_id !== cardId && (
            <p className="break-all">
              This will move the link from card {shownSelection.card_id}. Its financial records will
              no longer appear on that card.
            </p>
          )}
          <label className="block text-sm">
            Reason for this identity decision
            <input
              className="mt-1 block w-full rounded border p-2"
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              className="cp-secondary"
              disabled={busy || reason.trim().length < 3}
              onClick={() => void link(false)}
            >
              Confirm link to this customer
            </button>
            {shownSelection.card_id === cardId && (
              <button
                className="cp-secondary"
                disabled={busy || reason.trim().length < 3}
                onClick={() => void link(true)}
              >
                Remove this link
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
