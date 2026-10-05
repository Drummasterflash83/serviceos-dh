import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { customerBot, customerChannel, customerEvents } from "../_shared/customer-slack.ts";
import { safeSlackChannel, slackRequest, sendSlackMessage } from "../_shared/notification-slack.ts";
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { headers, status });
const uuid = (x: unknown): x is string =>
  typeof x === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(x);
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  try {
    const auth = req.headers.get("authorization");
    if (!auth) return reply({ error: "Sign in to your workspace." }, 401);
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const user = await db.auth.getUser(auth.replace(/^Bearer /, ""));
    if (user.error || !user.data.user) return reply({ error: "Sign in to your workspace." }, 401);
    const raw = await req.text();
    if (raw.length > 6000) return reply({ error: "Request too large." }, 400);
    const b = JSON.parse(raw);
    if (!uuid(b.tenantId)) return reply({ error: "Choose your workspace." }, 400);
    const actor = user.data.user.id;
    const allowed = await db.rpc("customer_notification_actor", {
      p_tenant: b.tenantId,
      p_actor: actor,
    });
    if (allowed.error || allowed.data !== true)
      return reply(
        {
          error:
            "Workspace membership is required. Leave client preview before changing notifications.",
        },
        403,
      );
    const c = await db
      .from("customer_slack_connections")
      .select("generation,team_id,team_name,enabled,connected_at")
      .eq("tenant_id", b.tenantId)
      .maybeSingle();
    if (c.error) throw Error("Unavailable");
    if (b.action === "status") {
      const [routes, deliveries] = await Promise.all([
        db
          .from("customer_notification_routes")
          .select("event_key,channel_id,channel_name,enabled,version,updated_at")
          .eq("tenant_id", b.tenantId),
        db
          .from("customer_notification_outbox")
          .select("id,event_key,client_stage,state,channel_name,created_at,sent_at,attempts")
          .eq("tenant_id", b.tenantId)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      if (routes.error || deliveries.error) throw Error("Unavailable");
      return reply({
        connection: c.data,
        routes: routes.data,
        deliveries: deliveries.data,
        events: customerEvents,
      });
    }
    if ((c.data?.generation ?? null) !== (b.generation ?? null))
      return reply({ error: "Settings changed. Reload before continuing." }, 409);
    if (b.action === "connect") {
      if (typeof b.botToken !== "string")
        return reply({ error: "Enter your bot token securely in this form." }, 400);
      const identity = await customerBot(b.botToken);
      const saved = await db.rpc("customer_slack_connect", {
        p_tenant: b.tenantId,
        p_actor: actor,
        p_expected: b.generation ?? null,
        p_team: identity.team_id,
        p_name: identity.team_name,
        p_bot: identity.bot_id,
        p_token: b.botToken,
      });
      if (saved.error)
        return reply(
          {
            error:
              "Connection was not saved. The workspace may already belong to another client, or these settings changed. Reload and check your Slack workspace.",
          },
          409,
        );
      return reply({ connected: true });
    }
    if (!c.data?.enabled) return reply({ error: "Connect your company’s Slack bot first." }, 409);
    if (b.action === "disconnect") {
      const r = await db.rpc("customer_slack_disconnect", {
        p_tenant: b.tenantId,
        p_actor: actor,
        p_generation: c.data.generation,
      });
      if (r.error) throw Error("Changed");
      return reply({ disconnected: true });
    }
    const key = await db.rpc("customer_slack_token", {
      p_tenant: b.tenantId,
      p_generation: c.data.generation,
    });
    if (key.error || typeof key.data !== "string") throw Error("Connection unavailable");
    const token = key.data;
    if (b.action === "channels") {
      await customerBot(token, c.data.team_id);
      if (b.cursor !== undefined && (typeof b.cursor !== "string" || b.cursor.length > 2000))
        return reply({ error: "Invalid channel page." }, 400);
      const page = await slackRequest(token, "conversations.list", {
        types: "public_channel,private_channel",
        exclude_archived: true,
        limit: 200,
        cursor: b.cursor ?? "",
      });
      return reply({
        channels: (page.channels ?? [])
          .filter(safeSlackChannel)
          .map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })),
        nextCursor: page.response_metadata?.next_cursor || null,
      });
    }
    if (b.action === "save_route" || b.action === "pause_route") {
      const event = customerEvents.find((x) => x.key === b.eventKey);
      if (!event || !Number.isInteger(b.version) || b.version < 0)
        return reply({ error: "Choose a notification." }, 400);
      const current = await db
        .from("customer_notification_routes")
        .select("*")
        .eq("tenant_id", b.tenantId)
        .eq("event_key", event.key)
        .maybeSingle();
      if (current.error || (current.data?.version ?? 0) !== b.version)
        return reply({ error: "Settings changed. Reload before saving." }, 409);
      const enabled = b.action === "save_route";
      if (!enabled && !current.data) return reply({ error: "No active route." }, 409);
      const channel = enabled
        ? await customerChannel(token, c.data.team_id, b.channelId)
        : { id: current.data.channel_id, name: current.data.channel_name };
      const receipt = enabled
        ? await sendSlackMessage(
            token,
            channel.id,
            `OpenFolk · Emma notification test\n${event.label}\nThis channel will receive brief client progress updates and a private workspace link once saving is confirmed. No call recordings or internal analysis are shared.`,
            crypto.randomUUID(),
          )
        : { ts: current.data.test_ts };
      const saved = await db.rpc("customer_notification_route_save", {
        p_tenant: b.tenantId,
        p_actor: actor,
        p_generation: c.data.generation,
        p_event: event.key,
        p_version: b.version,
        p_channel: channel.id,
        p_name: channel.name,
        p_test: receipt.ts,
        p_enabled: enabled,
      });
      if (saved.error)
        return reply(
          {
            error: "Settings were not saved. A test may have arrived; reload before trying again.",
          },
          409,
        );
      return reply({ saved: true });
    }
    return reply({ error: "Unsupported action." }, 400);
  } catch {
    return reply(
      {
        error:
          "Slack could not be confirmed. Check your company’s bot permissions and invite it to an internal channel. If a test may have arrived, check Slack before retrying.",
      },
      502,
    );
  }
});
