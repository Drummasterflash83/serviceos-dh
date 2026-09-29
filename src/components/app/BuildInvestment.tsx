import { useQuery } from "@tanstack/react-query";
import { Clock3 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";

type Investment = {
  project: string;
  estimatedHours: number;
  rangeLow: number;
  rangeHigh: number;
  asOf: string;
  firstRecordedBuild: string;
  recordedActivityDates: number;
  confidence: string;
  basis: string;
  scope: string;
  exclusions: string;
  coverage: string;
};

/** OpenFolk-only. The private estimate is fetched through a Chris/admin-gated RPC. */
export function BuildInvestment() {
  const { user } = useAuth();
  const investment = useQuery({
    queryKey: ["openfolk-build-investment", user?.id],
    enabled: Boolean(user?.id),
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<Investment> => {
      const { data, error } = await getSupabaseClient()
        .rpc("openfolk_build_investment")
        .abortSignal(AbortSignal.timeout(15_000));
      if (error || !data) throw new Error("Build estimate could not be loaded.");
      return data as Investment;
    },
  });
  const data = investment.isError ? undefined : investment.data;
  return (
    <section className="op-card op-build-investment" aria-labelledby="build-investment-title">
      <div className="op-build-investment-head">
        <div>
          <p className="op-eyebrow">
            <Clock3 size={16} aria-hidden="true" /> OPENFOLK · BUILD INVESTMENT
          </p>
          <h2 id="build-investment-title">The work behind Service OS</h2>
          <p>The whole platform. From the earlier Claude work to today’s build.</p>
        </div>
        <div className="op-build-investment-total">
          <span>Estimated build time</span>
          <strong>{data ? `~${data.estimatedHours.toLocaleString("en-GB")} hours` : "—"}</strong>
          {data && (
            <span>
              Working range: {data.rangeLow}–{data.rangeHigh} hours
            </span>
          )}
        </div>
      </div>
      {investment.isPending && <p role="status">Loading build estimate…</p>}
      {investment.isError && (
        <p role="alert">
          Build estimate unavailable.{" "}
          <button className="op-button" onClick={() => void investment.refetch()}>
            Retry
          </button>
        </p>
      )}
      {data && (
        <>
          <p>
            Includes hands-on work and time tied up waiting for AI. A retrospective estimate—not
            tracked or billable hours.
          </p>
          <details>
            <summary>How this estimate was made</summary>
            <p>{data.basis}</p>
            <p>{data.scope}</p>
            <p>{data.exclusions}</p>
            <p>{data.coverage}</p>
            <p>
              Confidence: {data.confidence.toLowerCase()}. Snapshot at{" "}
              {new Date(`${data.asOf}T12:00:00Z`).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
                year: "numeric",
                timeZone: "Europe/London",
              })}
              ; it does not automatically count upwards.
            </p>
          </details>
          <p className="op-note">
            Private to OpenFolk · Entire platform investment, not hours charged to Drummond’s.
          </p>
        </>
      )}
    </section>
  );
}
