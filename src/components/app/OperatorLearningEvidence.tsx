import { useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import { readClientInformation, type InformationRow } from "@/lib/openfolk-client-information";

/** Source reads use the same selected-tenant, current-actor audit as the parent. */
export function OperatorLearningEvidence({
  tenantId,
  actorId,
  observation,
  accessReason,
}: {
  tenantId: string;
  actorId: string;
  observation: InformationRow;
  accessReason: string;
}) {
  const [source, setSource] = useState<InformationRow | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const fields = observation.fields;
  const ids = fields.source_interactions;
  const sourceId =
    Array.isArray(ids) && ids.length === 1 && typeof ids[0] === "string" ? ids[0] : null;
  useEffect(() => {
    setSource(null);
    setError("");
    setBusy(false);
    return () => {
      generation.current++;
      request.current?.abort();
    };
  }, [tenantId, actorId, observation.id, accessReason]);

  async function load() {
    if (!sourceId) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const ticket = ++generation.current;
    setBusy(true);
    setSource(null);
    setError("");
    try {
      const page = await readClientInformation(
        getSupabaseClient(),
        {
          tenant: tenantId,
          actor: actorId,
          collection: "communications",
          record: sourceId,
          reason: accessReason,
        },
        AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      );
      if (ticket === generation.current && !document.hidden) setSource(page.rows[0]);
    } catch {
      if (ticket === generation.current)
        setError("The source could not be verified. Reload the records to check your access.");
    } finally {
      if (ticket === generation.current) setBusy(false);
    }
  }
  const text = (value: unknown) => (typeof value === "string" && value ? value : "Not recorded");
  return (
    <section className="my-3 space-y-3 rounded border p-3" aria-label="Learning evidence">
      <p>Rules-based observation · {text(fields.operational_mode).replaceAll("_", " ")}</p>
      <p>
        {fields.source_current === true
          ? "Source version matched when these records were loaded."
          : fields.source_current === false
            ? "The source has changed since this observation. This result needs reprocessing before it can describe the current source."
            : "The source version could not be verified. Treat this result as historical evidence."}
      </p>
      <button className="cp-secondary" disabled={busy || !sourceId} onClick={() => void load()}>
        {busy ? "Checking source…" : "View source communication"}
      </button>
      {error && <p role="alert">{error}</p>}
      {source && (
        <div className="space-y-2" aria-label="Source communication">
          <h3 className="font-semibold">{text(source.fields.subject)}</h3>
          <p>
            {text(source.fields.source_type)} · {text(source.fields.direction)} ·{" "}
            {text(source.fields.occurred_at)}
          </p>
          <p className="whitespace-pre-wrap break-words">{text(source.fields.body_preview)}</p>
          <p className="text-sm">
            Saved communication excerpt. The full original remains in retained inputs; this is not
            proof of complete provider history.
          </p>
          <p className="text-xs">
            Source record {source.id} · access recorded under your operator account
          </p>
        </div>
      )}
    </section>
  );
}
