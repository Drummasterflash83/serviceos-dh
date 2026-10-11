import { useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import {
  readWorkCollectionEvidence,
  readWorkingCollectionItem,
  type WorkEvidencePart,
} from "@/lib/learn-resumable-work";
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
  async function readWorkingItem(item: any) {
    if (pending.current) return;
    const g = generation.current;
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      const data = await readWorkingCollectionItem(
        getSupabaseClient(),
        tenantId,
        requestId,
        overview,
        item,
      );
      if (g === generation.current) setIdentity({ part: "workingItem", data });
    } catch (e) {
      if (g === generation.current)
        setMessage(
          `${e instanceof Error ? e.message : "Evidence unavailable"}. Displayed evidence is kept; retry this item read.`,
        );
    } finally {
      if (g === generation.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  const working = ["workingTime", "teamWorkingTime"].includes(overview?.proof.kind);
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
              {working && (
                <>
                  <p>
                    Selected work states: {overview.proof.states.join(", ")}. Company hours{" "}
                    {overview.proof.calendarComplete
                      ? "cover the period"
                      : "are incomplete; the value is withheld"}
                    .
                  </p>
                  <button
                    type="button"
                    className="cp-secondary"
                    disabled={busy}
                    onClick={() => void read("calendar")}
                  >
                    Read frozen company hours
                  </button>
                </>
              )}
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
                {identity.part === "membership"
                  ? "Frozen membership"
                  : identity.part === "calendar"
                    ? "Frozen company hours and selected states"
                    : identity.part === "workingItem"
                      ? `Item ${identity.data.inputs.ordinal}: frozen working-time inputs`
                      : "Frozen team directory"}
              </summary>
              {identity.part === "workingItem" && (
                <dl>
                  {[
                    ["Elapsed ownership", "elapsedOwnedMicros"],
                    ["In selected work states", "selectedOwnedMicros"],
                    ["Within company hours", "calendarMicros"],
                    ["Approved delays subtracted", "excludedMicros"],
                    ["Assessed working item-minutes", "assessedMicros"],
                  ].map(([label, key]) => (
                    <div key={key}>
                      <dt>{label}</dt>
                      <dd>
                        {(Number(identity.data.result[key]) / 60000000).toLocaleString(undefined, {
                          maximumFractionDigits: 6,
                        })}{" "}
                        item-minutes
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {identity.part === "workingItem" && (
                <p>
                  Interval arithmetic matches the retained hours and approved delays. Review the
                  source history and membership separately before confirming this evidence.
                </p>
              )}
              <details>
                <summary>Complete retained source data</summary>
                <pre>{JSON.stringify(identity.data, null, 2)}</pre>
              </details>
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
                    {overview?.proof.kind === "handoffs"
                      ? "handoffs"
                      : working
                        ? "working item-minutes"
                        : "item-minutes"}
                  </summary>
                  {working && (
                    <button
                      type="button"
                      className="cp-secondary"
                      disabled={busy}
                      onClick={() => void readWorkingItem(item)}
                    >
                      Read and check item {item.ordinal} hours and delays
                    </button>
                  )}
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
