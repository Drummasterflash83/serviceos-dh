import { useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";
import {
  dailyStatKeys, dailyStatParts, readDailyStatsPart,
  type DailyStatKey, type DailyStatPart, type DailyStatsPartResult,
} from "@/lib/new-dawn-learn-daily-stats";
import { commusoftFreshnessSummary, readCommusoftFreshness } from "@/lib/new-dawn-commusoft-freshness";
import "@/styles/learn-daily-stats.css";

const labels: Record<DailyStatKey, string> = {
  calls: "Calls", recordings: "Recording records", emails: "Emails",
  slack: "Slack messages", jobs: "Commusoft jobs",
  customers: "Commusoft customers", sites: "Commusoft sites",
};
const partForKey: Record<DailyStatKey, DailyStatPart> = {
  calls: "calls", recordings: "recordings", emails: "emails",
  slack: "slack", jobs: "business", customers: "business", sites: "business",
};
const partLabels: Record<DailyStatPart, string> = {
  calls: "Calls", recordings: "Recordings", emails: "Email",
  slack: "Slack", business: "Commusoft",
};
const format = (value: number) => value.toLocaleString("en-GB");
const when = (value: string) => new Date(value).toLocaleString("en-GB", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London",
});

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
  const statQueries = useQueries({ queries: dailyStatParts.map((part) => ({
    queryKey: ["learn-daily-stats-part", user?.id, tenantId, operator, approvedReason, part],
    enabled: !!user && flag.data === true && (!operator || !!approvedReason),
    retry: false,
    staleTime: 60_000,
    gcTime: 300_000,
    refetchInterval: operator ? false : 300_000,
    refetchOnWindowFocus: operator ? false as const : "always" as const,
    queryFn: async (): Promise<DailyStatsPartResult | null> => {
      try {
        const { data, error } = await getSupabaseClient().rpc("new_dawn_learn_daily_stats_part", {
          p_tenant: tenantId, p_part: part,
          p_operator_reason: operator ? approvedReason : null,
        }).abortSignal(AbortSignal.timeout(25_000));
        if (error || !user) return null;
        return readDailyStatsPart(data, part, tenantId, user.id);
      } catch {
        return null;
      }
    },
  })) });
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
  const parts = Object.fromEntries(dailyStatParts.map((part, index) =>
    [part, statQueries[index].data ?? null])) as Record<DailyStatPart, DailyStatsPartResult | null>;
  const available = dailyStatParts.some((part) => parts[part]);
  const checking = statQueries.some((query) => query.isPending);
  const fetching = statQueries.some((query) => query.isFetching);
  return (
    <section className="cp-card lr-daily-stats" aria-label="Saved inputs by day">
      <header className="lr-daily-head">
        <div>
          <p className="of-eyebrow">SAVED IN LEARN</p>
          <h2>What arrived today</h2>
          <p>Today follows the UK calendar. Running totals count retained records, not complete provider history.</p>
        </div>
        {(!operator || approvedReason) && (
          <button className="cp-secondary" disabled={fetching}
            onClick={() => { statQueries.forEach((query) => { void query.refetch(); }); void freshness.refetch(); }}><RefreshCw size={15} /> Refresh totals</button>
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
        !available && checking ? <p role="status">Checking saved totals…</p>
          : !available ? <p role="alert">Saved totals could not be checked. Try refreshing later.</p>
            : <>
              <p className="lr-daily-asof">Each source is checked separately. {dailyStatParts.map((part, index) =>
                `${partLabels[part]}: ${parts[part] ? when(parts[part]!.observedAt)
                  : statQueries[index].isPending ? "checking" : "could not be checked"}`
              ).join(" · ")} UK time</p>
              <div className="lr-daily-table" role="table" aria-label="Today's and running saved totals">
                <div className="lr-daily-row lr-daily-column-head" role="row">
                  <span role="columnheader">Input</span>
                  <span role="columnheader">Today</span>
                  <span role="columnheader">Running total</span>
                </div>
                {dailyStatKeys.map(key => {
                  const part = partForKey[key];
                  const count = parts[part]?.counts[key];
                  const pending = statQueries[dailyStatParts.indexOf(part)].isPending;
                  return (
                  <div className="lr-daily-row" role="row" key={key}>
                    <span role="cell">{labels[key]}</span>
                    <strong role="cell">{count ? format(count.today) : pending ? "Checking" : "Not checked"}</strong>
                    <span role="cell">{count ? format(count.total) : pending ? "Checking" : "Not checked"}</span>
                  </div>
                  );
                })}
              </div>
              <p className="lr-daily-footnote">
                Recording totals count saved metadata, not playable audio. Slack counts include saved public-channel messages with visibility proof; withheld messages are excluded.
                Commusoft totals count distinct saved source IDs with a consistent type. Revisions do not count as new records today.
              </p>
              <div className="lr-daily-job-check">
                <div><span>Newest saved Commusoft job</span>
                  <strong>{!parts.business ? statQueries[dailyStatParts.indexOf("business")].isPending
                    ? "Checking Commusoft" : "Commusoft check unavailable"
                    : parts.business.latestSavedJob
                      ? `Job ${parts.business.latestSavedJob.number} · first seen ${when(parts.business.latestSavedJob.savedAt)}`
                      : "No saved job"}</strong></div>
                <div><span>Newest job at Commusoft</span>
                  <strong>{commusoftFreshnessSummary(freshness.data)}</strong>
                  {freshness.data?.providerCheckedAt &&
                    <small>Checked {when(freshness.data.providerCheckedAt)} UK time</small>}
                </div>
              </div>
              <p className="lr-daily-footnote">The Commusoft comparison checks newest job creation in a bounded provider read. It does not prove that every older job or revision is saved.</p>
            </>
      )}
    </section>
  );
}
