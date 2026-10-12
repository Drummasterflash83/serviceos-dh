import { useEffect, useRef, useState } from "react";
import { OperatorLearningEvidence } from "./OperatorLearningEvidence";
import { OperatorSlackWorkContext } from "./OperatorSlackWorkContext";
import { getSupabaseClient, supabaseConfig } from "@/lib/supabase";
import { PhoneAudioViewer } from "@/components/client-portal/learn/LearnPhoneAudio";
import { LearnCustomerBusinessContext } from "@/components/client-portal/learn/LearnCustomerBusinessContext";
import {
  clientInformationCollections,
  readClientInformation,
  type InformationCollection,
  type InformationPage,
} from "@/lib/openfolk-client-information";

export function OperatorClientInformation({
  tenantId,
  actorId,
  company,
}: {
  tenantId: string;
  actorId: string;
  company: string;
}) {
  const [collection, setCollection] = useState<InformationCollection>("business_sources");
  const [reason, setReason] = useState("");
  const [page, setPage] = useState<InformationPage | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const scope = `${tenantId}:${actorId}:${collection}`;
  const [loadedScope, setLoadedScope] = useState("");
  const [loadedReason, setLoadedReason] = useState("");
  const visible = loadedScope === scope ? page : null;
  function clear() {
    generation.current++;
    request.current?.abort();
    setPage(null);
    setSelected(null);
    setBusy(false);
  }
  useEffect(() => {
    clear();
    setError("");
    return () => {
      generation.current++;
      request.current?.abort();
    };
  }, [tenantId, actorId, collection]);
  // Private content is not cached across background sessions or account switches.
  useEffect(() => {
    const hide = () => {
      if (document.hidden) clear();
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);
  useEffect(() => {
    if (!page) return;
    const timer = setTimeout(() => {
      clear();
      setError("This view expired. Load current records to recheck your access.");
    }, 300000);
    return () => clearTimeout(timer);
  }, [page]);
  async function load(after: string | null = null) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const ticket = ++generation.current;
    setBusy(true);
    setPage(null);
    setSelected(null);
    setError("");
    try {
      const result = await readClientInformation(
        getSupabaseClient(),
        { tenant: tenantId, actor: actorId, collection, reason, after },
        AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      );
      if (ticket !== generation.current) return;
      setPage(result);
      setLoadedScope(scope);
      setLoadedReason(reason.trim());
    } catch (e) {
      if (ticket === generation.current)
        setError(e instanceof Error ? e.message : "Client information is unavailable.");
    } finally {
      if (ticket === generation.current) setBusy(false);
    }
  }
  const title = (fields: Record<string, unknown>, id: string) =>
    String(
      fields.title ??
        fields.display_name ??
        fields.name ??
        fields.label ??
        fields.subject ??
        fields.external_id ??
        fields.provider_call_id ??
        id,
    );
  const format = (value: unknown) =>
    value === null
      ? "Not recorded"
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  return (
    <section
      className="op-embedded cp-root min-w-0 space-y-5"
      aria-labelledby="client-information-heading"
    >
      <header>
        <p className="op-eyebrow">OPENFOLK · CLIENT INFORMATION</p>
        <h1 id="client-information-heading" className="text-2xl font-semibold">
          {company}
        </h1>
        <p>
          Read retained inputs and published records for this client. Each load records your
          operator identity and reason.
        </p>
      </header>
      <p className="rounded border p-3">
        Retained inputs are source evidence. They may still need reconciliation and publication
        before appearing on customer cards. These lists do not prove complete provider coverage.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          Records
          <select
            className="block w-full rounded border p-2"
            value={collection}
            onChange={(e) => {
              clear();
              setCollection(e.target.value as InformationCollection);
            }}
          >
            {Object.entries(clientInformationCollections).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          Reason for access
          <input
            className="block w-full rounded border p-2"
            value={reason}
            maxLength={500}
            placeholder="For example: review job relationships"
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      </div>
      <button
        className="cp-primary"
        disabled={busy || reason.trim().length < 3}
        onClick={() => void load()}
      >
        {busy ? "Loading client records…" : "Load current records"}
      </button>
      {error && <p role="alert">{error}</p>}
      {visible && (
        <>
          <p className="text-sm">
            {visible.rows.length} records in this page · checked{" "}
            {new Date(visible.observed_at).toLocaleString()} · audited operator access
          </p>
          {collection === "learning_observations" && (
            <p>
              Saved rules-based observations from retained communications. These are not AI
              summaries or employee scores, and do not prove complete input coverage. Open a result
              to check its source; no action is taken by viewing it.
            </p>
          )}
          {collection === "recordings" && (
            <p>
              Open a recording to check saved audio. Each playback access is recorded with your
              reason.
            </p>
          )}
          {visible.rows.length === 0 && (
            <p>No retained records were found in this collection for this client.</p>
          )}
          <div className="space-y-3">
            {visible.rows.map((row) => (
              <article className="rounded border p-3" key={row.id}>
                <button
                  className="text-left font-semibold underline"
                  aria-expanded={selected === row.id}
                  onClick={() => setSelected(selected === row.id ? null : row.id)}
                >
                  {title(row.fields, row.id)}
                </button>
                <p className="text-xs text-muted-foreground">Record {row.id}</p>
                {selected === row.id && (
                  <>
                    {collection === "learning_observations" && (
                      <OperatorLearningEvidence
                        key={`${tenantId}:${actorId}:${row.id}`}
                        tenantId={tenantId}
                        actorId={actorId}
                        observation={row}
                        accessReason={loadedReason}
                      />
                    )}
                    {(collection === "recordings" || collection === "calls") && (
                      <PhoneAudioViewer
                        key={`${tenantId}:${actorId}:${row.id}`}
                        tenantId={tenantId}
                        table={collection === "calls" ? "phone_calls" : "phone_recordings"}
                        sourceId={row.id}
                        client={getSupabaseClient()}
                        backend={supabaseConfig.url}
                        operator={{ actor: actorId, reason: loadedReason }}
                      />
                    )}
                    {collection === "customers" && (
                      <LearnCustomerBusinessContext
                        key={`${tenantId}:${actorId}:${row.id}`}
                        tenantId={tenantId}
                        actorId={actorId}
                        cardId={row.id}
                        operatorReason={loadedReason}
                      />
                    )}
                    {collection === "communications" &&
                      row.fields.source_table === "slack_messages" && (
                        <OperatorSlackWorkContext
                          key={`${tenantId}:${actorId}:${row.id}`}
                          tenantId={tenantId}
                          actorId={actorId}
                          interactionId={row.id}
                          accessReason={loadedReason}
                        />
                      )}
                    <dl className="mt-3 space-y-2">
                      {Object.entries(row.fields).map(([key, value]) => (
                        <div key={key}>
                          <dt className="text-sm font-semibold">{key.replaceAll("_", " ")}</dt>
                          <dd className="whitespace-pre-wrap break-words text-sm">
                            {format(value)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    {row.truncated_fields.length > 0 && (
                      <p className="mt-3">
                        Long fields shown as excerpts: {row.truncated_fields.join(", ")}. Original
                        records are retained.
                      </p>
                    )}
                  </>
                )}
              </article>
            ))}
          </div>
          {visible.next_after && (
            <button
              className="cp-secondary"
              disabled={busy || reason.trim().length < 3}
              onClick={() => void load(visible.next_after)}
            >
              Next 25 records
            </button>
          )}
        </>
      )}
    </section>
  );
}
