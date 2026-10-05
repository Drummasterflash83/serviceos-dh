import { useQuery } from "@tanstack/react-query";
import { getSupabaseClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import type { OperatorHealth } from "@/lib/operator-workspace";

export function useOperatorHealth(tenantId: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["operator-module-health", user?.id, tenantId],
    enabled: !!user && !!tenantId,
    refetchInterval: 60000,
    refetchOnWindowFocus: true,
    queryFn: () => loadOperatorHealth(tenantId),
  });
}

export async function loadOperatorHealth(tenantId: string): Promise<OperatorHealth> {
  const db = getSupabaseClient();
  const overdue = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const results = await Promise.all([
    db
      .from("receptionist_workspaces")
      .select("name,launch_stage")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    db
      .from("client_programmes")
      .select("tenant_id", { head: true, count: "exact" })
      .eq("tenant_id", tenantId),
    db
      .from("receptionist_feedback")
      .select("id", { head: true, count: "exact" })
      .eq("tenant_id", tenantId)
      .neq("status", "Resolved"),
    db
      .from("receptionist_feedback")
      .select("id", { head: true, count: "exact" })
      .eq("tenant_id", tenantId)
      .neq("status", "Resolved")
      .eq("priority", "urgent"),
    db
      .from("client_notification_outbox")
      .select("id", { head: true, count: "exact" })
      .eq("tenant_id", tenantId)
      .eq("state", "failed"),
    db
      .from("client_notification_outbox")
      .select("id", { head: true, count: "exact" })
      .eq("tenant_id", tenantId)
      .in("state", ["queued", "sending"])
      .lt("available_at", overdue),
  ]);
  if (results.some((result) => result.error))
    throw Error("Health data could not be checked. Please retry.");
  const [workspace, programme, open, urgent, failed, delayed] = results;
  if ([programme, open, urgent, failed, delayed].some((result) => result.count === null))
    throw Error("Health counts were not returned.");
  return {
    receptionist: workspace.data,
    programme: programme.count! > 0,
    open: open.count!,
    urgent: urgent.count!,
    failed: failed.count!,
    overdue: delayed.count!,
    checkedAt: new Date().toISOString(),
  };
}
