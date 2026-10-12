import { useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import { operatorBusinessReviewClient } from "@/lib/openfolk-business-review";
import { LearnCommusoftCustomers } from "@/components/client-portal/learn/LearnCommusoftCustomers";
import { LearnCommusoftWork } from "@/components/client-portal/learn/LearnCommusoftWork";

export function OperatorCommusoftReview({
  tenantId,
  actorId,
}: {
  tenantId: string;
  actorId: string;
}) {
  const [reason, setReason] = useState("");
  const [session, setSession] = useState<{ reason: string; generation: number } | null>(null);
  const [kind, setKind] = useState<"customers" | "work">("customers");
  const generation = useRef(0);
  function close() {
    generation.current++;
    setSession(null);
  }
  useEffect(() => {
    const hide = () => {
      if (document.hidden) close();
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      generation.current++;
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);
  useEffect(() => {
    close();
    setReason("");
  }, [tenantId, actorId]);
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(close, 300000);
    return () => clearTimeout(timer);
  }, [session]);
  const client = useMemo(
    () =>
      session
        ? operatorBusinessReviewClient(
            getSupabaseClient(),
            {
              tenant: tenantId,
              actor: actorId,
              reason: session.reason,
            },
            () => generation.current === session.generation,
          )
        : null,
    [tenantId, actorId, session],
  );
  return (
    <section className="op-embedded cp-root min-w-0 space-y-4" aria-label="Review business inputs for cards">
      <header>
        <h2 className="text-xl font-semibold">Turn retained inputs into customer context</h2>
        <p>
          Review customer identities first, then link their sites, jobs and contacts. Each request
          records your operator identity and reason. Shared contact details alone do not prove a
          match.
        </p>
      </header>
      {!session ? (
        <>
          <label className="block">
            Reason for reviewing this client
            <input
              className="cp-input w-full"
              value={reason}
              maxLength={1000}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button
            className="cp-secondary"
            disabled={reason.trim().length < 3}
            onClick={() => {
              const next = ++generation.current;
              setSession({ reason: reason.trim(), generation: next });
            }}
          >
            Open source review
          </button>
        </>
      ) : (
        <>
          <p>
            Review access is rechecked for every action. This view closes after five minutes or when
            the browser is hidden.
          </p>
          <nav aria-label="Business source review" className="flex gap-3">
            <button
              className="cp-secondary"
              aria-pressed={kind === "customers"}
              onClick={() => setKind("customers")}
            >
              Customers
            </button>
            <button
              className="cp-secondary"
              aria-pressed={kind === "work"}
              onClick={() => setKind("work")}
            >
              Sites, jobs and contacts
            </button>
            <button className="cp-secondary" onClick={close}>
              Close review
            </button>
          </nav>
          {client &&
            (kind === "customers" ? (
              <LearnCommusoftCustomers
                key={`${tenantId}:${actorId}:${session.generation}`}
                tenantId={tenantId}
                canEdit
                client={client}
              />
            ) : (
              <LearnCommusoftWork
                key={`${tenantId}:${actorId}:${session.generation}`}
                tenantId={tenantId}
                actorId={actorId}
                canEdit
                client={client}
              />
            ))}
        </>
      )}
    </section>
  );
}
