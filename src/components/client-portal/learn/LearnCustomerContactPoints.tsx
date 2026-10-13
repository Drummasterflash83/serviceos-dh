import { useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import {
  contactChannels,
  readCustomerContactPoints,
  type CustomerContactPointsPage,
  type CustomerContactPointsScope,
} from "@/lib/learn-customer-contact-points";

/** Additional endpoints remain distinct from primary fields and consent. */
export function LearnCustomerContactPoints({ scope }: { scope: CustomerContactPointsScope }) {
  const [open, setOpen] = useState(false),
    [page, setPage] = useState<CustomerContactPointsPage | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const request = useRef<AbortController | null>(null),
    generation = useRef(0),
    [loadedScope, setLoadedScope] = useState("");
  const key = JSON.stringify([
    scope.tenant,
    scope.actor,
    scope.card,
    scope.person,
    scope.operatorReason ?? null,
  ]);
  const visible = loadedScope === key ? page : null;
  function clear() {
    generation.current++;
    request.current?.abort();
    setPage(null);
    setBusy(false);
  }
  async function load(after: string | null = null) {
    clear();
    const controller = new AbortController();
    request.current = controller;
    const ticket = ++generation.current;
    setOpen(true);
    setError("");
    setBusy(true);
    try {
      const p = await readCustomerContactPoints(
        getSupabaseClient(),
        { ...scope, after },
        AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      );
      if (ticket === generation.current) {
        setPage(p);
        setLoadedScope(key);
      }
    } catch (e) {
      if (ticket === generation.current)
        setError(e instanceof Error ? e.message : "Saved contact details are unavailable.");
    } finally {
      if (ticket === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    clear();
    setOpen(false);
    setError("");
    return clear;
  }, [key]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) {
        clear();
        setOpen(false);
        setError("");
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);
  useEffect(() => {
    if (!page) return;
    const timer = setTimeout(() => {
      clear();
      setError("Refresh to recheck access to saved contact details.");
    }, 60000);
    return () => clearTimeout(timer);
  }, [page]);
  return (
    <section className="space-y-2" aria-label="Saved contact details">
      <button
        type="button"
        className="cp-secondary"
        aria-expanded={open}
        disabled={busy}
        onClick={() => {
          if (open) {
            clear();
            setOpen(false);
            setError("");
          } else void load();
        }}
      >
        {open ? "Hide saved contact details" : "View saved contact details"}
      </button>
      {open && (
        <>
          <p className="text-sm">
            Saved details may include shared or unverified addresses and numbers. They do not
            establish permission to contact this person.
          </p>
          {busy && <p role="status">Reading saved contact details…</p>}
          {error && <p role="alert">{error}</p>}
          {!busy && (
            <button type="button" className="cp-secondary" onClick={() => void load()}>
              Refresh contact details
            </button>
          )}
          {visible && (
            <>
              <p className="text-sm">
                {visible.rows.length} shown · {visible.total} saved details · checked{" "}
                {new Date(visible.observed_at).toLocaleString("en-GB")}
              </p>
              {!visible.rows.length && (
                <p>
                  No additional saved contact details on this page. Primary details above are
                  recorded separately.
                </p>
              )}
              <ul className="space-y-2">
                {visible.rows.map((point) => (
                  <li key={point.id} className="rounded border p-2">
                    <p className="font-semibold">
                      {contactChannels[point.channel]}
                      {point.label ? ` · ${point.label}` : ""}
                      {point.is_primary ? " · Primary" : ""}
                    </p>
                    <p className="whitespace-pre-wrap break-words">{point.value}</p>
                    <p className="text-sm">
                      {point.verification_state === "verified"
                        ? "Verified"
                        : point.verification_state === "invalid"
                          ? "Marked invalid — review before use"
                          : "Not yet verified"}
                    </p>
                    {!!point.truncated_fields.length && (
                      <p className="text-sm">
                        Long details shown as excerpts. Original values remain saved.
                      </p>
                    )}
                    <details>
                      <summary>Detail source</summary>
                      <p className="break-words">Recorded source: {point.source}</p>
                      <p>Updated {new Date(point.updated_at).toLocaleString("en-GB")}</p>
                      {point.last_observed_at && (
                        <p>
                          Last observed {new Date(point.last_observed_at).toLocaleString("en-GB")}
                        </p>
                      )}
                    </details>
                  </li>
                ))}
              </ul>
              {visible.next_after && (
                <button
                  type="button"
                  className="cp-secondary"
                  disabled={busy}
                  onClick={() => void load(visible.next_after)}
                >
                  Next 25 saved details
                </button>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
