/** Current-company scheduler summary through the restricted read RPC. */
import { getSupabaseClient, isSupabaseConfigured } from "./supabase";
import { readSchedulerHealth, type SchedulerHealthItem } from "./scheduler-health-reader";
import type { ApiResult } from "./types";
export type { SchedulerHealthItem } from "./scheduler-health-reader";
export type { SchedulerStatus } from "./scheduler-outcome";
export async function getSchedulerHealth(
  tenantId: string,
): Promise<ApiResult<SchedulerHealthItem[]>> {
  if (!isSupabaseConfigured())
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  return readSchedulerHealth(getSupabaseClient(), tenantId);
}
