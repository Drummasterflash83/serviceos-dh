import { useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import { operatorBusinessReviewClient } from "@/lib/openfolk-business-review";
import { LearnCommusoftCustomers } from "@/components/client-portal/learn/LearnCommusoftCustomers";
import { LearnCommusoftWork } from "@/components/client-portal/learn/LearnCommusoftWork";
import { LearnCommusoftSourceJobs } from "@/components/client-portal/learn/LearnCommusoftSourceJobs";

export function OperatorCommusoftReview({
  tenantId,
  actorId,
}: {
  tenantId: string;
  actorId: string;
}) {
  const [reason, setReason] = useState("");
  const [session, setSession] = useState<{ reason: string; generation: number } | null>(null);
  const [kind, setKind] = useState<"customers" | "work" | "source-jobs">("source-jobs");
  const [requestedJob, setRequestedJob] = useState<{ connection: string; external: string } | null>(null);
  const [requestedCustomer, setRequestedCustomer] = useState<{ connection: string; external: string } | null>(null);
  const [returnJob, setReturnJob] = useState<{ connection: string; external: string } | null>(null);
  const generation = useRef(0);
  function close() {
    generation.current++;
    setSession(null);
    setRequestedJob(null);
    setRequestedCustomer(null);
    setReturnJob(null);
    setKind("source-jobs");
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
  function returnToJob() {
    if (!returnJob) return;
    setRequestedJob(returnJob);
    setRequestedCustomer(null);
    setReturnJob(null);
    setKind("work");
  }
  return (
    <section className="op-embedded cp-root min-w-0 space-y-4" aria-label="Review business inputs for cards">
      <header>
        <h2 className="text-xl font-semibold">Turn retained inputs into customer context</h2>
        <p>
          Browse captured jobs even when customer identity is unresolved. Review identities before
          linking customer, site, job and contact records. Each request records your operator identity
          and reason. Shared contact details alone do not prove a match.
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
            <button className="cp-secondary" aria-pressed={kind === "source-jobs"} onClick={() => { setRequestedJob(null); setRequestedCustomer(null); setReturnJob(null); setKind("source-jobs"); }}>Captured job cards</button>
            <button
              className="cp-secondary"
              aria-pressed={kind === "customers"}
              onClick={() => { setRequestedJob(null); setRequestedCustomer(null); setReturnJob(null); setKind("customers"); }}
            >
              Customers
            </button>
            <button
              className="cp-secondary"
              aria-pressed={kind === "work"}
              onClick={() => { setRequestedJob(null); setRequestedCustomer(null); setReturnJob(null); setKind("work"); }}
            >
              Sites, jobs and contacts
            </button>
            <button className="cp-secondary" onClick={close}>
              Close review
            </button>
          </nav>
          {kind === "customers" && returnJob && requestedCustomer && <p role="status">
            Reviewing customer source {requestedCustomer.external} for Commusoft job {returnJob.external}.
            Confirm the account holder from source evidence; no customer is selected automatically.
            <button className="cp-secondary ml-2" onClick={returnToJob}>Return to exact job without linking</button>
          </p>}
          {client &&
            (kind === "source-jobs" ? <LearnCommusoftSourceJobs key={`${tenantId}:${actorId}:${session.generation}`} tenantId={tenantId} actorId={actorId} client={client} operatorReason={session.reason} onReviewJob={(connection, external) => { setRequestedJob({ connection, external }); setKind("work"); }} onReviewCustomer={(connection, job, customer) => { setReturnJob({ connection, external: job }); setRequestedCustomer({ connection, external: customer }); setRequestedJob(null); setKind("customers"); }} /> : kind === "customers" ? (
              <LearnCommusoftCustomers
                key={`${tenantId}:${actorId}:${session.generation}`}
                tenantId={tenantId}
                canEdit
                client={client}
                initialCustomer={requestedCustomer}
                onSaved={returnToJob}
              />
            ) : (
              <LearnCommusoftWork
                key={`${tenantId}:${actorId}:${session.generation}:${requestedJob?.connection ?? ""}:${requestedJob?.external ?? ""}`}
                tenantId={tenantId}
                actorId={actorId}
                canEdit
                client={client}
                initialJob={requestedJob}
              />
            ))}
        </>
      )}
    </section>
  );
}
