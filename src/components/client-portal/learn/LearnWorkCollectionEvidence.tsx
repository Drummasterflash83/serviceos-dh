import { useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import { readWorkCollectionEvidence, type WorkEvidencePart } from "@/lib/learn-resumable-work";
export function LearnWorkCollectionEvidence({
  tenantId,
  requestId,
}: {
  tenantId: string;
  requestId: string;
}) {
  const [open, setOpen] = useState(false),
    [overview, setOverview] = useState<any>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [page, setPage] = useState<any>(null),
    [cursor, setCursor] = useState(0),
    [history, setHistory] = useState<number[]>([]),
    [identity, setIdentity] = useState<{ part: string; data: any } | null>(null);
  const generation = useRef(0),
    pending = useRef(false);
  useEffect(() => {
    const g = ++generation.current;
    setOverview(null);
    setPage(null);
    setCursor(0);
    setHistory([]);
    setIdentity(null);
    setMessage("");
    if (open) {
      pending.current = true;
      setBusy(true);
      void readWorkCollectionEvidence(getSupabaseClient(), tenantId, requestId, "overview")
        .then((d) => {
          if (g === generation.current) setOverview(d);
        })
        .catch((e) => {
          if (g === generation.current) setMessage(e.message);
        })
        .finally(() => {
          if (g === generation.current) {
            pending.current = false;
            setBusy(false);
          }
        });
    }
    return () => {
      generation.current++;
      pending.current = false;
    };
  }, [open, tenantId, requestId]);
  async function read(
    part: WorkEvidencePart,
    after = 0,
    direction: "next" | "previous" | "initial" = "initial",
  ) {
    if (pending.current) return;
    const g = generation.current;
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      const data = await readWorkCollectionEvidence(
        getSupabaseClient(),
        tenantId,
        requestId,
        part,
        after,
      );
      if (g !== generation.current) return;
      if (part === "items") {
        if (page && data.population !== page.population)
          throw Error("Retained population changed unexpectedly");
        setHistory((h) =>
          direction === "next" ? [...h, cursor] : direction === "previous" ? h.slice(0, -1) : [],
        );
        setPage(data);
        setCursor(after);
      } else if (part === "overview") setOverview(data);
      else setIdentity({ part, data: data.data });
    } catch (e) {
      if (g === generation.current)
        setMessage(
          `${e instanceof Error ? e.message : "Evidence unavailable"}. Displayed evidence is kept; try this read again.`,
        );
    } finally {
      if (g === generation.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Retained collection calculation</summary>
      {open && (
        <div className="lp-content lp-calculation">
          {overview && (
            <>
              <p>{overview.explanation}</p>
              <p>
                Frozen at {overview.proof.snapshotAt}. {overview.proof.coveredItems} of{" "}
                {overview.proof.eligibleItems} eligible items covered; {overview.proof.itemCount}{" "}
                retained items in total.
              </p>
              <p>
                The overview is a summary. Inspect item pages and frozen membership to see the
                complete calculation evidence.
              </p>
              <details>
                <summary>Calculation overview</summary>
                <pre>{JSON.stringify(overview.proof, null, 2)}</pre>
              </details>
              <button
                type="button"
                className="cp-secondary"
                disabled={busy}
                onClick={() => void read("items")}
              >
                Read item evidence
              </button>
              <button
                type="button"
                className="cp-secondary"
                disabled={busy}
                onClick={() => void read("membership")}
              >
                Read frozen membership
              </button>
              <button
                type="button"
                className="cp-secondary"
                disabled={busy}
                onClick={() => void read("teams")}
              >
                Read frozen teams
              </button>
            </>
          )}
          {!overview && !busy && (
            <button type="button" className="cp-secondary" onClick={() => void read("overview")}>
              Retry calculation overview
            </button>
          )}
          {identity && (
            <details open>
              <summary>
                {identity.part === "membership" ? "Frozen membership" : "Frozen team directory"}
              </summary>
              <pre>{JSON.stringify(identity.data, null, 2)}</pre>
            </details>
          )}
          {page && (
            <section aria-label="Retained item evidence">
              <p>
                {page.items.length ? `${cursor + 1}–${cursor + page.items.length}` : "0"} of{" "}
                {page.population} retained items. Other pages are not shown here.
              </p>
              {page.items.map((item: any) => (
                <details key={item.object_id}>
                  <summary>
                    Item {item.ordinal}:{" "}
                    {item.result.eligible
                      ? item.result.complete
                        ? "History covered"
                        : "Incomplete history"
                      : "Outside the period"}{" "}
                    · {item.result.knownValue} known{" "}
                    {overview?.proof.kind === "handoffs" ? "handoffs" : "item-minutes"}
                  </summary>
                  <pre>{JSON.stringify(item, null, 2)}</pre>
                </details>
              ))}
              <button
                type="button"
                className="cp-secondary"
                disabled={busy || !history.length}
                onClick={() => void read("items", history.at(-1)!, "previous")}
              >
                Previous evidence page
              </button>
              <button
                type="button"
                className="cp-secondary"
                disabled={busy || page.next === null}
                onClick={() => void read("items", page.next, "next")}
              >
                Next evidence page
              </button>
            </section>
          )}
          {busy && <p role="status">Reading retained evidence…</p>}
          {message && <p role="status">{message}</p>}
        </div>
      )}
    </details>
  );
}
