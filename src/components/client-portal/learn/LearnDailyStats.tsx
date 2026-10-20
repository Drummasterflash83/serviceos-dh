import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";
import {
  dailyStatKeys, readDailyStats, type DailyStatKey,
} from "@/lib/new-dawn-learn-daily-stats";
import { readCommusoftFreshness, type CommusoftFreshness } from "@/lib/new-dawn-commusoft-freshness";

const labels: Record<DailyStatKey, string> = {
  calls: "Calls", recordings: "Recording records", emails: "Emails",
  slack: "Slack messages", jobs: "Commusoft jobs",
  customers: "Commusoft customers", sites: "Commusoft sites",
};
const format = (value: number) => value.toLocaleString("en-GB");
const when = (value: string) => new Date(value).toLocaleString("en-GB", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London",
});

function freshnessText(value: CommusoftFreshness | undefined) {
  if (!value) return "Provider check unavailable";
  if (value.state === "not_checked") return "Provider not checked yet";
  if (value.state === "collecting") return "Checking provider jobs…";
  if (value.state === "saved_advanced") return "Saved jobs changed since the provider check; checking again";
  if (value.state === "stale") return "Provider check is over 24 hours old";
  if (value.state === "partial") return `Comparison incomplete${value.atLeastBehind
    ? ` · at least ${format(value.atLeastBehind)} new jobs found` : ""}`;
  if (value.jobsBehind === 0 && value.savedJobId === value.providerNewestJobId &&
    value.providerNewestJobId) return `Up to date to job ${value.providerNewestJobId}`;
  if (value.jobsBehind !== null) return `${format(value.jobsBehind)} jobs behind${value.providerNewestJobId
    ? ` · newest job ${value.providerNewestJobId}` : ""}`;
  return "Provider comparison unavailable";
}

/** Aggregate source facts, never a provider completeness or processing claim. */
export function LearnDailyStats({ tenantId, operator = false, mdReason }: {
  tenantId: string; operator?: boolean; mdReason?: string;
}) {
  const { user } = useAuth();
  const [reason, setReason] = useState("");
  const [approvedReason, setApprovedReason] = useState<string | null>(mdReason ?? null);
  const flag = useQuery({
    queryKey: ["learn-daily-stats-flag", user?.id, tenantId, operator],
    enabled: !!user,
    retry: false,
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().from("feature_flags")
        .select("value").eq("tenant_id", tenantId)
        .eq("flag", operator ? "new_dawn.learn_daily_stats.operator_preview"
          : "new_dawn.learn_daily_stats").maybeSingle();
      if (error) throw Error("Daily totals release state is unavailable.");
      return data?.value === true;
    },
    staleTime: 30_000,
  });
  const stats = useQuery({
    queryKey: ["learn-daily-stats", user?.id, tenantId, operator, approvedReason],
    enabled: !!user && flag.data === true && (!operator || !!approvedReason),
    retry: false,
    gcTime: 0,
    refetchInterval: operator ? false : 300_000,
    refetchOnWindowFocus: operator ? false : "always",
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().rpc("new_dawn_learn_daily_stats", {
        p_tenant: tenantId, p_operator_reason: operator ? approvedReason : null,
      }).abortSignal(AbortSignal.timeout(30_000));
      if (error || !user) throw Error("Saved daily totals are unavailable.");
      return readDailyStats(data, tenantId, user.id);
    },
  });
  const freshness = useQuery({
    queryKey: ["learn-commusoft-freshness", user?.id, tenantId, operator, approvedReason],
    enabled: !!user && flag.data === true && (!operator || !!approvedReason),
    retry: false,
    gcTime: 0,
    refetchInterval: operator ? false : 300_000,
    refetchOnWindowFocus: operator ? false : "always",
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().rpc("new_dawn_commusoft_freshness_read", {
        p_tenant: tenantId, p_operator_reason: operator ? approvedReason : null,
      }).abortSignal(AbortSignal.timeout(30_000));
      if (error || !user) throw Error("Provider freshness is unavailable.");
      return readCommusoftFreshness(data, tenantId, user.id);
    },
  });
  if (!user || flag.data !== true) return null;
  const value = stats.data;
  return (
    <section className="cp-card lr-daily-stats" aria-label="Saved inputs by day">
      <header className="lr-daily-head">
        <div>
          <p className="of-eyebrow">SAVED IN LEARN</p>
          <h2>What arrived today</h2>
          <p>Today follows the UK calendar. Running totals count retained records, not complete provider history.</p>
        </div>
        {(!operator || approvedReason) && (
          <button className="cp-secondary" disabled={stats.isFetching}
            onClick={() => { void stats.refetch(); void freshness.refetch(); }}><RefreshCw size={15} /> Refresh totals</button>
        )}
      </header>
      {operator && !approvedReason && mdReason === undefined && (
        <form className="lr-daily-reason" onSubmit={(event) => {
          event.preventDefault();
          const next = reason.trim();
          if (next.length >= 3 && next.length <= 500) setApprovedReason(next);
        }}>
          <label htmlFor="learn-daily-reason">Reason for this OpenFolk client preview</label>
          <input id="learn-daily-reason" value={reason} maxLength={500}
            onChange={event => setReason(event.target.value)}
            placeholder="For example, reviewing the LEARN daily ledger" />
          <button className="cp-secondary" disabled={reason.trim().length < 3}>Open audited preview</button>
        </form>
      )}
      {(!operator || approvedReason) && (
        stats.isPending ? <p role="status">Checking saved totals…</p>
          : stats.isError || !value ? <p role="alert">Saved totals could not be checked. Try refreshing later.</p>
            : <>
              <p className="lr-daily-asof">As of {when(value.observedAt)} UK time</p>
              <div className="lr-daily-table" role="table" aria-label="Today's and running saved totals">
                <div className="lr-daily-row lr-daily-column-head" role="row">
                  <span role="columnheader">Input</span>
                  <span role="columnheader">Today</span>
                  <span role="columnheader">Running total</span>
                </div>
                {dailyStatKeys.map(key => (
                  <div className="lr-daily-row" role="row" key={key}>
                    <span role="cell">{labels[key]}</span>
                    <strong role="cell">{format(value.counts[key].today)}</strong>
                    <span role="cell">{format(value.counts[key].total)}</span>
                  </div>
                ))}
              </div>
              <p className="lr-daily-footnote">
                Recording totals count saved metadata, not playable audio. Slack counts include saved public-channel messages with visibility proof; withheld messages are excluded.
                Commusoft totals count distinct saved source IDs with a consistent type. Revisions do not count as new records today.
              </p>
              <div className="lr-daily-job-check">
                <div><span>Last saved Commusoft job observation</span>
                  <strong>{value.latestSavedJob
                    ? `Job ${value.latestSavedJob.number} · ${when(value.latestSavedJob.savedAt)}`
                    : "No saved job observation"}</strong></div>
                <div><span>Newest job at Commusoft</span>
                  <strong>{freshnessText(freshness.data)}</strong>
                  {freshness.data?.providerCheckedAt &&
                    <small>Checked {when(freshness.data.providerCheckedAt)} UK time</small>}
                </div>
              </div>
            </>
      )}
    </section>
  );
}
