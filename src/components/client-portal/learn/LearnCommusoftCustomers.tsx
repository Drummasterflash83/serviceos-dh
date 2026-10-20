import { RetainedSourceSearch } from "./RetainedSourceSearch";
import { useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import {
  confirmCommusoftCustomer,
  findCommusoftCustomers,
  loadCommusoftReviewConnections,
  loadCommusoftReviewPage,
  type CustomerCandidate,
  type CustomerKind,
  type ReviewConnection,
  type ReviewCustomer,
  type ReviewClient,
} from "@/lib/learn-commusoft-review";

export function LearnCommusoftCustomers({
  tenantId,
  canEdit,
  onSaved,
  client,
  initialCustomer,
}: {
  tenantId: string;
  canEdit: boolean;
  onSaved?: () => void;
  client?: ReviewClient;
  initialCustomer?: { connection: string; external: string } | null;
}) {
  const db = client ?? getSupabaseClient();
  const [connections, setConnections] = useState<ReviewConnection[]>([]),
    [connection, setConnection] = useState("");
  const [rows, setRows] = useState<ReviewCustomer[]>([]),
    [pages, setPages] = useState<(string | null)[]>([null]),
    [next, setNext] = useState<string | null>(null);
  const [sourceSearch, setSourceSearch] = useState(""),
    [appliedSearch, setAppliedSearch] = useState("");
  const [selected, setSelected] = useState<ReviewCustomer | null>(null),
    [kind, setKind] = useState<CustomerKind | "">("");
  const [search, setSearch] = useState(""),
    [searched, setSearched] = useState<string | null>(null),
    [candidates, setCandidates] = useState<CustomerCandidate[]>([]),
    [candidateNext, setCandidateNext] = useState<string | null>(null);
  const [target, setTarget] = useState(""),
    [reason, setReason] = useState(""),
    [approved, setApproved] = useState(false);
  const [accountName, setAccountName] = useState(""),
    [accountEvidence, setAccountEvidence] = useState(""),
    [contactRelation, setContactRelation] = useState<"" | "same" | "different">("");
  const [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [notice, setNotice] = useState("");
  const generation = useRef(0),
    working = useRef(false),
    requestedCustomer = useRef(initialCustomer),
    editable = useRef(canEdit);
  editable.current = canEdit;
  function resetDecision() {
    setAccountName("");
    setAccountEvidence("");
    setContactRelation("");
    setKind("");
    setSearch("");
    setSearched(null);
    setCandidates([]);
    setCandidateNext(null);
    setTarget("");
    setReason("");
    setApproved(false);
  }
  async function operation(work: (ticket: number) => Promise<void>) {
    if (working.current || !editable.current) return;
    working.current = true;
    setBusy(true);
    setNotice("");
    const ticket = ++generation.current;
    try {
      await work(ticket);
    } catch (e) {
      if (ticket === generation.current) {
        setReady(false);
        setApproved(false);
        setNotice(e instanceof Error ? e.message : "Review unavailable. Reload to check.");
      }
    } finally {
      if (ticket === generation.current) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  async function readPage(
    id: string,
    cursors: (string | null)[],
    ticket: number,
    query = appliedSearch,
  ) {
    if (initialCustomer && (id !== initialCustomer.connection || query !== initialCustomer.external))
      throw Error("This guided review is bound to the exact customer source. Return to the job to choose another route.");
    const page = await loadCommusoftReviewPage(
      db,
      tenantId,
      id,
      cursors[cursors.length - 1],
      query,
    );
    if (ticket !== generation.current || !editable.current) return;
    setSourceSearch(query);
    setAppliedSearch(query);
    setConnection(id);
    setRows(initialCustomer ? page.rows.filter((row) => row.external_id === initialCustomer.external) : page.rows);
    setNext(initialCustomer ? null : page.next);
    setPages(cursors);
    const exact = requestedCustomer.current;
    if (exact && id === exact.connection && query === exact.external) {
      const match = page.rows.find((row) => row.external_id === exact.external) ?? null;
      setSelected(match);
      setNotice(match ? "Review this exact customer source before returning to the job." : "The exact customer source is unavailable. Do not select another customer for this job.");
      requestedCustomer.current = null;
    } else setSelected(null);
    resetDecision();
    setReady(true);
  }
  async function reload() {
    await operation(async (ticket) => {
      setReady(false);
      setSelected(null);
      resetDecision();
      const available = await loadCommusoftReviewConnections(db, tenantId);
      if (ticket !== generation.current || !editable.current) return;
      setConnections(available);
      const requested = requestedCustomer.current;
      if (requested && available.some((c) => c.id === requested.connection))
        await readPage(requested.connection, [null], ticket, requested.external);
      else if (requested) {
        requestedCustomer.current = null;
        setReady(true);
        setNotice("The exact customer source connection is unavailable. Do not select another customer for this job.");
      } else if (connection && available.some((c) => c.id === connection))
        await readPage(connection, pages, ticket);
      else {
        setConnection("");
        setRows([]);
        setNext(null);
        setReady(true);
      }
    });
  }
  useEffect(() => {
    working.current = false;
    setSourceSearch("");
    setAppliedSearch("");
    setRows([]);
    setSelected(null);
    void reload();
    return () => {
      generation.current++;
    };
  }, [tenantId, canEdit]);
  async function find(after: string | null = null) {
    if (!selected || !kind || !ready || (after !== null && searched !== search.trim())) return;
    const source = selected,
      chosenKind = kind,
      query = search.trim();
    await operation(async (ticket) => {
      setApproved(false);
      setTarget("");
      const result = await findCommusoftCustomers(
        db,
        tenantId,
        source.version_id,
        chosenKind,
        query,
        after,
      );
      if (ticket !== generation.current) return;
      setCandidates(result.rows);
      setCandidateNext(result.next);
      setSearched(query);
    });
  }
  async function save() {
    if (
      !selected ||
      !kind ||
      !target ||
      !approved ||
      !ready ||
      searched !== search.trim() ||
      reason.trim().length < 3 ||
      (kind === "person" &&
        target === "new" &&
        (!contactRelation || !accountName.trim() || accountEvidence.trim().length < 3))
    )
      return;
    const input = {
      tenant: tenantId,
      version: selected.version_id,
      kind,
      target: target === "new" ? null : target,
      reason,
      ...(kind === "person" && target === "new"
        ? {
            identity: {
              displayName: accountName,
              contactIsCustomer: contactRelation === "same",
              evidence: accountEvidence,
            },
          }
        : {}),
    };
    await operation(async (ticket) => {
      setApproved(false);
      await confirmCommusoftCustomer(db, input);
      if (ticket !== generation.current) return;
      if (initialCustomer) {
        onSaved?.();
        return;
      }
      onSaved?.();
      await readPage(connection, pages, ticket);
      if (ticket === generation.current)
        setNotice("Customer identity saved. The customer card is ready for review.");
    });
  }
  if (!canEdit)
    return <p>Only your company’s owner or administrator can review customer identities.</p>;
  const matchLabel = {
    shared_email: "Shared email",
    shared_phone: "Shared phone",
    same_name: "Same name",
    search: "Search result",
  };
  return (
    <div className="lr-customer-review space-y-4">
      <p>
        Review retained Commusoft customers and connect them to your customer cards. This screen
        does not start a sync.
      </p>
      <button className="cp-secondary" disabled={busy} onClick={() => void reload()}>
        Reload customer review
      </button>
      {notice && (
        <p role="status" className="lr-notice">
          {notice}
        </p>
      )}
      {busy && <p role="status">Reading or saving the review…</p>}
      {ready && !connections.length && (
        <p>No verified Commusoft connection is available for review.</p>
      )}
      <fieldset className="space-y-3" disabled={busy || !ready}>
        {initialCustomer ? <p>Exact customer source {initialCustomer.external} · connection locked for this job review.</p> : <label className="block">
          Commusoft connection{" "}
          <select
            aria-label="Commusoft connection"
            value={connection}
            onChange={(e) => {
              const id = e.target.value;
              setSelected(null);
              resetDecision();
              if (id) void operation((t) => readPage(id, [null], t, ""));
              else {
                setConnection("");
                setRows([]);
              }
            }}
          >
            <option value="">Choose a connection</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>}
        {connection && (
          <>
            {!initialCustomer && <RetainedSourceSearch
              value={sourceSearch}
              applied={appliedSearch}
              hint="Find by customer number, name, email, phone or address"
              onChange={(value) => {
                setSourceSearch(value);
                setSelected(null);
                resetDecision();
              }}
              onSearch={(query) => void operation((t) => readPage(connection, [null], t, query))}
            />}
            <ul className="space-y-2" aria-label="Retained Commusoft customers">
              {rows.map((r) => (
                <li key={r.external_id}>
                  <button
                    className="cp-secondary"
                    onClick={() => {
                      setSelected(r);
                      resetDecision();
                    }}
                    aria-pressed={selected?.external_id === r.external_id}
                  >
                    {r.summary.company_name ?? `Customer ${r.external_id}`}
                    {!r.summary.company_name &&
                      r.summary.person_name &&
                      ` · Primary contact: ${r.summary.person_name}`}{" "}
                    · {r.link ? "Linked" : "Review needed"}
                  </button>
                </li>
              ))}
            </ul>
            {!rows.length && (
              <p>
                {appliedSearch
                  ? "No retained customers match this search."
                  : "No retained customers on this page."}{" "}
                Records that have not yet been imported are not included.
              </p>
            )}
            <div className="flex gap-2">
              <button
                className="cp-secondary"
                disabled={pages.length < 2}
                onClick={() => void operation((t) => readPage(connection, pages.slice(0, -1), t))}
              >
                Previous customers
              </button>
              <button
                className="cp-secondary"
                disabled={!next}
                onClick={() =>
                  next && void operation((t) => readPage(connection, [...pages, next], t))
                }
              >
                Next customers
              </button>
            </div>
          </>
        )}
      </fieldset>
      {selected && (
        <section className="cp-card space-y-3" aria-label="Customer identity review">
          <h3>Commusoft customer {selected.external_id}</h3>
          <p>Observed {new Date(selected.observed_at).toLocaleString("en-GB")}</p>
          <dl>
            <dt>Primary contact</dt>
            <dd>{selected.summary.person_name ?? "Not supplied"}</dd>
            <dt>Company</dt>
            <dd>{selected.summary.company_name ?? "Not supplied"}</dd>
            <dt>Primary contact email and phone</dt>
            <dd>
              {selected.summary.email ?? "No email"} · {selected.summary.phone ?? "No phone"}
            </dd>
            <dt>Address</dt>
            <dd>
              {[selected.summary.address, selected.summary.postcode].filter(Boolean).join(", ") ||
                "Not supplied"}
            </dd>
            <dt>Source customer type</dt>
            <dd>{selected.summary.customer_type ?? "Not supplied"}</dd>
          </dl>
          {selected.link ? (
            <p role="status">
              Linked to an existing {selected.link.entity_table === "people" ? "person" : "company"}{" "}
              card.
              {selected.link.source_version_id !== selected.version_id &&
                " New source information is retained; changes to the linked customer still need review."}
            </p>
          ) : selected.summary.source_type !== "customer" ? (
            <p>This property needs its source type resolved before customer review.</p>
          ) : (
            <fieldset className="space-y-3" disabled={busy || !ready}>
              <label className="block">
                Customer represents{" "}
                <select
                  aria-label="Customer represents"
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value as CustomerKind | "");
                    setAccountName("");
                    setAccountEvidence("");
                    setContactRelation("");
                    setCandidates([]);
                    setSearched(null);
                    setCandidateNext(null);
                    setTarget("");
                    setApproved(false);
                  }}
                >
                  <option value="">Choose after reviewing the source</option>
                  <option value="person">A person</option>
                  <option value="company">A company</option>
                </select>
              </label>
              <p>
                The named contact may be a person at a company. Choose the customer’s identity, not
                just the contact’s name.
              </p>
              <label className="block">
                Search existing customers{" "}
                <input
                  aria-label="Search existing customers"
                  value={search}
                  maxLength={150}
                  placeholder="Name, email, phone or postcode"
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setSearched(null);
                    setCandidates([]);
                    setCandidateNext(null);
                    setTarget("");
                    setApproved(false);
                  }}
                />
              </label>
              <button
                className="cp-secondary"
                disabled={!kind || search.trim().length === 1}
                onClick={() => void find()}
              >
                Find possible matches
              </button>
              <p>
                Leave search blank to look for shared contact details or the same name. These are
                possible matches, not confirmed identities.
              </p>
              {searched !== null && (
                <>
                  {!candidates.length && (
                    <p>
                      No matching customers on this search page. Try another search before creating
                      a customer.
                    </p>
                  )}
                  {candidates.map((c) => (
                    <label key={c.id} className="block">
                      <input
                        type="radio"
                        name="commusoft-target"
                        value={c.id}
                        checked={target === c.id}
                        onChange={() => {
                          setTarget(c.id);
                          setApproved(false);
                        }}
                      />
                      {c.name ?? "Unnamed customer"} ·{" "}
                      {[c.email, c.phone, c.postcode].filter(Boolean).join(" · ")} ·{" "}
                      {matchLabel[c.reason]}
                      {c.match_detail && (
                        <span className="block text-xs">
                          Matching recorded {c.match_detail.channel}: {c.match_detail.value}
                        </span>
                      )}
                    </label>
                  ))}
                  {candidateNext && (
                    <button className="cp-secondary" onClick={() => void find(candidateNext)}>
                      More possible matches
                    </button>
                  )}
                  <label className="block">
                    <input
                      type="radio"
                      name="commusoft-target"
                      checked={target === "new"}
                      onChange={() => {
                        setTarget("new");
                        setApproved(false);
                      }}
                    />
                    Create a new {kind === "company" ? "company" : "person"} customer after checking
                    existing records
                  </label>
                  {target === "new" && kind === "person" && (
                    <section className="space-y-3" aria-label="Confirm customer account holder">
                      <p>
                        Check the customer account in Commusoft or its export. The primary contact
                        above may be someone else, such as a tenant or a family member.
                      </p>
                      <label className="block">
                        Is the primary contact also the customer account holder?
                        <select
                          aria-label="Primary contact relationship"
                          value={contactRelation}
                          onChange={(e) => {
                            const relation = e.target.value as "" | "same" | "different";
                            setContactRelation(relation);
                            setAccountName(
                              relation === "same" ? (selected.summary.person_name ?? "") : "",
                            );
                            setApproved(false);
                          }}
                        >
                          <option value="">Choose after checking the account</option>
                          <option value="same">Yes, the same person</option>
                          <option value="different">No, a different person</option>
                        </select>
                      </label>
                      <label className="block">
                        Confirmed customer account name
                        <input
                          aria-label="Confirmed customer account name"
                          value={accountName}
                          maxLength={1000}
                          readOnly={contactRelation === "same"}
                          onChange={(e) => {
                            setAccountName(e.target.value);
                            setApproved(false);
                          }}
                        />
                      </label>
                      <label className="block">
                        Where you checked the account holder
                        <textarea
                          aria-label="Account holder evidence"
                          value={accountEvidence}
                          maxLength={1000}
                          placeholder="Account number and provider screen, or export date and row"
                          onChange={(e) => {
                            setAccountEvidence(e.target.value);
                            setApproved(false);
                          }}
                        />
                      </label>
                      {contactRelation === "different" && (
                        <p>
                          The account holder gets a separate customer card. The primary contact
                          stays in the retained source for contact review; their email and phone
                          will not be assigned to the account holder.
                        </p>
                      )}
                    </section>
                  )}
                  <label className="block">
                    Review reason{" "}
                    <textarea
                      aria-label="Review reason"
                      value={reason}
                      maxLength={1000}
                      onChange={(e) => {
                        setReason(e.target.value);
                        setApproved(false);
                      }}
                    />
                  </label>
                  <label className="block">
                    <input
                      type="checkbox"
                      checked={approved}
                      onChange={(e) => setApproved(e.target.checked)}
                    />
                    I have checked the source and the selected customer identity.
                  </label>
                  <button
                    className="cp-primary"
                    disabled={
                      !target ||
                      !approved ||
                      reason.trim().length < 3 ||
                      (kind === "person" &&
                        target === "new" &&
                        (!contactRelation ||
                          !accountName.trim() ||
                          accountEvidence.trim().length < 3))
                    }
                    onClick={() => void save()}
                  >
                    Confirm customer identity
                  </button>
                </>
              )}
            </fieldset>
          )}
        </section>
      )}
    </div>
  );
}
