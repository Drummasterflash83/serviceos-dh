import { useEffect, useRef, useState } from "react";
import { getSupabaseClient, supabaseConfig } from "@/lib/supabase";
import {
  readOperatorInputWriteAccess,
  type OperatorInputClient,
} from "@/lib/learn-operator-inputs";
import {
  readIdentityReviews,
  readIdentityReviewDetail,
  identityReviewAdvice,
  searchIdentityPeople,
  type IdentityPeople,
  identityReviewOutboxKey,
  readSavedIdentityReview,
  resolveSavedIdentityReview,
  type IdentityPage,
  type IdentityHold,
  type IdentityDetail,
  type IdentityReviewRequest,
} from "@/lib/learn-identity-review";
export function OperatorIdentityReview({
  tenantId,
  actorId,
  client,
  backend = supabaseConfig.url.replace(/\/$/, ""),
}: {
  tenantId: string;
  actorId: string;
  client?: OperatorInputClient;
  backend?: string;
}) {
  const scope = { tenantId, actorId, backend },
    scopeKey = identityReviewOutboxKey(scope),
    db = () => client ?? getSupabaseClient();
  const [rows, setRows] = useState<IdentityHold[]>([]),
    [page, setPage] = useState<IdentityPage | null>(null),
    [detail, setDetail] = useState<IdentityDetail | null>(null),
    [pending, setPending] = useState<IdentityReviewRequest | null>(null);
  const [selected, setSelected] = useState<IdentityHold | null>(null),
    [people, setPeople] = useState<IdentityPeople | null>(null),
    [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [reason, setReason] = useState(""),
    [reviewed, setReviewed] = useState(false),
    [canWrite, setCanWrite] = useState<boolean | null>(null),
    [storageReady, setStorageReady] = useState(false);
  const generation = useRef(0),
    working = useRef(false),
    renderScope = useRef(scopeKey);
  renderScope.current = scopeKey;
  function restore() {
    try {
      setPending(readSavedIdentityReview(localStorage, scope));
      setStorageReady(Boolean(navigator.locks));
    } catch {
      setStorageReady(false);
      setNotice(
        "The saved review request needs inspection. It is retained; no new action can be sent.",
      );
    }
  }
  async function operation(work: (current: () => boolean) => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    const ticket = generation.current;
    const current = () => ticket === generation.current && renderScope.current === scopeKey;
    try {
      await work(current);
    } catch (e) {
      if (current()) {
        setDetail(null);
        setReviewed(false);
        setNotice(
          e instanceof Error
            ? e.message
            : "Review could not be confirmed. Refresh before proceeding.",
        );
      }
    } finally {
      if (current()) {
        working.current = false;
        setBusy(false);
        restore();
      }
    }
  }
  async function load(after: string | null = null) {
    await operation(async (current) => {
      setNotice("");
      setDetail(null);
      setReviewed(false);
      setCanWrite(null);
      setSelected(null);
      setPeople(null);
      try {
        const [p, access] = await Promise.all([
          readIdentityReviews(db(), tenantId, after),
          readOperatorInputWriteAccess(db()),
        ]);
        if (!current()) return;
        setPage(p);
        setRows((old) =>
          after
            ? [
                ...old,
                ...p.rows.filter((r) => !old.some((x) => x.interaction_id === r.interaction_id)),
              ]
            : p.rows,
        );
        setCanWrite(access);
      } catch {
        if (current()) {
          setPage(null);
          setRows([]);
        }
        throw Error("Review history is unavailable. This does not mean there are no held inputs.");
      }
    });
  }
  useEffect(() => {
    generation.current++;
    working.current = false;
    setBusy(false);
    setPage(null);
    setRows([]);
    setSelected(null);
    setPeople(null);
    setSearch("");
    setDetail(null);
    setPending(null);
    setCanWrite(null);
    setReason("");
    setReviewed(false);
    setNotice("");
    restore();
    void load();
    const changed = (e: StorageEvent) => {
      if (e.key === null || e.key === scopeKey) {
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
  function selectHold(row: IdentityHold) {
    setSelected(row);
    setPeople(null);
    setSearch("");
    setDetail(null);
    setReviewed(false);
    setReason("");
    setNotice("");
  }
  async function findPeople(after: string | null = null) {
    await operation(async (current) => {
      setDetail(null);
      setReviewed(false);
      setNotice("");
      try {
        const p = await searchIdentityPeople(db(), tenantId, search, after);
        if (current())
          setPeople((old) =>
            after && old
              ? {
                  ...p,
                  rows: [
                    ...old.rows,
                    ...p.rows.filter((r) => !old.rows.some((x) => x.id === r.id)),
                  ],
                }
              : p,
          );
      } catch {
        if (current()) setPeople(null);
        throw Error("Contact search is unavailable. No empty result is assumed.");
      }
    });
  }
  async function inspect(person: string) {
    if (!selected) return;
    await operation(async (current) => {
      setDetail(null);
      setReviewed(false);
      setReason("");
      setNotice("");
      const d = await readIdentityReviewDetail(db(), tenantId, selected.interaction_id, person);
      if (current()) setDetail(d);
    });
  }
  async function resolve(saved: IdentityReviewRequest, mode: "apply" | "check" | "cancel") {
    await operation(async (current) => {
      setNotice("");
      const permission = await readOperatorInputWriteAccess(db());
      if (!current()) return;
      setCanWrite(permission);
      if (permission !== true)
        throw Error(
          "Current OpenFolk administrator access is required. Any saved request is retained.",
        );
      const receipt = await resolveSavedIdentityReview(
        db(),
        localStorage,
        async (key, task) => {
          if (!navigator.locks)
            throw Error("Browser request locking is unavailable. Nothing was sent.");
          return navigator.locks.request(key, task);
        },
        scope,
        saved,
        mode,
        current,
      );
      if (!current()) return;
      setDetail(null);
      setSelected(null);
      setPeople(null);
      setReviewed(false);
      setReason("");
      setNotice(
        receipt.state === "recorded"
          ? "Attribution recorded and customer card updated. The previous communication attribution and operator decision are retained in audit history."
          : receipt.state === "cancelled"
            ? "Unresolved request cancelled. The communication and its review hold are unchanged."
            : "No receipt is recorded yet. Check this same saved request before making another change.",
      );
      if (receipt.state !== "pending") {
        setPage(null);
        setRows([]);
        try {
          const p = await readIdentityReviews(db(), tenantId);
          if (current()) {
            setPage(p);
            setRows(p.rows);
          }
        } catch {
          if (current())
            setNotice(
              "The receipt was recorded, but current review status could not be refreshed. Refresh status before making another change.",
            );
        }
      }
    });
  }
  const disabled = busy || !!pending || !storageReady || canWrite !== true;
  return (
    <section className="cp-card space-y-4" aria-labelledby="identity-review-heading">
      <header className="flex flex-wrap justify-between gap-3">
        <div>
          <h2 id="identity-review-heading" className="text-xl font-semibold">
            Customer attribution needing review
          </h2>
          <p className="text-sm">
            Resolve held customer matches using retained communication evidence and an existing
            contact.
          </p>
        </div>
        <button className="cp-secondary" disabled={busy} onClick={() => void load()}>
          Refresh reviews
        </button>
      </header>
      {notice && (
        <p role="status" className="rounded-lg border p-3">
          {notice}
        </p>
      )}
      {canWrite !== true && (
        <p className="text-sm">
          {canWrite === false
            ? "Read-only access. An OpenFolk administrator must approve changes."
            : "Administrator access has not been verified. Changes are unavailable."}
        </p>
      )}
      {!storageReady && (
        <p className="text-sm">Changes require secure local storage and browser request locking.</p>
      )}
      {pending && (
        <div
          className="rounded-lg border p-4 space-y-2"
          aria-label="Saved communication review request"
        >
          <h3 className="font-semibold">Resolve the saved review request</h3>
          <p>
            Check its recorded result before another change. Cancellation prevents an unresolved
            request from applying later.
          </p>
          <div className="flex flex-wrap gap-2">
            {(["check", "apply", "cancel"] as const).map((mode) => (
              <button
                key={mode}
                className="cp-secondary"
                disabled={busy || !storageReady || canWrite !== true}
                onClick={() => void resolve(pending, mode)}
              >
                {mode === "check"
                  ? "Check saved result"
                  : mode === "apply"
                    ? "Retry saved request"
                    : "Cancel unresolved request"}
              </button>
            ))}
          </div>
        </div>
      )}
      {page && (
        <>
          <p className="text-xs text-muted-foreground">
            Checked {new Date(page.checked_at).toLocaleString("en-GB")}. This list covers customer
            identity holds. Provider and source-projection reviews are separate.
          </p>
          {!rows.length && <p>No identity holds are recorded in this snapshot.</p>}
          <div className="space-y-2">
            {rows.map((row) => (
              <article key={row.interaction_id} className="rounded-lg border p-3">
                <h3 className="font-semibold">
                  {row.subject || row.source_type} ·{" "}
                  {new Date(row.occurred_at).toLocaleString("en-GB")}
                </h3>
                <p className="text-sm">{identityReviewAdvice(row.reason)}</p>
                <button
                  className="cp-secondary mt-2"
                  disabled={busy || !!pending}
                  onClick={() => selectHold(row)}
                >
                  Review customer match
                </button>
              </article>
            ))}
          </div>
          {page.next_cursor && (
            <button
              className="cp-secondary"
              disabled={busy}
              onClick={() => void load(page.next_cursor)}
            >
              Load more reviews
            </button>
          )}
        </>
      )}
      {selected && (
        <div
          className="rounded-lg border p-4 space-y-3"
          aria-label="Find a contact for this communication"
        >
          <h3 className="font-semibold">{selected.subject || "Selected communication"}</h3>
          <p>{identityReviewAdvice(selected.reason)}</p>
          <label className="block">
            Find an existing contact
            <input
              className="cp-input w-full"
              value={search}
              disabled={busy || !!pending}
              maxLength={100}
              onChange={(e) => {
                setSearch(e.target.value);
                setPeople(null);
                setDetail(null);
                setReviewed(false);
              }}
            />
          </label>
          <button
            className="cp-secondary"
            disabled={busy || !!pending || search.trim().length < 2}
            onClick={() => void findPeople()}
          >
            Search contacts
          </button>
          {people && (
            <div className="space-y-2">
              {!people.rows.length && (
                <p>
                  No matching contacts in this search. Try a name, email address or phone number.
                </p>
              )}
              {people.rows.map((p) => (
                <button
                  key={p.id}
                  className="cp-secondary block text-left"
                  disabled={busy || !!pending}
                  onClick={() => void inspect(p.id)}
                >
                  {p.name || "Unnamed contact"} · {p.email || p.phone || "No contact identifier"}
                </button>
              ))}
              {people.next_cursor && (
                <button
                  className="cp-secondary"
                  disabled={busy || !!pending}
                  onClick={() => void findPeople(people.next_cursor)}
                >
                  Load more contacts
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {detail && (
        <div
          className="space-y-3 rounded-lg border p-4"
          aria-label="Customer attribution comparison"
        >
          <h3 className="font-semibold">Review this communication and contact</h3>
          <p>{identityReviewAdvice(detail.blocked_reason)}</p>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border p-3 space-y-2">
              <h4 className="font-semibold">Retained communication</h4>
              <p>
                {detail.source.direction} · {detail.source.occurred_at}
              </p>
              <p>
                From: {detail.source.from_address || detail.source.phone_from || "Not supplied"}
              </p>
              <p>To: {detail.source.to_address || detail.source.phone_to || "Not supplied"}</p>
              <p className="whitespace-pre-wrap break-words">{detail.source.subject}</p>
              <p className="whitespace-pre-wrap break-words">
                {detail.source.preview || "No summary available"}
              </p>
              <p className="text-xs">
                Preview limited to 2,000 characters. Investigate the full source if this does not
                establish the contact.
              </p>
            </div>
            <div className="rounded-lg border p-3 space-y-2">
              <h4 className="font-semibold">Selected contact</h4>
              <p>{detail.person.name || "Unnamed contact"}</p>
              <p>{detail.person.email}</p>
              <p>{detail.person.phone}</p>
              <p>Company: {detail.company?.name || "No company linked"}</p>
              <p>
                {detail.person.verified
                  ? "Contact is marked verified."
                  : "Contact is not marked verified."}
              </p>
              <p className="text-xs">
                Confirming attributes this communication to this contact and their displayed
                company. It does not verify the contact globally or change their company.
              </p>
            </div>
          </div>
          {!!detail.rejected_matches.length && (
            <div className="rounded-lg border p-3">
              <h4 className="font-semibold">Previous rejection</h4>
              {detail.rejected_matches.map((r) => (
                <p key={r.target_type}>
                  {r.target_type}: {r.explanation || "No explanation recorded"}
                </p>
              ))}
              <p>
                Explain why this communication should now be attributed to this contact. The earlier
                rejection remains in history.
              </p>
            </div>
          )}
          <p className="text-sm">
            The recorded decision updates the customer card and retains the previous communication
            record for audit. Manually locked card fields remain protected.
          </p>
          <fieldset disabled={disabled || !detail.can_apply} className="space-y-3">
            <label className="block">
              Review reason
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
            <label className="flex gap-2">
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(e) => setReviewed(e.target.checked)}
              />
              I reviewed this evidence and confirm this communication belongs to the selected
              contact and displayed company.
            </label>
            <button
              className="cp-primary"
              disabled={!reason.trim() || !reviewed}
              onClick={() => {
                if (disabled || !detail.can_apply || !reviewed || !reason.trim()) return;
                void resolve(
                  {
                    version: 1,
                    backend,
                    tenantId,
                    actorId,
                    requestId: crypto.randomUUID(),
                    interactionId: detail.interaction_id,
                    personId: detail.person_id,
                    revision: detail.revision,
                    reason: reason.trim(),
                  },
                  "apply",
                );
              }}
            >
              Confirm contact and update card
            </button>
          </fieldset>
        </div>
      )}
    </section>
  );
}
