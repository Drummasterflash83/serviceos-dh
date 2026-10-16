import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { slackEventEndpoint } from "../_shared/slack/slack_event_http.ts";
import {
  bindingFromCurrentRoster,
  recordScopedSlackHint,
  type SlackEventConfig,
  type SlackEventRecord,
  type SlackEventRosterRow,
} from "../_shared/slack/slack_event_adapter.ts";

// This receiver is intentionally inactive until the service-only ledger, exact
// approved roster digest, signing secret and event reconciliation are verified.
// Missing configuration returns 503; it never falls back to a broader roster.
const config: SlackEventConfig = {
  tenantId: Deno.env.get("LEARN_SLACK_EVENTS_TENANT_ID") ?? "",
  teamId: Deno.env.get("LEARN_SLACK_EVENTS_TEAM_ID") ?? "",
  appId: Deno.env.get("LEARN_SLACK_EVENTS_APP_ID") ?? "",
  signingSecret: Deno.env.get("LEARN_SLACK_EVENTS_SIGNING_SECRET") ?? "",
  minTs: Deno.env.get("LEARN_SLACK_EVENTS_MIN_TS") ?? "",
  expectedChannels: Number(Deno.env.get("LEARN_SLACK_EVENTS_EXPECTED_CHANNELS")),
  rosterSha256: Deno.env.get("LEARN_SLACK_EVENTS_ROSTER_SHA256") ?? "",
};
const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const active = Deno.env.get("LEARN_SLACK_EVENTS_ACTIVE") === "true";
const admin = url && key ? createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
}) : null;

Deno.serve(slackEventEndpoint({
  loadBinding: async () => {
    if (!active || !admin) return null;
    return bindingFromCurrentRoster(config, async () => {
      const { data, error } = await admin.from("slack_recurring_channels")
        .select("channel_id,team_id,next_start")
        .eq("tenant_id", config.tenantId)
        .eq("team_id", config.teamId)
        .eq("enabled", true)
        .limit(201);
      if (error || !Array.isArray(data)) throw Error("slack_event_roster_unavailable");
      return data as SlackEventRosterRow[];
    });
  },
  recordHint: async (hint) => {
    if (!active || !admin) throw Error("slack_event_record_unavailable");
    return recordScopedSlackHint(config, hint, async (args) => {
      const { data, error } = await admin.rpc("learn_slack_event_record", args);
      if (error) throw Error("slack_event_record_unconfirmed");
      return data as SlackEventRecord;
    });
  },
}));
