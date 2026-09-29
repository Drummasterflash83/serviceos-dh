import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./auth";
import { getSupabaseClient } from "./supabase";
import type { EmmaHealthCardId } from "./emma-health";

export type HealthIssue = {
  id: string;
  feedback_id: string | null;
  call_id: string | null;
  title: string;
  categories: (EmmaHealthCardId | "general")[];
  priority: string;
  status: "Submitted" | "In review";
  message: string;
  created_at: string;
};
export type HealthSnapshot = {
  checked_at: string;
  issues: HealthIssue[];
  reviewed_calls: number;
  reviews_awaiting_evidence: number;
  reviews_failed: number;
  last_call_review: string | null;
  feedback_reviewed: number;
  resolved_reports: number;
};
export function useEmmaHealth(tenant?: string, enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["receptionist-health", user?.id, tenant],
    enabled: !!user && !!tenant && enabled,
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().rpc("care_health_snapshot", {
        p_tenant: tenant!,
      });
      if (error) throw Error("Open issues could not be refreshed. This is not an all-clear.");
      return data as HealthSnapshot;
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
