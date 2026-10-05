// Interactive OpenFolk admin only. Tokens never appear in responses or logs.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  notificationEvents,
  OPENFOLK_TEAM,
  safeSlackChannel,
  slackRequest,
  verifySlackBot,
  verifySlackChannel,
  sendSlackMessage,
} from "../_shared/notification-slack.ts";
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { headers, status });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  try {
    const authorization = req.headers.get("authorization");
    if (!authorization) return reply({ error: "Sign in to OpenFolk." }, 401);
    const userDb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const { data: auth, error: authError } = await userDb.auth.getUser();
    if (authError || !auth.user) return reply({ error: "Sign in to OpenFolk." }, 401);
    const { data: allowed, error: permissionError } = await userDb.rpc(
      "current_user_is_openfolk_operator",
      { required_permission: "platform.controlplane.admin" },
    );
    if (
      permissionError ||
      allowed !== true ||
      auth.user.email?.toLowerCase() !== "chris@openfolk.ai"
    )
      return reply({ error: "OpenFolk administrator access required." }, 403);
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const actor = await db.rpc("notification_require_actor", { p_actor: auth.user.id });
    if (actor.error)
      return reply({ error: "Leave client preview before managing notifications." }, 403);
    const raw = await req.text();
    if (raw.length > 6000) return reply({ error: "Request too large." }, 400);
    const body = JSON.parse(raw);
    if (
      !body ||
      typeof body.tenantId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.tenantId)
    )
      return reply({ error: "Choose a client." }, 400);
    const tenant = await db
      .from("tenants")
      .select("id,display_name,slug")
      .eq("id", body.tenantId)
      .maybeSingle();
    if (tenant.error || !tenant.data) return reply({ error: "Client unavailable." }, 404);
    if (body.action === "status") {
      const [connection, routes, deliveries, workspace] = await Promise.all([
        db
          .from("operator_slack_connection")
          .select("team_id,team_name,bot_id,connected_at")
          .eq("id", true)
          .maybeSingle(),
        db
          .from("operator_notification_routes")
          .select("event_key,channel_id,channel_name,version,updated_at,test_ts")
          .eq("tenant_id", body.tenantId),
        db
          .from("client_notification_outbox")
          .select(
            "id,source_type,source_id,source_version,priority,state,created_at,sent_at,available_at,slack_phase,slack_channel,slack_ts,notification_route,attempts",
          )
          .eq("tenant_id", body.tenantId)
          .order("created_at", { ascending: false })
          .limit(30),
        db
          .from("receptionist_workspaces")
          .select("slack_secret_name")
          .eq("tenant_id", body.tenantId)
          .maybeSingle(),
      ]);
      if (connection.error || routes.error || deliveries.error || workspace.error)
        return reply({ error: "Notification settings could not be loaded." }, 503);
      return reply({
        connection: connection.data,
        routes: routes.data,
        deliveries: deliveries.data,
        legacyConfigured: Boolean(
          workspace.data?.slack_secret_name && Deno.env.get(workspace.data.slack_secret_name),
        ),
        events: notificationEvents,
      });
    }
    if (body.action === "connect") {
      if (typeof body.botToken !== "string")
        return reply({ error: "Enter a Slack bot token securely here—not in chat." }, 400);
      const connection = await verifySlackBot(body.botToken);
      const saved = await db.rpc("notification_connect_slack", {
        p_actor: auth.user.id,
        p_team: connection.team_id,
        p_name: connection.team_name,
        p_bot: connection.bot_id,
        p_token: body.botToken,
      });
      if (saved.error)
        return reply(
          { error: "The verified connection could not be stored. Existing routes are unchanged." },
          503,
        );
      return reply({ connected: true });
    }
    const secret = await db.rpc("notification_slack_token");
    if (secret.error || typeof secret.data !== "string")
      return reply({ error: "Connect the OpenFolk Slack bot first." }, 409);
    const token = secret.data;
    if (body.action === "channels") {
      await verifySlackBot(token);
      if (
        body.cursor !== undefined &&
        (typeof body.cursor !== "string" || body.cursor.length > 2000)
      )
        return reply({ error: "Invalid channel page." }, 400);
      const page = await slackRequest(token, "conversations.list", {
        types: "public_channel,private_channel",
        exclude_archived: true,
        limit: 200,
        cursor: body.cursor ?? "",
      });
      return reply({
        channels: (page.channels ?? [])
          .filter(safeSlackChannel)
          .map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })),
        nextCursor: page.response_metadata?.next_cursor || null,
      });
    }
    if (body.action === "save_route") {
      const event = notificationEvents.find((e) => e.key === body.eventKey);
      if (
        !event ||
        !Number.isSafeInteger(body.version) ||
        body.version < 0 ||
        typeof body.channelId !== "string"
      )
        return reply({ error: "Choose a notification and channel." }, 400);
      // Check stale edits before sending a test; RPC checks again atomically after Slack confirms.
      const current = await db
        .from("operator_notification_routes")
        .select("version")
        .eq("tenant_id", body.tenantId)
        .eq("event_key", event.key)
        .maybeSingle();
      if (current.error) return reply({ error: "Current route could not be checked." }, 503);
      if ((current.data?.version ?? 0) !== body.version)
        return reply({ error: "This route changed. Reload settings before saving." }, 409);
      const channel = await verifySlackChannel(token, body.channelId);
      const receipt = await sendSlackMessage(
        token,
        channel.id,
        `OpenFolk notification test\nClient: ${String(tenant.data.display_name ?? tenant.data.slug).replace(/[<>&]/g, "")}\n${event.label}\nNo customer content. This destination will be used only after the app confirms the setting was saved.`,
        crypto.randomUUID(),
      );
      const saved = await db.rpc("notification_save_route", {
        p_actor: auth.user.id,
        p_tenant: body.tenantId,
        p_event: event.key,
        p_version: body.version,
        p_team: OPENFOLK_TEAM,
        p_channel: channel.id,
        p_name: channel.name,
        p_test_ts: receipt.ts,
      });
      if (saved.error)
        return reply(
          {
            error:
              "Slack received the test, but the route was not saved. Reload settings before retrying.",
          },
          409,
        );
      return reply({ version: saved.data, channel, receipt });
    }
    return reply({ error: "Unsupported action." }, 400);
  } catch {
    // Provider exceptions may contain sensitive details. Do not echo them.
    return reply(
      {
        error:
          "Slack setup could not be confirmed. Check the OpenFolk bot permissions and channel membership, then reload settings. Existing routes have not been changed by this error.",
      },
      502,
    );
  }
});
