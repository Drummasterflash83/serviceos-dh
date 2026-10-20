import { useQuery } from "@tanstack/react-query";
import { getSupabaseClient } from "@/lib/supabase";
import { loadCommusoftReviewConnections } from "@/lib/learn-commusoft-review";
import { operatorBusinessReviewClient } from "@/lib/openfolk-business-review";
import { loadRecentUnlinkedJobs, type RecentUnlinkedJob } from "@/lib/new-dawn-recent-unlinked-jobs";
import { dailySourceReview } from "@/lib/new-dawn-daily-source-review";

const savedAt = (value: string | null) =>
  value ? new Date(value).toLocaleString("en-GB") : "not established";

function RecentJobRow({ row }: { row: RecentUnlinkedJob }) {
  const review = dailySourceReview(row);
  return (
    <article className="nd-job-row nd-daily-source-row">
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
}

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
    queryFn: async ({ signal }) => {
      const db = getSupabaseClient();
      const reviewed = operatorBusinessReviewClient(
        db,
        { tenant, actor, reason },
        () => !signal.aborted,
      );
      const connections = await loadCommusoftReviewConnections(reviewed, tenant);
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
                {page.rows.slice(0, 8).map((row) => <RecentJobRow key={row.external_id} row={row} />)}
              </div>
              {page.rows.length > 8 && (
                <details className="nd-recent-source-more">
                  <summary>Show {page.rows.length - 8} more returned jobs</summary>
                  <div className="nd-job-list">
                    {page.rows.slice(8).map((row) => <RecentJobRow key={row.external_id} row={row} />)}
                  </div>
                </details>
              )}
              {page.unlinkedCount > page.rows.length && <p className="nd-job-scope">
                This bounded view returns the latest {page.rows.length} of {page.unlinkedCount} observed unlinked jobs. Search the captured source review for older records.
              </p>}
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
