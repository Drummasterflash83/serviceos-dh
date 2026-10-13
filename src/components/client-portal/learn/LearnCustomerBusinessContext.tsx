import { useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import {
  businessCollections,
  readCustomerBusinessContext,
  type BusinessCollection,
  type BusinessContextPage,
} from "@/lib/learn-customer-business-context";
import { jobTimingFields } from "@/lib/learn-job-timing";
import { LearnCustomerFinance } from "./LearnCustomerFinance";

/** The same canonical links are shown to an authorised client and audited operator. */
export function LearnCustomerBusinessContext({
  tenantId,
  actorId,
  cardId,
  operatorReason,
  onOpenJob,
}: {
  tenantId: string;
  actorId: string;
  cardId: string;
  operatorReason?: string;
  onOpenJob?: (jobId: string) => void;
}) {
  const [collection, setCollection] = useState<BusinessCollection>("jobs");
  const [page, setPage] = useState<BusinessContextPage | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0),
    request = useRef<AbortController | null>(null);
  const scope = `${tenantId}:${actorId}:${cardId}:${collection}:${operatorReason ?? ""}`;
  const [loadedScope, setLoadedScope] = useState("");
  const visible = loadedScope === scope ? page : null;
  function clear() {
    generation.current++;
    request.current?.abort();
    setPage(null);
    setBusy(false);
  }
  async function load(after: string | null = null) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const ticket = ++generation.current;
    setPage(null);
    setError("");
    setBusy(true);
    try {
      const result = await readCustomerBusinessContext(
        getSupabaseClient(),
        { tenant: tenantId, actor: actorId, card: cardId, collection, after, operatorReason },
        AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      );
      if (ticket === generation.current) {
        setPage(result);
        setLoadedScope(scope);
      }
    } catch (e) {
      if (ticket === generation.current)
        setError(e instanceof Error ? e.message : "Business records are unavailable.");
    } finally {
      if (ticket === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    void load();
    return clear;
  }, [scope]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) {
        clear();
        setError("Refresh to recheck access to linked business records.");
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);
  useEffect(() => {
    if (!page) return;
    const t = setTimeout(() => {
      clear();
      setError("This business-context view expired. Refresh for current records.");
    }, 60000);
    return () => clearTimeout(t);
  }, [page]);
  return (
    <section className="space-y-3 rounded border p-3" aria-label="Linked customer business records">
      <h3>Sites, jobs and contacts</h3>
      <p>
        Published records linked to this customer. Import and review may still be incomplete; these
        counts do not establish full provider coverage.
      </p>
      <div className="flex flex-wrap gap-2" aria-label="Linked record types">
        {Object.entries(businessCollections).map(([key, label]) => (
          <button
            key={key}
            className="cp-secondary"
            aria-pressed={collection === key}
            onClick={() => {
              if (key !== collection) {
                clear();
                setCollection(key as BusinessCollection);
              }
            }}
          >
            {label}
          </button>
        ))}
        <button className="cp-secondary" disabled={busy} onClick={() => void load()}>
          Refresh business records
        </button>
      </div>
      {busy && <p role="status">Reading linked business records…</p>}
      {error && <p role="alert">{error}</p>}
      {visible && (
        <>
          <p>
            {visible.rows.length} shown · {visible.total} linked{" "}
            {businessCollections[collection].toLowerCase()} recorded · checked{" "}
            {new Date(visible.observed_at).toLocaleString("en-GB")}
          </p>
          {!visible.rows.length && (
            <p>
              No linked records on this page. This does not establish that the customer has no work
              or contacts.
            </p>
          )}
          {visible.rows.map((row) => (
            <article key={row.id} className="space-y-2 rounded border p-3">
              <h4 className="font-semibold">
                {row.fields.title ??
                  row.fields.label ??
                  row.fields.display_name ??
                  "Unnamed record"}
              </h4>
              {collection === "jobs" && (
                <div className="flex flex-wrap items-center gap-3">
                  <strong>
                    {row.fields.job_number
                      ? `Job ${row.fields.job_number}`
                      : "Job number not recorded"}
                  </strong>
                  <span>Recorded status: {row.fields.status ?? "Not recorded"}</span>
                  {onOpenJob && (
                    <button
                      type="button"
                      className="cp-secondary"
                      onClick={() => onOpenJob(row.id)}
                    >
                      Open job &amp; communications
                    </button>
                  )}
                </div>
              )}
              <dl className="space-y-1">
                {Object.entries(row.fields)
                  .filter(
                    ([k]) =>
                      ![
                        "time_evidence",
                        "title",
                        "label",
                        "display_name",
                        "created_date",
                        "completed_date",
                        "site_id",
                        "source_system",
                        "external_id",
                        "updated_at",
                        "verified",
                        ...(collection === "jobs" ? ["job_number", "status"] : []),
                        ...(row.fields.description === row.fields.title ? ["description"] : []),
                      ].includes(k),
                  )
                  .map(([key, value]) => (
                    <div key={key}>
                      <dt className="text-sm font-semibold">
                        {(
                          {
                            address_text: "Address",
                            postcode: "Postcode",
                            primary_email: "Email",
                            primary_phone: "Phone",
                            description: "About this job",
                            priority: "Priority",
                          } as Record<string, string>
                        )[key] ?? key.replaceAll("_", " ")}
                      </dt>
                      <dd className="whitespace-pre-wrap break-words text-sm">
                        {value === null
                          ? "Not recorded"
                          : typeof value === "boolean"
                            ? value
                              ? "Yes"
                              : "Not verified"
                            : String(value)}
                      </dd>
                    </div>
                  ))}
              </dl>
              {collection === "jobs" && (
                <>
                  <p>
                    {row.fields.site_id
                      ? "Linked to a recorded customer site."
                      : "No site link recorded."}
                  </p>
                  {jobTimingFields(row.fields).map((f) => (
                    <p key={f.label}>
                      {f.label}: {f.value}
                    </p>
                  ))}
                </>
              )}
              {!!row.truncated_fields.length && (
                <p>
                  Long fields shown as excerpts: {row.truncated_fields.join(", ")}. Original values
                  are retained.
                </p>
              )}
              <details>
                <summary>Record details &amp; source evidence</summary>
                <p>Verification: {row.fields.verified ? "Verified" : "Awaiting verification"}.</p>
                {row.fields.updated_at && (
                  <p>Record updated: {new Date(row.fields.updated_at).toLocaleString("en-GB")}.</p>
                )}
                {row.fields.external_id && <p>Provider record: {row.fields.external_id}.</p>}
                {row.fields.source_system && (
                  <p className="break-all">Source system: {row.fields.source_system}.</p>
                )}
                {!!row.sources.length && (
                  <>
                    {row.sources.map((s) => (
                      <p key={s.version_id}>
                        {s.provider} · {s.collection} {s.external_id} · source version first
                        retained {new Date(s.first_seen_at).toLocaleString("en-GB")}
                      </p>
                    ))}
                    <p>
                      Up to five publication references are shown. They identify reviewed source
                      versions, not current provider state.
                    </p>
                  </>
                )}
              </details>
            </article>
          ))}
          {visible.next_after && (
            <button
              className="cp-secondary"
              disabled={busy}
              onClick={() => void load(visible.next_after)}
            >
              Next 25 linked records
            </button>
          )}
        </>
      )}
      <LearnCustomerFinance
        tenantId={tenantId}
        actorId={actorId}
        cardId={cardId}
        operatorReason={operatorReason}
      />
    </section>
  );
}
