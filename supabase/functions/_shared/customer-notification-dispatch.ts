import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { customerChannel, customerNotificationText } from "./customer-slack.ts";
import { sendSlackMessage, SlackRejected } from "./notification-slack.ts";
export async function dispatchCustomerNotifications(db: SupabaseClient) {
  const claimed = await db.rpc("customer_notifications_claim");
  if (claimed.error) return { processed: 0, error: "Client notification queue unavailable" };
  let sent = 0;
  for (const job of claimed.data ?? []) {
    let posting = false;
    try {
      const [c, r] = await Promise.all([
        db
          .from("customer_slack_connections")
          .select("team_id,generation,enabled")
          .eq("tenant_id", job.tenant_id)
          .single(),
        db
          .from("customer_notification_routes")
          .select("channel_id,enabled")
          .eq("tenant_id", job.tenant_id)
          .eq("event_key", job.event_key)
          .single(),
      ]);
      if (c.error || r.error) throw Error("Settings unavailable");
      if (
        !c.data.enabled ||
        !r.data.enabled ||
        c.data.generation !== job.generation ||
        r.data.channel_id !== job.channel_id
      ) {
        await db
          .from("customer_notification_outbox")
          .update({ state: "cancelled" })
          .eq("id", job.id);
        continue;
      }
      const key = await db.rpc("customer_slack_token", {
        p_tenant: job.tenant_id,
        p_generation: job.generation,
      });
      if (key.error || typeof key.data !== "string") throw Error("Connection unavailable");
      await customerChannel(key.data, c.data.team_id, job.channel_id);
      posting = true;
      const receipt = await sendSlackMessage(
        key.data,
        job.channel_id,
        customerNotificationText(job),
        job.id,
      );
      const saved = await db
        .from("customer_notification_outbox")
        .update({ state: "sent", sent_at: new Date().toISOString(), slack_ts: receipt.ts })
        .eq("id", job.id);
      if (saved.error) throw Error("Receipt unavailable");
      sent++;
    } catch (e) {
      await db
        .from("customer_notification_outbox")
        .update({
          state: posting && !(e instanceof SlackRejected) ? "uncertain" : "failed",
          available_at: new Date(
            Date.now() + Math.min(3600, 60 * 2 ** job.attempts) * 1000,
          ).toISOString(),
        })
        .eq("id", job.id);
    }
  }
  return { processed: claimed.data?.length ?? 0, sent };
}
