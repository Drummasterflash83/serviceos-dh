import { LearnJobRefresh } from "./LearnJobRefresh";
import { LearnCommusoftJobDetails } from "./LearnCommusoftJobDetails";
import { RetainedSourceSearch } from "./RetainedSourceSearch";
import { useEffect, useRef, useState } from "react";
import { getSupabaseClient, supabaseConfig } from "@/lib/supabase";
import {
  loadCommusoftReviewConnections,
  findCommusoftContacts,
  type CustomerCandidate,
  type ReviewConnection,
  type ReviewClient,
} from "@/lib/learn-commusoft-review";
import {
  loadWorkPage,
  checkedContactSeparation,
  readWorkDraft,
  resolveWorkDraft,
  workHoldMessage,
  workTimingMessage,
  workOutboxKey,
  OPEN_WORK_QUERY,
  type WorkDraft,
  type WorkKind,
  type WorkReceipt,
  type WorkSource,
} from "@/lib/learn-commusoft-work";
import type { RecoveryLock } from "@/lib/learn-slack-recovery-outbox";
import { exactSiteWasLinked } from "@/lib/new-dawn-guided-job-review";

export function LearnCommusoftWork({
  tenantId,
  actorId,
  canEdit,
  onSaved,
  client,
  initialJob,
  initialSite,
  expectedJobVersion,
  onExactSiteLinked,
}: {
  tenantId: string;
  actorId: string;
  canEdit: boolean;
  onSaved?: () => void;
  client?: ReviewClient;
  initialJob?: { connection: string; external: string } | null;
  initialSite?: { connection: string; external: string } | null;
  expectedJobVersion?: string;
  onExactSiteLinked?: () => void;
}) {
  const db = client ?? getSupabaseClient();
  const exactTarget = initialSite ? { ...initialSite, kind: "site" as const } :
    initialJob ? { ...initialJob, kind: "job" as const } : null;
  const scope = { backend: supabaseConfig.url.replace(/\/$/, ""), actorId, tenantId };
  const [connections, setConnections] = useState<ReviewConnection[]>([]),
    [connection, setConnection] = useState(""),
    [kind, setKind] = useState<WorkKind>(exactTarget?.kind ?? "site");
  const [rows, setRows] = useState<WorkSource[]>([]),
    [pages, setPages] = useState<(string | null)[]>([null]),
    [next, setNext] = useState<string | null>(null);
  const [sourceSearch, setSourceSearch] = useState(exactTarget?.external ?? ""),
    [appliedSearch, setAppliedSearch] = useState(exactTarget?.external ?? "");
  const [targets, setTargets] = useState<Record<string, string>>({}),
    [searches, setSearches] = useState<Record<string, string>>({}),
    [matches, setMatches] = useState<
      Record<string, { rows: CustomerCandidate[]; next: string | null }>
    >({});
  const [separationEvidence, setSeparationEvidence] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string[]>([]),
    [reason, setReason] = useState(""),
    [approved, setApproved] = useState(false);
  const [pending, setPending] = useState<WorkDraft | null>(null),
    [receipt, setReceipt] = useState<WorkReceipt | null>(null);
  const [ready, setReady] = useState(false),
    [storageReady, setStorageReady] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const generation = useRef(0),
    working = useRef(false),
    requestedExact = useRef(exactTarget),
    editable = useRef(canEdit);
  editable.current = canEdit;
  const current = (ticket: number) => generation.current === ticket && editable.current;
  function restore() {
    try {
      setPending(readWorkDraft(localStorage, scope));
      setStorageReady(true);
    } catch (e) {
      setStorageReady(false);
      setNotice(e instanceof Error ? e.message : "Saved review unavailable.");
    }
  }
  function reset() {
    setTargets({});
    setSeparationEvidence({});
    setSearches({});
    setMatches({});
    setSelected([]);
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
      if (current(ticket)) {
        setReady(false);
        setNotice(e instanceof Error ? e.message : "Review unavailable. Reload to check.");
      }
    } finally {
      if (current(ticket)) {
        restore();
        setApproved(false);
        working.current = false;
        setBusy(false);
      }
    }
  }
  async function page(
    id: string,
    type: WorkKind,
    cursors: (string | null)[],
    ticket: number,
    query = appliedSearch,
  ) {
    if (exactTarget && (id !== exactTarget.connection || type !== exactTarget.kind ||
        query !== exactTarget.external || cursors.length !== 1)) {
      throw Error("This review is bound to one saved source. Return to captured jobs to choose another record.");
    }
    setReady(false);
    reset();
    const result = await loadWorkPage(db, tenantId, id, type, cursors[cursors.length - 1], query);
    if (!current(ticket)) return;
    setSourceSearch(query === OPEN_WORK_QUERY ? "" : query);
    setAppliedSearch(query);
    const exact = exactTarget ? result.rows.find(row => row.external_id === exactTarget.external) : null;
    const sourceChanged = !!(exactTarget?.kind === "job" && expectedJobVersion &&
      exact?.version_id !== expectedJobVersion);
    setRows(exactTarget ? exact && !sourceChanged ? [exact] : [] : result.rows);
    setNext(exactTarget ? null : result.next);
    if (sourceChanged) setNotice("This job’s saved source changed. Return to captured jobs and review its current version.");
    else if (exactTarget && !exact) setNotice("This exact source is unavailable. Return to captured jobs and refresh before linking.");
    setPages(cursors);
    setConnection(id);
    setKind(type);
    setReady(true);
  }
  async function reload() {
    await operation(async (ticket) => {
      reset();
      setReady(false);
      const available = await loadCommusoftReviewConnections(db, tenantId);
      if (!current(ticket)) return;
      setConnections(available);
      const requested = requestedExact.current;
      if (requested && available.some((c) => c.id === requested.connection)) {
        await page(requested.connection, requested.kind, [null], ticket, requested.external);
        requestedExact.current = null;
      } else if (requested) {
        requestedExact.current = null;
        setConnection("");
        setRows([]);
        setReady(true);
        setNotice("This source connection is unavailable. Reopen its captured card before reviewing a link.");
      } else if (connection && available.some((c) => c.id === connection))
        await page(connection, kind, pages, ticket);
      else {
        setConnection("");
        setRows([]);
        setReady(true);
      }
    });
  }
  useEffect(() => {
    working.current = false;
    setSourceSearch(exactTarget?.external ?? "");
    setAppliedSearch(exactTarget?.external ?? "");
    setRows([]);
    if (canEdit) {
      restore();
      void reload();
    }
    const changed = (event: StorageEvent) => {
      if (
        event.storageArea === localStorage &&
        (event.key === null || event.key === workOutboxKey(scope))
      ) {
        reset();
        restore();
      }
    };
    if (canEdit) window.addEventListener("storage", changed);
    return () => {
      generation.current++;
      window.removeEventListener("storage", changed);
    };
  }, [tenantId, actorId, canEdit]);
  async function resolve(mode: "apply" | "check" | "cancel") {
    if (!storageReady) return;
    let draft = pending;
    if (!draft) {
      if (
        mode !== "apply" ||
        !ready ||
        !approved ||
        !selected.length ||
        !separationReady ||
        reason.trim().length < 3
      )
        return;
      try {
        draft = {
          version: selected.some((id) => targets[id] === "separate-person") ? 2 : 1,
          scope,
          id: crypto.randomUUID(),
          connection,
          kind,
          items: selected.map((version_id) => ({
            version_id,
            target_id:
              kind === "contact" && targets[version_id] !== "separate-person"
                ? targets[version_id] || null
                : null,
            ...(targets[version_id] === "separate-person"
              ? {
                  identity_review: checkedContactSeparation({
                    mode: "separate_named_person",
                    source_name: rows.find((r) => r.version_id === version_id)!.title,
                    candidate_ids: matches[version_id].rows.map((p) => p.id),
                    evidence: separationEvidence[version_id] ?? "",
                  }),
                }
              : {}),
          })),
          reason,
        };
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "Contact review has changed. Reload before applying.",
        );
        setApproved(false);
        return;
      }
    }
    const request = draft;
    await operation(async (ticket) => {
      const lock: RecoveryLock = async (key, task) => {
        if (!navigator.locks)
          throw Error(
            "This browser cannot coordinate saved reviews. Use a current browser before approving.",
          );
        return navigator.locks.request(key, task);
      };
      const result = await resolveWorkDraft(db, localStorage, lock, scope, request, mode, () =>
        current(ticket),
      );
      if (!current(ticket)) return;
      setReceipt(result);
      reset();
      if (!result) {
        setNotice(
          "No saved result was found yet. Keep this request; check again, retry it, or cancel it.",
        );
        return;
      }
      setPending(null);
      if (result.state === "recorded") {
        onSaved?.();
        const exactSite = rows.find(row => row.external_id === initialSite?.external);
        if (initialSite && exactSiteWasLinked(initialSite, exactSite, request, result))
          onExactSiteLinked?.();
      }
      setNotice(
        result.state === "cancelled"
          ? "This saved batch was cancelled. It will not apply if a delayed request arrives."
          : `${result.linked} linked; ${result.held} need attention. The batch result is saved.`,
      );
      // Keep recovery acknowledgement independent of a subsequent page-read failure.
      setReady(false);
    });
  }
  const separationReady = selected.every(
    (id) =>
      targets[id] !== "separate-person" ||
      (!(searches[id] ?? "").trim() &&
        matches[id]?.rows.length > 0 &&
        matches[id].rows.length <= 50 &&
        !matches[id].next &&
        (separationEvidence[id] ?? "").trim().length >= 20),
  );
  if (!canEdit)
    return <p>Only your company’s owner or administrator can review sites, jobs and contacts.</p>;
  return (
    <div className="lr-customer-review space-y-4">
      <p>
        Link retained sites, jobs and contacts to reviewed customers. Review customers first, then
        sites, then jobs and contacts. Records with unresolved ownership stay available for review.
      </p>
      {notice && (
        <p role="status" className="lr-notice">
          {notice}
        </p>
      )}
      {busy && <p role="status">Checking or saving the review…</p>}
      {pending && (
        <section className="cp-card space-y-3" aria-label="Saved work review">
          <h3>Saved review needs a result</h3>
          <p>
            {pending.items.length} {`${pending.kind}s`} · {pending.reason}
          </p>
          <p>
            Check the saved result first. A retry uses this same request. Cancelling checks whether
            it already finished before recording a cancellation.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              className="cp-secondary"
              disabled={busy || !storageReady}
              onClick={() => void resolve("check")}
            >
              Check saved result
            </button>
            <button
              className="cp-secondary"
              disabled={busy || !storageReady}
              onClick={() => void resolve("apply")}
            >
              Retry saved batch
            </button>
            <button
              className="cp-secondary"
              disabled={busy || !storageReady}
              onClick={() => void resolve("cancel")}
            >
              Cancel saved batch
            </button>
          </div>
        </section>
      )}
      {receipt && (
        <section className="cp-card" aria-label="Saved batch result">
          <h3>{receipt.state === "cancelled" ? "Batch cancelled" : "Batch result"}</h3>
          {receipt.state === "recorded" && (
            <>
              <p>
                {receipt.linked} linked · {receipt.held} need attention
              </p>
              <ul>
                {receipt.items.map((item, index) => (
                  <li key={item.version_id}>
                    Record {index + 1}:{" "}
                    {item.outcome.state === "linked"
                      ? item.outcome.already
                        ? "Already linked"
                        : "Linked"
                      : workHoldMessage(item.outcome.reason)}
                    {workTimingMessage(item.outcome) && <p>{workTimingMessage(item.outcome)}</p>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      <button className="cp-secondary" disabled={busy} onClick={() => void reload()}>
        Reload sites, jobs and contacts
      </button>
      {ready && !connections.length && (
        <p>No verified Commusoft connection is available for review.</p>
      )}
      <fieldset className="space-y-3" disabled={busy || !ready || !storageReady || !!pending}>
        <label className="block">
          Commusoft connection{" "}
          <select
            aria-label="Commusoft connection"
            value={connection}
            disabled={!!exactTarget}
            onChange={(e) => {
              const id = e.target.value;
              if (id) void operation((t) => page(id, kind, [null], t, ""));
              else {
                setConnection("");
                setRows([]);
                reset();
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
        </label>
        <label className="block">
          Review{" "}
          <select
            aria-label="Record type"
            value={kind}
            disabled={!!exactTarget}
            onChange={(e) => {
              const type = e.target.value as WorkKind;
              if (connection) void operation((t) => page(connection, type, [null], t, ""));
              else {
                setKind(type);
                reset();
              }
            }}
          >
            <option value="site">Sites</option>
            <option value="job">Jobs</option>
            <option value="contact">Contacts</option>
          </select>
        </label>
        {connection && (
          <>
            {exactTarget && connection === exactTarget.connection && appliedSearch === exactTarget.external && (
              <p className="text-sm" role="status">Reviewing exact saved {exactTarget.kind} {exactTarget.external}. Confirm its source and customer relationship before selecting it.</p>
            )}
            {initialSite && rows.length === 1 && rows[0].external_id === initialSite.external &&
              rows[0].version_id && rows[0].linked_version_id === rows[0].version_id &&
              rows[0].linked_id && !rows[0].relationship_reason &&
              <button type="button" className="cp-secondary max-w-full whitespace-normal text-left"
                onClick={onExactSiteLinked}>Site already has a current reviewed link — continue to exact job</button>}
            {!exactTarget && <RetainedSourceSearch
              value={sourceSearch}
              applied={
                appliedSearch === OPEN_WORK_QUERY
                  ? "saved open, pending and on-hold jobs"
                  : appliedSearch
              }
              hint={
                kind === "job"
                  ? "Find by job number, property number or description"
                  : kind === "site"
                    ? "Find by site number, customer property number or address"
                    : "Find by contact number, property number, name, email, phone or position"
              }
              onChange={(value) => {
                setSourceSearch(value);
                reset();
              }}
              onSearch={(query) => void operation((t) => page(connection, kind, [null], t, query))}
            />}
            {kind === "job" && !exactTarget && (
              <div className="space-y-2">
                <button
                  type="button"
                  className="cp-secondary"
                  disabled={appliedSearch === OPEN_WORK_QUERY}
                  onClick={() =>
                    void operation((t) => page(connection, "job", [null], t, OPEN_WORK_QUERY))
                  }
                >
                  Show saved open, pending and on-hold jobs
                </button>
                <p className="text-sm">
                  Uses the latest retained Commusoft status. Each job and customer relationship
                  still needs review; this does not confirm live progress or completion.
                </p>
              </div>
            )}
            <ul className="space-y-3" aria-label="Retained sites, jobs and contacts">
              {rows.map((r) => (
                <li className="cp-card" key={r.external_id}>
                  <label className="block">
                    <input
                      type="checkbox"
                      aria-label={`Select ${kind} ${r.external_id}`}
                      checked={!!r.version_id && selected.includes(r.version_id)}
                      disabled={!r.selectable}
                      onChange={(e) => {
                        setApproved(false);
                        setSelected((s) =>
                          e.target.checked
                            ? [...s, r.version_id!]
                            : s.filter((id) => id !== r.version_id),
                        );
                      }}
                    />{" "}
                    {r.title} · {kind} {r.external_id}
                  </label>
                  <p>
                    Customer: {r.customer_name ?? "Needs review"}
                    {r.property_reference && ` · Property ${r.property_reference}`}
                    {r.source_status && ` · ${r.source_status}`}
                  </p>
                  {kind === "job" && r.version_id && (
                    <LearnCommusoftJobDetails
                      key={`${tenantId}:${connection}:${r.version_id}`}
                      tenant={tenantId}
                      connection={connection}
                      version={r.version_id}
                      external={r.external_id}
                      client={client}
                    />
                  )}
                  {r.contact && (
                    <div className="space-y-2">
                      <p>
                        {r.contact.position && `${r.contact.position} · `}
                        {r.contact.email ?? "No source email"}
                      </p>
                      {r.contact.phones.map((phone, i) => (
                        <p key={i}>{phone}</p>
                      ))}
                      {r.version_id && (
                        <>
                          <label className="block">
                            Find an existing person
                            <input
                              aria-label={`Find person for contact ${r.external_id}`}
                              value={searches[r.version_id] ?? ""}
                              maxLength={150}
                              onChange={(e) => {
                                setApproved(false);
                                setSearches((s) => ({ ...s, [r.version_id!]: e.target.value }));
                                setTargets((t) => {
                                  const next = { ...t };
                                  delete next[r.version_id!];
                                  return next;
                                });
                                setMatches((m) => {
                                  const next = { ...m };
                                  delete next[r.version_id!];
                                  return next;
                                });
                              }}
                            />
                          </label>
                          <button
                            className="cp-secondary"
                            disabled={(searches[r.version_id] ?? "").trim().length === 1}
                            onClick={() =>
                              void operation(async (ticket) => {
                                const found = await findCommusoftContacts(
                                  db,
                                  tenantId,
                                  r.version_id!,
                                  searches[r.version_id!] ?? "",
                                );
                                if (current(ticket))
                                  setMatches((m) => ({ ...m, [r.version_id!]: found }));
                              })
                            }
                          >
                            Find matches
                          </button>
                          {matches[r.version_id] && (
                            <>
                              <label className="block">
                                Contact identity
                                <select
                                  aria-label={`Identity for contact ${r.external_id}`}
                                  value={targets[r.version_id] ?? ""}
                                  onChange={(e) => {
                                    setApproved(false);
                                    setTargets((t) => ({ ...t, [r.version_id!]: e.target.value }));
                                  }}
                                >
                                  <option value="">
                                    Create a new person if no channel match exists
                                  </option>
                                  {!(searches[r.version_id] ?? "").trim() &&
                                    matches[r.version_id].rows.length > 0 &&
                                    !matches[r.version_id].next &&
                                    matches[r.version_id].rows.length <= 50 && (
                                      <option value="separate-person">
                                        Create a separate named person after review
                                      </option>
                                    )}
                                  {matches[r.version_id].rows.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.name ?? "Unnamed person"} ·{" "}
                                      {p.email ?? p.phone ?? "No primary endpoint"}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              {targets[r.version_id] === "separate-person" && (
                                <div className="space-y-2">
                                  <p>
                                    This confirms a different named person, even though a name,
                                    email or phone matches. Review every suggestion above. Do not
                                    use this for a household, department or business label. Saved
                                    channels stay unverified; this does not grant permission to
                                    contact anyone.
                                  </p>
                                  <label className="block">
                                    Why these are different people
                                    <textarea
                                      aria-label={`Separation evidence for contact ${r.external_id}`}
                                      value={separationEvidence[r.version_id] ?? ""}
                                      maxLength={1000}
                                      onChange={(e) => {
                                        setApproved(false);
                                        setSeparationEvidence((old) => ({
                                          ...old,
                                          [r.version_id!]: e.target.value,
                                        }));
                                      }}
                                    />
                                  </label>
                                  <p>
                                    Record source evidence for the person's name and role, and
                                    explain any shared contact details (at least 20 characters).
                                  </p>
                                </div>
                              )}
                              {!matches[r.version_id].rows.length && (
                                <p>
                                  No matching person found. Search by name or email to check another
                                  person.
                                </p>
                              )}
                              {matches[r.version_id].next && (
                                <button
                                  className="cp-secondary"
                                  onClick={() =>
                                    void operation(async (ticket) => {
                                      const found = await findCommusoftContacts(
                                        db,
                                        tenantId,
                                        r.version_id!,
                                        searches[r.version_id!] ?? "",
                                        matches[r.version_id!].next,
                                      );
                                      if (current(ticket))
                                        setMatches((m) => ({
                                          ...m,
                                          [r.version_id!]: {
                                            rows: [...m[r.version_id!].rows, ...found.rows],
                                            next: found.next,
                                          },
                                        }));
                                    })
                                  }
                                >
                                  More matching people
                                </button>
                              )}
                            </>
                          )}
                          <p>
                            Matching names or shared contact details are suggestions. Select a
                            person only after reviewing their identity.
                          </p>
                        </>
                      )}
                    </div>
                  )}
                  <p>
                    {r.relationship_reason
                      ? workHoldMessage(r.relationship_reason)
                      : r.version_id !== null && r.linked_version_id === r.version_id
                        ? "Linked"
                        : r.linked_version_id
                          ? "Updated source needs review"
                          : workHoldMessage(null)}
                  </p>
                  {kind === "job" && r.linked_id && (
                    <LearnJobRefresh
                      key={`${tenantId}:${actorId}:${r.linked_id}`}
                      tenant={tenantId}
                      actor={actorId}
                      link={r.linked_id}
                      canEdit={canEdit && !busy}
                      client={client}
                      onSaved={() => {
                        onSaved?.();
                        void reload();
                      }}
                    />
                  )}
                  {workTimingMessage(r.last_result) && <p>{workTimingMessage(r.last_result)}</p>}
                  {r.last_result?.state === "held" && (
                    <p>Last check: {workHoldMessage(r.last_result.reason)}</p>
                  )}
                </li>
              ))}
            </ul>
            {!rows.length && (
              <p>
                {appliedSearch
                  ? `No retained ${kind}s match this search.`
                  : `No retained ${kind}s on this page.`}{" "}
                Records that have not yet been imported are not included.
              </p>
            )}
            <div className="flex gap-2">
              <button
                className="cp-secondary"
                disabled={pages.length < 2}
                onClick={() => void operation((t) => page(connection, kind, pages.slice(0, -1), t))}
              >
                Previous records
              </button>
              <button
                className="cp-secondary"
                disabled={!next}
                onClick={() =>
                  next && void operation((t) => page(connection, kind, [...pages, next], t))
                }
              >
                Next records
              </button>
            </div>
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
              />{" "}
              I have reviewed the selected records and their customer relationships.
            </label>
            <p>
              {selected.length} selected. Existing imported identities that need reconciliation will
              be held for review.
            </p>
            <button
              className="cp-primary"
              disabled={
                !selected.length || !approved || !separationReady || reason.trim().length < 3
              }
              onClick={() => void resolve("apply")}
            >
              Check and link selected
            </button>
          </>
        )}
      </fieldset>
    </div>
  );
}
