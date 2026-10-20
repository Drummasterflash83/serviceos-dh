import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSupabaseClient, supabaseConfig } from "@/lib/supabase";
import { operatorBusinessReviewClient } from "@/lib/openfolk-business-review";
import { LearnCommusoftCustomers } from "@/components/client-portal/learn/LearnCommusoftCustomers";
import { LearnCommusoftWork } from "@/components/client-portal/learn/LearnCommusoftWork";
import { LearnCommusoftSourceJobs } from "@/components/client-portal/learn/LearnCommusoftSourceJobs";
import type { GuidedJobReview } from "@/lib/new-dawn-guided-job-review";
import { ExactJobAutoLink } from "@/components/client-portal/learn/ExactJobAutoLink";
import { OperatorStagedIdentityBatch } from "./OperatorStagedIdentityBatch";

export function OperatorCommusoftReview({
  tenantId,
  actorId,
}: {
  tenantId: string;
  actorId: string;
}) {
  const [reason, setReason] = useState("");
  const [session, setSession] = useState<{ reason: string; generation: number } | null>(null);
  const [kind, setKind] = useState<"customers" | "work" | "source-jobs" | "batch">("source-jobs");
  const [requestedJob, setRequestedJob] = useState<{ connection: string; external: string } | null>(null);
  const [requestedCustomer, setRequestedCustomer] = useState<{ connection: string; external: string } | null>(null);
  const [returnJob, setReturnJob] = useState<{ connection: string; external: string } | null>(null);
  const [guided, setGuided] = useState<GuidedJobReview | null>(null);
  const [requestedSite, setRequestedSite] = useState<{ connection: string; external: string } | null>(null);
  const generation = useRef(0);
  function close() {
    generation.current++;
    setSession(null);
    setRequestedJob(null);
    setRequestedCustomer(null);
    setReturnJob(null);
    setGuided(null);
    setRequestedSite(null);
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
  const exactApply = useQuery({
    queryKey: ["new-dawn-m2-exact-apply-flag", supabaseConfig.url, tenantId, actorId],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().from("feature_flags")
        .select("value").eq("tenant_id", tenantId)
        .eq("flag", "new_dawn.m2_exact_apply").maybeSingle();
      if (error) throw Error("Exact apply setting unavailable");
      return data?.value === true;
    }, staleTime: 0,
  });
  function returnToJob() {
    if (!returnJob) return;
    setRequestedJob(returnJob);
    setRequestedCustomer(null);
    setReturnJob(null);
    setKind("work");
  }
  function afterCustomerReview() {
    if (guided?.site) {
      setRequestedCustomer(null);
      setRequestedSite({ connection: guided.connection, external: guided.site });
      setKind("work");
    } else returnToJob();
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
          <nav aria-label="Business source review" className="flex flex-wrap items-start gap-2">
            <button className="cp-secondary" aria-pressed={kind === "source-jobs"} onClick={() => { setRequestedJob(null); setRequestedCustomer(null); setReturnJob(null); setRequestedSite(null); setGuided(null); setKind("source-jobs"); }}>Captured job cards</button>
            <button
              className="cp-secondary"
              aria-pressed={kind === "customers"}
              onClick={() => { setRequestedJob(null); setRequestedCustomer(null); setReturnJob(null); setRequestedSite(null); setGuided(null); setKind("customers"); }}
            >
              Customers
            </button>
            <button
              className="cp-secondary max-w-full text-left"
              style={{ whiteSpace: "normal" }}
              aria-pressed={kind === "work"}
              onClick={() => { setRequestedJob(null); setRequestedCustomer(null); setReturnJob(null); setRequestedSite(null); setGuided(null); setKind("work"); }}
            >
              Sites, jobs and contacts
            </button>
            <button className="cp-secondary" onClick={close}>
              Close review
            </button>
            <button className="cp-secondary" aria-pressed={kind === "batch"}
              onClick={() => setKind("batch")}>Reviewed batch</button>
          </nav>
          {kind === "batch" && <OperatorStagedIdentityBatch tenantId={tenantId}
            reason={session.reason} active={() => generation.current === session.generation} />}
          {kind === "customers" && returnJob && requestedCustomer && <div role="status" className="space-y-2 text-sm">
            <p>Step 1 of {guided?.site ? "3" : "2"}: review customer source {requestedCustomer.external} for saved job {returnJob.external}. Confirm the account holder from source evidence; no customer is selected automatically.</p>
            <button className="cp-secondary max-w-full whitespace-normal text-left" onClick={() => { setGuided(null); setRequestedSite(null); returnToJob(); }}>Inspect exact job without linking</button>
          </div>}
          {kind === "work" && requestedSite && guided && <p role="status" className="text-sm">
            Step 2 of 3: review exact site {requestedSite.external} for saved job {guided.job}. A linked site receipt opens the exact job review. A held result stays here; no link is assumed.
          </p>}
          {kind === "work" && requestedJob && guided?.site && <div className="space-y-2 text-sm">
            <p>Final step: review saved job {guided.job}. Its source version must still match. The exact-ID action checks both current customer and work-site mappings again before linking.</p>
            <ExactJobAutoLink tenant={tenantId} connection={guided.connection}
              external={guided.job} version={guided.jobVersion}
              canApply={exactApply.data === true} />
          </div>}
          {client &&
            (kind === "source-jobs" ? <LearnCommusoftSourceJobs key={`${tenantId}:${actorId}:${session.generation}`} tenantId={tenantId} actorId={actorId} client={client} operatorReason={session.reason} onReviewJob={(connection, external) => { setGuided(null); setRequestedSite(null); setRequestedJob({ connection, external }); setKind("work"); }} onReviewCustomer={(review) => { setGuided(review); setReturnJob({ connection: review.connection, external: review.job }); setRequestedCustomer({ connection: review.connection, external: review.customer }); setRequestedJob(null); setRequestedSite(null); setKind("customers"); }} onReviewSite={(review) => { setGuided(review); setReturnJob({ connection: review.connection, external: review.job }); setRequestedCustomer(null); setRequestedJob(null); setRequestedSite({ connection: review.connection, external: review.site! }); setKind("work"); }} /> : kind === "customers" ? (
              <LearnCommusoftCustomers
                key={`${tenantId}:${actorId}:${session.generation}`}
                tenantId={tenantId}
                canEdit
                client={client}
                initialCustomer={requestedCustomer}
                onSaved={afterCustomerReview}
              />
            ) : (
              <LearnCommusoftWork
                key={`${tenantId}:${actorId}:${session.generation}:${requestedJob?.external ?? ""}:${requestedSite?.external ?? ""}`}
                tenantId={tenantId}
                actorId={actorId}
                canEdit
                client={client}
                initialJob={requestedJob}
                initialSite={requestedSite}
                expectedJobVersion={requestedJob && guided?.job === requestedJob.external ? guided.jobVersion : undefined}
                expectedCustomer={requestedSite && guided?.site === requestedSite.external ? guided.customer : undefined}
                operatorReason={session.reason}
                canApplyExact={exactApply.data === true}
                onExactSiteLinked={() => {
                  if (!guided || !requestedSite) return;
                  setRequestedSite(null);
                  setRequestedJob({ connection: guided.connection, external: guided.job });
                  setKind("work");
                }}
              />
            ))}
        </>
      )}
    </section>
  );
}
