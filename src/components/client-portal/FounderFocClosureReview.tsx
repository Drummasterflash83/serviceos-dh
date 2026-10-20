import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";
import { readFocClosureReview, type FocClosureReview } from "@/lib/new-dawn-foc-closure-review";

/** Internal commercial-source review. Never mounted for a client or owner. */
export function FounderFocClosureReview({
  tenant,
  operator,
  jobPreviewOpened,
  reason,
  onOpenInformation,
}: {
  tenant: string;
  operator: boolean;
  jobPreviewOpened: boolean;
  reason: string;
  onOpenInformation?: () => void;
}) {
  const { user } = useAuth();
  const flag = useQuery({
    queryKey: ["new-dawn-m3-foc-closure-flag", user?.id, tenant],
    enabled: operator && !!user && jobPreviewOpened,
    queryFn: async () => {
      const { data, error } = await getSupabaseClient()
        .from("feature_flags")
        .select("value")
        .eq("tenant_id", tenant)
        .eq("flag", "new_dawn.m3_foc_closure_review")
        .maybeSingle();
      if (error) throw Error("Closure review setting unavailable");
      return data?.value === true;
    },
    staleTime: 30_000,
  });
  const [review, setReview] = useState<FocClosureReview | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const working = useRef(false);
  useEffect(() => {
    generation.current++;
    working.current = false;
    setReview(null);
    setBusy(false);
    setNotice("");
  }, [tenant, user?.id, jobPreviewOpened, reason, flag.data]);
  if (
    !operator ||
    !jobPreviewOpened ||
    !user ||
    flag.data !== true ||
    reason.trim().length < 3 ||
    reason.trim().length > 500
  )
    return null;
  async function readSaved() {
    if (working.current || !user || flag.data !== true) return;
    const ticket = generation.current;
    working.current = true;
    setBusy(true);
    setNotice("");
    setReview(null);
    try {
      const { data, error } = await getSupabaseClient()
        .rpc("new_dawn_foc_closure_review", {
          p_tenant: tenant,
          p_reason: reason.trim(),
        })
        .abortSignal(AbortSignal.timeout(20_000));
      if (error) throw Error("Closure review unavailable");
      const parsed = readFocClosureReview(data, tenant, user.id);
      if (ticket === generation.current) setReview(parsed);
    } catch {
      if (ticket === generation.current)
        setNotice(
          "Saved closure evidence could not be verified. No commercial conclusion is shown.",
        );
    } finally {
      if (ticket === generation.current) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <section className="nd-money-panel" aria-label="OpenFolk free-of-charge closure review">
      <p className="of-eyebrow">OPENFOLK · PRIVATE COMMERCIAL SOURCE REVIEW</p>
      <h2 className="text-xl font-semibold">Recorded free-of-charge closures</h2>
      <p className="nd-money-scope">
        Exact saved Commusoft job details only. A free-of-charge source outcome warrants checking
        the original decision; it does not establish an uninvoiced job, payment, cost, margin or
        lost revenue.
      </p>
      <button className="cp-secondary" disabled={busy} onClick={() => void readSaved()}>
        {busy ? "Checking saved closure evidence…" : "Review recorded closures"}
      </button>
      {notice && <p role="alert">{notice}</p>}
      {review && (
        <div role="status" className="space-y-3">
          <p className="nd-money-scope">
            {review.candidateCount} exact saved closure{review.candidateCount === 1 ? "" : "s"}{" "}
            match the current reviewed job source; showing up to 20. Checked{" "}
            {new Date(review.checkedAt).toLocaleString("en-GB")}. Later Commusoft changes may not be
            captured.
          </p>
          {review.rows.length === 0 && (
            <p>
              No eligible saved free-of-charge closure was found. This does not prove there are no
              such jobs in Commusoft.
            </p>
          )}
          {review.rows.map((row) => (
            <article key={row.jobId} className="rounded-lg border p-3 text-sm">
              <strong>Job {row.jobNumber || row.externalId} · FreeOfCharge recorded</strong>
              <p>
                Exact Commusoft detail checked {new Date(row.checkedAt).toLocaleString("en-GB")}.
                Source closure time: {row.closedAtSource || "not supplied"}.
              </p>
              <p>Source free-of-charge reason: {row.focReasonSource || "not supplied"}.</p>
              <p className="nd-money-scope">
                Next: inspect the original job and closure reason with Drummonds before treating
                this as a commercial exception. Invoice status and financial impact are unverified.
              </p>
              <details className="text-xs">
                <summary>Exact source</summary>
                <p className="break-all">
                  Job {row.jobId}; connection {row.connectionId}; source version{" "}
                  {row.sourceVersionId}; source SHA-256 {row.sourceSha256}; detail SHA-256{" "}
                  {row.detailSha256}.
                </p>
              </details>
            </article>
          ))}
          {onOpenInformation && (
            <button className="cp-secondary" onClick={onOpenInformation}>
              Browse captured source jobs
            </button>
          )}
          <details className="text-xs">
            <summary>Read audit</summary>
            <p>{review.auditId}</p>
          </details>
          <button className="cp-secondary" onClick={() => setReview(null)}>
            Close closure review
          </button>
        </div>
      )}
    </section>
  );
}
