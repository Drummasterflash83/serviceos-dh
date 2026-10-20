import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";
import type { SourceHomePage } from "@/lib/new-dawn-source-job-home";
import { canShowScoreReadiness, summarizeScoreReadiness } from "@/lib/new-dawn-score-readiness";

/** Private evidence inventory derived only from an already audited job read. */
export function FounderScoreReadiness({ page, tenant, operator }: {
  page: SourceHomePage; tenant: string; operator: boolean;
}) {
  const { user } = useAuth();
  const flag = useQuery({
    queryKey: ["new-dawn-score-readiness-flag", user?.id, tenant],
    enabled: operator && !!user && user.id === page.actorId && tenant === page.tenantId,
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().from("feature_flags")
        .select("value").eq("tenant_id", tenant)
        .eq("flag", "new_dawn.score_readiness.operator_preview").maybeSingle();
      if (error) throw Error("Score readiness setting unavailable");
      return data?.value === true;
    },
    staleTime: 30_000,
  });
  if (!canShowScoreReadiness(operator, tenant, user?.id, page, flag.data === true)) return null;

  const source = summarizeScoreReadiness(page, Date.parse(page.observedAt));
  return <section className="nd-score-readiness" aria-label="OpenFolk score evidence readiness">
    <p className="of-eyebrow">OPENFOLK · PRIVATE SCORE EVIDENCE</p>
    <h2>What the scores still need</h2>
    <p>This is an evidence check of a selected saved job view. It is not a score, a complete workload or a live Commusoft check. No rating is shown to Drummonds or used for pay.</p>
    <p className="nd-score-readiness-source">Audited read {new Date(source.readAt).toLocaleString("en-GB")} · {source.selected} selected jobs from {source.reviewedLinked} reviewed links.</p>
    <div className="nd-score-readiness-grid">
      <article>
        <h3>Jobs · not enough data yet</h3>
        <p>At that read: {source.recent} captured within 24 hours; {source.aged} observations over 24 hours old or invalid; {source.linkReview} source versions or links need review.</p>
        <p>Next: confirm current stage, named owner, diary, commercial close and required job evidence before defining a fair sample.</p>
      </article>
      <article>
        <h3>Customers · not enough data yet</h3>
        <p>{source.namedCustomerRows} selected job rows carry a customer label. A label alone does not establish customer identity or health.</p>
        <p>Next: check customer links, response evidence, PPM obligations and attributed money before assessing outcomes.</p>
      </article>
      <article>
        <h3>Team · not enough data yet</h3>
        <p>This saved job selection has no confirmed assignee, worked hours, billed hours or quoted hours.</p>
        <p>Next: confirm staff identities, job ownership and a genuine weekly hours source. Scores remain advisory and pay-neutral.</p>
      </article>
    </div>
  </section>;
}
