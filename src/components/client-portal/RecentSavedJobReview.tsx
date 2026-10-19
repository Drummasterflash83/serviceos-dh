import { useQuery } from "@tanstack/react-query";
import { getSupabaseClient } from "@/lib/supabase";
import { loadCommusoftReviewConnections } from "@/lib/learn-commusoft-review";
import { loadRecentUnlinkedJobs } from "@/lib/new-dawn-recent-unlinked-jobs";
import { dailySourceReview } from "@/lib/new-dawn-daily-source-review";

const savedAt = (value: string | null) =>
  value ? new Date(value).toLocaleString("en-GB") : "not established";

/** A separate audited OpenFolk queue, never part of the client job list. */
export function RecentSavedJobReview({
  tenant,
  actor,
  reason,
  onOpenInformation,
}: {
  tenant: string;
  actor: string;
  reason: string;
  onOpenInformation?: () => void;
}) {
  const recent = useQuery({
    queryKey: ["new-dawn-daily-source-review", tenant, actor, reason],
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const db = getSupabaseClient();
      const connections = await loadCommusoftReviewConnections(db, tenant);
      if (connections.length !== 1) throw Error("Choose a connection in source review.");
      return loadRecentUnlinkedJobs(db, {
        tenant,
        actor,
        connection: connections[0].id,
        reason,
      });
    },
  });
  const page = recent.isSuccess && !recent.isFetching ? recent.data : null;
  return (
    <section
      className="nd-recent-source"
      aria-label="Recent saved Commusoft jobs for OpenFolk review"
    >
      <div className="nd-recent-source-heading">
        <div>
          <h3>Newly captured jobs to review</h3>
          <p>
            OpenFolk only · saved Commusoft observations from the past 24 hours. These records lack
            a current reviewed OpenFolk job link and are not shown to client staff.
          </p>
        </div>
        <button
          className="cp-secondary"
          disabled={recent.isFetching}
          onClick={() => void recent.refetch()}
        >
          {recent.isFetching ? "Checking saved jobs…" : "Refresh recent jobs"}
        </button>
      </div>
      {recent.isPending && <p role="status">Checking recently captured source jobs…</p>}
      {recent.isError && (
        <p role="alert">
          Today's saved source jobs could not be checked here. Open captured source jobs to choose a
          connection or retry.
        </p>
      )}
      {page && (
        <>
          <p className="nd-job-scope">
            <strong>{page.unlinkedCount} unlinked jobs observed in the past 24 hours</strong> · Last
            actual job observation {savedAt(page.latestSourceObservedAt)}. Latest import checkpoint{" "}
            {savedAt(page.latestCheckpointAt)}; a checkpoint may contain no jobs.
          </p>
          {page.rows.length === 0 ? (
            <p>
              No unlinked job observation in this window. This does not establish the current
              Commusoft workload.
            </p>
          ) : (
            <>
              <div className="nd-job-list">
                {page.rows.slice(0, 8).map((row) => {
                  const review = dailySourceReview(row);
                  return (
                    <article className="nd-job-row nd-daily-source-row" key={row.external_id}>
                      <span className="nd-job-main">
                        <strong>Commusoft job {row.external_id}</strong>
                        <small>
                          Recorded source status: {row.source_status ?? "not supplied"} · Captured{" "}
                          {savedAt(row.source_observed_at)}
                        </small>
                      </span>
                      <span className="nd-job-review">
                        <b>Link review needed</b>
                        <small>
                          {review.relationship} · {review.identity}
                        </small>
                      </span>
                      <span className="nd-job-main">
                        <strong>Next step</strong>
                        <small>{review.nextAction}</small>
                      </span>
                    </article>
                  );
                })}
              </div>
              {page.rows.length > 8 && (
                <p className="nd-job-scope">
                  Showing 8 of {page.rows.length} returned records. The source review area has the
                  full saved page.
                </p>
              )}
              {onOpenInformation && (
                <button className="cp-secondary" onClick={onOpenInformation}>
                  Open captured source review
                </button>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
