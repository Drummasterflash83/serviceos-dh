import { getSupabaseClient } from "./supabase";
export interface NotificationRoute {
  event_key: string;
  channel_id: string;
  channel_name: string;
  version: number;
  updated_at: string;
  test_ts: string;
}
export interface NotificationDelivery {
  id: string;
  source_type: string;
  source_id: string;
  priority: string;
  state: string;
  created_at: string;
  sent_at: string | null;
  available_at: string;
  slack_phase: string | null;
  slack_channel: string | null;
  slack_ts: string | null;
  notification_route: { mode: string; channel_name?: string; event?: string } | null;
  attempts: number;
}
export interface NotificationStatus {
  connection: { team_id: string; team_name: string; bot_id: string; connected_at: string } | null;
  routes: NotificationRoute[];
  deliveries: NotificationDelivery[];
  legacyConfigured: boolean;
  events: { key: string; label: string; module: string; detail: string }[];
}
export interface SlackChannelPage {
  channels: { id: string; name: string }[];
  nextCursor: string | null;
}
export async function notificationRequest<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabaseClient().functions.invoke("operator-notifications", {
    body,
  });
  if (error) {
    let message = "Notifications could not be checked. Please try again.";
    if (error.context instanceof Response) {
      try {
        const result = await error.context.json();
        if (typeof result.error === "string") message = result.error;
      } catch {
        /* No response body. */
      }
    }
    throw Error(message);
  }
  return data as T;
}
export function notificationDeliveryLabel(d: NotificationDelivery) {
  if (
    d.slack_phase === "uncertain" ||
    (d.slack_phase === "posting" && Date.parse(d.available_at) < Date.now())
  )
    return "Check delivery — retry held";
  if (d.state === "sent") return "Delivered";
  if (d.attempts >= 10) return "Needs attention";
  if (d.state === "failed") return "Retry scheduled";
  return d.state === "sending" ? "Sending" : "Queued";
}
