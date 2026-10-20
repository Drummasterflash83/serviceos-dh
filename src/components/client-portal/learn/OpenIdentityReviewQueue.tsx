import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSupabaseClient, supabaseConfig } from "@/lib/supabase";
import type { ReviewClient } from "@/lib/learn-commusoft-review";
import { loadSourceJobPage } from "@/lib/learn-commusoft-source-jobs";
import { planGuidedJobReview, type GuidedJobReview } from "@/lib/new-dawn-guided-job-review";
import { exactLinkReviewAction, exactLinkReviewLabel, exactSourceReviewDestination } from "@/lib/new-dawn-m2-link-review";
import { loadOpenIdentityPage, type OpenIdentityPage, type OpenIdentityRow } from "@/lib/new-dawn-open-identity-review";
import { ExactJobAutoLink } from "./ExactJobAutoLink";

/** Audited operator review, ordered by current saved open status. It does not apply identity links. */
export function OpenIdentityReviewQueue({ tenant, actor, connection, reason, db,
  onReviewJob, onReviewCustomer, onReviewSite }: {
  tenant: string; actor: string; connection: string; reason: string; db: ReviewClient;
  onReviewJob?: (connection: string, external: string) => void;
  onReviewCustomer?: (review: GuidedJobReview) => void;
  onReviewSite?: (review: GuidedJobReview) => void;
}) {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [page, setPage] = useState<OpenIdentityPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [hidden, setHidden] = useState(false);
  const [revision, setRevision] = useState(0);
  const [actionId, setActionId] = useState("");
  const cursor = cursors[cursors.length - 1];
  const reviewFlag = useQuery({
    queryKey: ["new-dawn-m2-link-review-flag", supabaseConfig.url, tenant, actor],
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().from("feature_flags")
        .select("value").eq("tenant_id", tenant)
        .eq("flag", "new_dawn.m2_link_review_queue").maybeSingle();
      if (error) throw Error("Review setting unavailable");
      return data?.value === true;
    },
    staleTime: 30_000,
  });
  const applyFlag = useQuery({
    queryKey: ["new-dawn-m2-exact-apply-flag", supabaseConfig.url, tenant, actor],
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().from("feature_flags")
        .select("value").eq("tenant_id", tenant)
        .eq("flag", "new_dawn.m2_exact_apply").maybeSingle();
      if (error) throw Error("Exact apply setting unavailable");
      return data?.value === true;
    },
    staleTime: 0,
  });
  useEffect(() => {
    setCursors([null]); setPage(null); setNotice(""); setActionId("");
  }, [tenant, actor, connection, reason]);
  useEffect(() => {
    const hide = () => { if (document.hidden) { setHidden(true); setPage(null); } };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);
  useEffect(() => {
    let active = true;
    setPage(null); setNotice("");
    if (reviewFlag.data !== true || !connection || hidden) return () => { active = false; };
    setBusy(true);
    void loadOpenIdentityPage(getSupabaseClient(), {
      tenant, connection, actor, reason, cursor,
    }).then(result => { if (active) setPage(result); })
      .catch(() => { if (active) setNotice("Open-job review is unavailable. Refresh the operator review."); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [tenant, actor, connection, reason, cursor, revision, hidden, reviewFlag.data]);
  useEffect(() => {
    if (!page) return;
    const timer = setTimeout(() => { setPage(null); setHidden(true); }, 180_000);
    return () => clearTimeout(timer);
  }, [page]);

  async function reviewExactSource(row: OpenIdentityRow) {
    if ((!onReviewCustomer && !onReviewSite) || hidden || actionId) return;
    setActionId(row.externalId); setNotice("");
    try {
      const source = await loadSourceJobPage(db, {
        tenant, actor, connection, query: row.externalId, openOnly: false, after: null,
      });
      const exact = source.rows.find(item => item.external_id === row.externalId &&
        item.version_id === row.sourceVersionId);
      if (!exact) throw Error("Current source changed");
      const review = planGuidedJobReview(connection, {
        external_id: exact.external_id, version_id: exact.version_id,
        source_observed_at: exact.observed_at, source_status: exact.source_status,
        relationship_state: exact.relationship_state,
        customer_identity_state: exact.customer_identity_state,
      }, exact);
      const display = { externalId: row.externalId, sourceVersionId: row.sourceVersionId,
        state: row.candidateState, reason: row.holdReason } as const;
      if (exactSourceReviewDestination(display, exact.customer_identity_state, review.site) === "site" && onReviewSite)
        onReviewSite(review);
      else if (onReviewCustomer) onReviewCustomer(review);
      else throw Error("Customer review unavailable");
    } catch {
      setNotice("This job’s source changed or could not be verified. Refresh before reviewing identity.");
    } finally { setActionId(""); }
  }

  if (reviewFlag.data !== true) return null;
  return <section className="rounded-xl border border-[#a890bb] bg-white p-4 space-y-3" aria-label="Open jobs awaiting identity review">
    <div className="flex flex-wrap justify-between gap-2"><div>
      <h4 className="font-semibold">Open jobs needing a customer or site link</h4>
      <p className="text-sm">OpenFolk review only. Saved on-hold work comes first, then pending and open work. Source IDs are suggestions; every link is checked against its current source before it can be applied.</p>
    </div><button type="button" className="cp-secondary" onClick={() => {
      setHidden(false); setCursors([null]); setRevision(v => v + 1);
    }}>Refresh open-job review</button></div>
    {busy && <p role="status">Checking current saved job identities…</p>}
    {notice && <p role="alert">{notice}</p>}
    {page && <>
      <p><strong>{page.totalUnlinked.toLocaleString()} saved open jobs awaiting a reviewed link</strong> · {page.rows.length} on this page.</p>
      <p className="text-sm">Checked {new Date(page.observedAt).toLocaleString("en-GB")}. Recorded source status may have changed in Commusoft since its last import.</p>
      {!page.rows.length && <p>No unlinked open jobs remain on this page.</p>}
      <ol className="space-y-2">{page.rows.map(row => {
        const display = { externalId: row.externalId, sourceVersionId: row.sourceVersionId,
          state: row.candidateState, reason: row.holdReason } as const;
        const action = exactLinkReviewAction(display);
        return <li key={`${row.externalId}:${row.sourceVersionId}`} className="rounded-lg border border-[#e5dbe9] p-3 space-y-2">
          <p><strong>Commusoft job {row.externalId}</strong> · Recorded {row.status === "on_hold" ? "On hold" : row.status === "pending" ? "Pending" : "Open"}</p>
          <p className="text-sm">Customer ID: {row.customerExternalId ?? "Not established"} · Work site ID: {row.propertyExternalId ?? "Not established"} · Source saved {new Date(row.sourceObservedAt).toLocaleString("en-GB")}</p>
          <p className="text-sm">{exactLinkReviewLabel(display)}</p>
          {action === "job" && <ExactJobAutoLink tenant={tenant} connection={connection}
            external={row.externalId} version={row.sourceVersionId} canApply={applyFlag.data === true}
            onInspect={onReviewJob ? () => onReviewJob(connection, row.externalId) : undefined} />}
          {action === "customer_site" && (onReviewCustomer || onReviewSite) && <button type="button" className="cp-secondary" disabled={!!actionId}
            onClick={() => void reviewExactSource(row)}>{actionId === row.externalId ? "Checking exact source…" : "Review customer and work site"}</button>}
          {action === "hold" && <p className="text-sm">Held for source or identity conflict. No match has been guessed.</p>}
        </li>;
      })}</ol>
      <div className="flex justify-between gap-2"><button type="button" className="cp-secondary" disabled={busy || cursors.length === 1}
        onClick={() => setCursors(value => value.slice(0, -1))}>Previous open jobs</button>
        <button type="button" className="cp-secondary" disabled={busy || !page.nextCursor}
          onClick={() => page.nextCursor && setCursors(value => [...value, page.nextCursor])}>Next open jobs</button></div>
    </>}
  </section>;
}
