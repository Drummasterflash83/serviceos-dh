import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSupabaseClient, supabaseConfig } from "@/lib/supabase";
import type { ReviewClient } from "@/lib/learn-commusoft-review";
import { loadSourceJobPage } from "@/lib/learn-commusoft-source-jobs";
import { planGuidedJobReview, type GuidedJobReview } from "@/lib/new-dawn-guided-job-review";
import {
  exactLinkReviewAction, exactLinkReviewLabel, loadExactLinkReviewPage,
  type ExactLinkReviewPage, type ExactLinkReviewRow,
} from "@/lib/new-dawn-m2-link-review";

/** Operator-only, audited queue for exact source IDs. It never applies a link. */
export function ExactLinkReviewQueue({ tenant, actor, connection, reason, db, onReviewJob, onReviewCustomer }: {
  tenant: string; actor: string; connection: string; reason: string; db: ReviewClient;
  onReviewJob?: (connection: string, external: string) => void;
  onReviewCustomer?: (review: GuidedJobReview) => void;
}) {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [page, setPage] = useState<ExactLinkReviewPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [hidden, setHidden] = useState(false);
  const [revision, setRevision] = useState(0);
  const [actionId, setActionId] = useState("");
  const flag = useQuery({
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
  const cursor = cursors[cursors.length - 1];
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
    if (flag.data !== true || !connection || hidden) return () => { active = false; };
    setBusy(true);
    void loadExactLinkReviewPage(getSupabaseClient(), {
      tenant, connection, actor, reason, after: cursor,
    }).then(result => { if (active) setPage(result); })
      .catch(() => { if (active) setNotice("Exact-link review is unavailable. Refresh the operator review."); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [tenant, actor, connection, reason, cursor, revision, hidden, flag.data]);
  useEffect(() => {
    if (!page) return;
    const timer = setTimeout(() => { setPage(null); setHidden(true); }, 180_000);
    return () => clearTimeout(timer);
  }, [page]);
  async function reviewExactSource(row: ExactLinkReviewRow) {
    if (!onReviewCustomer || hidden || actionId) return;
    setActionId(row.externalId); setNotice("");
    try {
      const source = await loadSourceJobPage(db, {
        tenant, actor, connection, query: row.externalId, openOnly: false, after: null,
      });
      const exact = source.rows.find(item => item.external_id === row.externalId);
      if (!exact) throw Error("Exact source unavailable");
      onReviewCustomer(planGuidedJobReview(connection, {
        external_id: exact.external_id, version_id: exact.version_id,
        source_observed_at: exact.observed_at, source_status: exact.source_status,
        relationship_state: exact.relationship_state,
        customer_identity_state: exact.customer_identity_state,
      }, exact));
    } catch {
      setNotice("The exact customer/site source is unavailable or changed. Refresh before reviewing it.");
    } finally { setActionId(""); }
  }
  if (flag.data !== true) return null;
  return <section className="rounded-xl border border-[#cbbada] bg-white p-4 space-y-3" aria-label="Exact job-link review queue">
    <div className="flex flex-wrap justify-between gap-2"><div>
      <h4 className="font-semibold">Jobs awaiting exact customer and site links</h4>
      <p className="text-sm">OpenFolk review only. This audited queue covers saved unlinked Commusoft jobs, page by page. A source ID is never matched from a name, number or message text.</p>
    </div><button type="button" className="cp-secondary" onClick={() => { setHidden(false); setCursors([null]); setRevision(v => v + 1); }}>Refresh exact-link review</button></div>
    {busy && <p role="status">Classifying exact source IDs…</p>}
    {notice && <p role="alert">{notice}</p>}
    {page && <>
      <p className="text-sm">Showing {page.rows.length} source IDs on this page · checked {new Date(page.observedAt).toLocaleString("en-GB")}. This is not a total count or proof of a current provider status.</p>
      {!page.rows.length && <p>No unlinked jobs remain after this cursor.</p>}
      <ol className="space-y-2">{page.rows.map(row => <li key={row.externalId} className="rounded-lg border border-[#e5dbe9] p-3 space-y-2">
        <p><strong>Commusoft job {row.externalId}</strong> · {row.state === "ready" ? "Exact IDs ready for job-link review" : "Needs review"}</p>
        <p className="text-sm">{exactLinkReviewLabel(row)}</p>
        {exactLinkReviewAction(row) === "job" && onReviewJob && <button type="button" className="cp-secondary" onClick={() => onReviewJob(connection, row.externalId)}>Review version-checked job link</button>}
        {exactLinkReviewAction(row) === "customer_site" && onReviewCustomer && <button type="button" className="cp-secondary" disabled={!!actionId} onClick={() => void reviewExactSource(row)}>{actionId === row.externalId ? "Checking exact source…" : "Review exact customer and site"}</button>}
        {exactLinkReviewAction(row) === "hold" && <p className="text-sm">Held. Resolve the source or identity conflict before linking.</p>}
      </li>)}</ol>
      <div className="flex justify-between gap-2"><button type="button" className="cp-secondary" disabled={busy || cursors.length === 1} onClick={() => setCursors(v => v.slice(0, -1))}>Previous source IDs</button>
        <button type="button" className="cp-secondary" disabled={busy || !page.nextCursor} onClick={() => page.nextCursor && setCursors(v => [...v, page.nextCursor])}>Next source IDs</button></div>
    </>}
  </section>;
}
