import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  object,
  list,
  UUID,
  configurationChecks,
  assertSafeScenario,
  itemReport,
  runState,
} from "../_shared/receptionist-testing.ts";
import { evidenceHash } from "../_shared/receptionist-care.ts";
import { prepareLaunchCandidate } from "../_shared/receptionist-launch-candidate.ts";
import {
  verifySlackBot,
  verifySlackChannel,
  sendSlackMessage,
} from "../_shared/notification-slack.ts";
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });
const dbClient = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  let reservation: string | null = null,
    submitted = false;
  const db = dbClient();
  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const raw = await req.text();
    if (raw.length > 5000) return reply({ error: "Request too large" }, 400);
    const body = object(JSON.parse(raw));
    if (!UUID.test(body.tenantId ?? "")) return reply({ error: "Choose a client" }, 400);
    // Service-role maintenance is permitted only with the same explicitly authorised
    // operator identity; never accept a client-supplied actor with a normal JWT.
    // PostgREST validates the signed service JWT. This RPC is executable only by
    // service_role, and checks the named operator. Never trust a decoded JWT role.
    const requestDb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
    );
    const serviceCheck = UUID.test(body.actorId ?? "")
      ? await requestDb.rpc("notification_require_actor", { p_actor: body.actorId })
      : null;
    const service = serviceCheck !== null && !serviceCheck.error;
    let actor: string;
    if (service) {
      if (!UUID.test(body.actorId ?? "")) return reply({ error: "Operator required" }, 403);
      actor = body.actorId;
      const check = await db.rpc("notification_require_actor", { p_actor: actor });
      if (check.error) return reply({ error: "Operator required" }, 403);
    } else {
      const userDb = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
      );
      const auth = await userDb.auth.getUser();
      if (auth.error || !auth.data.user) return reply({ error: "Sign in to OpenFolk" }, 401);
      const gate = await userDb.rpc("care_desk_operator");
      if (
        gate.error ||
        gate.data !== true ||
        auth.data.user.email?.toLowerCase() !== "chris@openfolk.ai"
      )
        return reply(
          { error: "OpenFolk administrator required. Leave client preview first." },
          403,
        );
      actor = auth.data.user.id;
    }
    const settings = await db
      .from("receptionist_test_settings")
      .select("*")
      .eq("tenant_id", body.tenantId)
      .maybeSingle();
    const workspace = await db
      .from("receptionist_workspaces")
      .select("assistant_id,vapi_secret_name")
      .eq("tenant_id", body.tenantId)
      .maybeSingle();
    if (settings.error || workspace.error || !settings.data || !workspace.data)
      return reply({ error: "Testing is awaiting setup for this client." }, 404);
    const key = Deno.env.get(workspace.data.vapi_secret_name);
    if (!key) return reply({ error: "Vapi connection unavailable" }, 503);
    const api = async (path: string, method = "GET", payload?: unknown) => {
      const r = await fetch("https://api.vapi.ai/" + path, {
        method,
        redirect: "error",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        signal: AbortSignal.timeout(25000),
      });
      if (!r.ok) {
        if (r.status === 400 && service) {
          const detail = await r.json().catch(() => ({}));
          if (body.action === "prepare_candidate")
            await db
              .from("receptionist_test_candidates")
              .update({ state: "rejected" })
              .eq("tenant_id", body.tenantId);
          throw Error(
            `Vapi request rejected (400): ${JSON.stringify(detail.message ?? detail.error ?? "Invalid configuration").slice(0, 1200)}`,
          );
        }
        throw Error(`Vapi request failed (${r.status}). No automatic retry was sent.`);
      }
      return r.status === 204 ? {} : await r.json();
    };
    const assistant = await api("assistant/" + settings.data.assistant_id);
    const toolIds = list(object(assistant.model).toolIds);
    if (toolIds.length > 20 || toolIds.some((x) => !UUID.test(x)))
      throw Error("Assistant tool configuration requires review.");
    const tools = [
      ...(await Promise.all(toolIds.map((id) => api("tool/" + id)))),
      ...list(object(assistant.model).tools),
    ];
    const hash = await evidenceHash({ assistant, tools });
    const main = body.tenantId === "00000000-0000-0000-0000-000000000001" ? "+441794341600" : null;
    const checks = configurationChecks(assistant, tools, main);
    if (body.action === "prepare_candidate" && service) {
      if (body.expectedHash !== hash)
        return reply({ error: "Emma changed. Reload the checks before running." }, 409);
      return reply(
        await prepareLaunchCandidate(db, api, assistant, tools, hash, actor, body.tenantId),
      );
    }
    if (body.action === "inspect" && service) {
      return reply({
        assistant: {
          id: assistant.id,
          name: assistant.name,
          firstMessage: assistant.firstMessage,
          maxDurationSeconds: assistant.maxDurationSeconds,
          model: {
            provider: assistant.model?.provider,
            model: assistant.model?.model,
            messages: assistant.model?.messages,
            toolIds: assistant.model?.toolIds,
          },
          voice: assistant.voice,
          transcriber: assistant.transcriber,
        },
        tools: tools.map((t) => ({
          id: t.id,
          type: t.type,
          function: t.function,
          destinations: t.destinations,
        })),
        hash,
      });
    }
    if (body.action === "status") {
      const history = await db
        .from("receptionist_test_runs")
        .select("id,provider_id,state,report,created_at,updated_at,assistant_hash,slack_state")
        .eq("tenant_id", body.tenantId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (history.error) throw Error("Test history unavailable.");
      const suite = await api("eval/simulation/suite/" + settings.data.suite_id);
      return reply({
        settings: {
          label: settings.data.label,
          suiteId: settings.data.suite_id,
          assistantId: settings.data.assistant_id,
          production: settings.data.assistant_id === workspace.data.assistant_id,
        },
        assistant: { name: assistant.name, updatedAt: assistant.updatedAt, hash },
        checks,
        suite: { name: suite.name, scenarioCount: list(suite.simulationIds).length },
        runs: history.data,
      });
    }
    if (body.action === "run") {
      if (body.expectedHash !== hash)
        return reply({ error: "Emma changed. Reload the checks before running." }, 409);
      if (checks.some((c) => ["transfer_count", "voice"].includes(c.key) && c.state === "failed"))
        return reply(
          { error: "Fix the failed configuration checks before starting a voice test." },
          409,
        );
      const suite = await api("eval/simulation/suite/" + settings.data.suite_id);
      const ids = list(suite.simulationIds);
      if (ids.length < 1 || ids.length > 12 || ids.some((id) => !UUID.test(id)))
        throw Error("Suite must have 1–12 reviewed scenarios.");
      if (suite.slackWebhookUrl)
        throw Error("Remove the suite webhook; OpenFolk manages notification destinations.");
      for (const id of ids) {
        const sim = await api("eval/simulation/" + id);
        if (!UUID.test(sim.scenarioId)) throw Error("Scenario unavailable");
        const scenario = await api("eval/simulation/scenario/" + sim.scenarioId);
        assertSafeScenario(scenario, tools);
      }
      const reserved = await db.rpc("receptionist_test_reserve", {
        p_tenant: body.tenantId,
        p_actor: actor,
        p_hash: hash,
      });
      if (reserved.error)
        throw Error("Another test is active, or the test usage safeguard was reached.");
      reservation = reserved.data;
      // The request is sent once. Ambiguous provider outcomes remain locked for reconciliation.
      submitted = true;
      const run = await api("eval/simulation/run", "POST", {
        simulations: [{ type: "simulationSuite", simulationSuiteId: settings.data.suite_id }],
        target: { type: "assistant", assistantId: settings.data.assistant_id },
        iterations: 1,
        transport: { provider: "vapi.websocket" },
      });
      if (!UUID.test(run.id ?? ""))
        throw Error(
          "Vapi did not return a run reference. Review provider history before retrying.",
        );
      const saved = await db
        .from("receptionist_test_runs")
        .update({
          provider_id: run.id,
          state: "running",
          report: {
            checks,
            limitations:
              "Synthetic voice test. All configured action tools are intercepted. Does not prove real phone, voicemail or email delivery.",
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", reservation);
      if (saved.error) throw Error("Provider run started but local save needs reconciliation.");
      return reply({ id: reservation, providerId: run.id, state: "running" });
    }
    if (!UUID.test(body.runId ?? "")) return reply({ error: "Choose a saved run" }, 400);
    const row = await db
      .from("receptionist_test_runs")
      .select("*")
      .eq("id", body.runId)
      .eq("tenant_id", body.tenantId)
      .single();
    if (row.error || !row.data?.provider_id)
      return reply({ error: "Provider run needs reconciliation; no retry sent." }, 409);
    if (body.action === "cancel") {
      await api("eval/simulation/run/" + row.data.provider_id, "PATCH");
      return reply({ message: "Cancellation requested. Refresh to confirm." });
    }
    if (body.action !== "refresh") return reply({ error: "Unknown action" }, 400);
    const run = await api("eval/simulation/run/" + row.data.provider_id);
    if (object(run.target).assistantId !== row.data.assistant_id)
      throw Error("Provider run does not match this saved test.");
    const result = await api("eval/simulation/run/" + row.data.provider_id + "/item?limit=100");
    const rawItems = Array.isArray(result)
      ? result
      : list(result.results ?? result.data ?? result.items);
    const items = rawItems.map(itemReport),
      state = runState(run, items);
    const report = {
      items,
      configurationChanged: row.data.assistant_hash !== hash,
      checks,
      limitations:
        "Synthetic voice results. Intercepted transfers do not prove physical phone or voicemail delivery. Recordings do not certify the caller’s network quality.",
    };
    const saved = await db
      .from("receptionist_test_runs")
      .update({ state, report, updated_at: new Date().toISOString() })
      .eq("id", row.data.id);
    if (saved.error) throw Error("Could not save test evidence.");
    if (state !== "running" && row.data.slack_state === "pending") {
      const claim = await db
        .from("receptionist_test_runs")
        .update({ slack_state: "sending" })
        .eq("id", row.data.id)
        .eq("slack_state", "pending")
        .select("id");
      if (claim.data?.length) {
        try {
          const route = await db
            .from("operator_notification_routes")
            .select("channel_id")
            .eq("tenant_id", body.tenantId)
            .eq("event_key", "practice_feedback")
            .maybeSingle();
          const token = await db.rpc("notification_slack_token");
          if (route.error || !route.data || token.error || !token.data)
            throw Error("Notifications unavailable");
          await verifySlackBot(token.data);
          const channel = await verifySlackChannel(token.data, route.data.channel_id);
          await sendSlackMessage(
            token.data,
            channel.id,
            `OpenFolk · Emma automated voice checks\nResult: ${state}\n${items.filter((i) => i.passed).length}/${items.length} scenarios passed. Synthetic tests; real telephone acceptance is separate.\nhttps://app.openfolk.ai/openfolk/drummonds?module=receptionist&view=testing&tools=false`,
            row.data.id,
          );
          await db
            .from("receptionist_test_runs")
            .update({ slack_state: "sent" })
            .eq("id", row.data.id);
        } catch {
          await db
            .from("receptionist_test_runs")
            .update({ slack_state: "needs_review" })
            .eq("id", row.data.id);
        }
      }
    }
    return reply({ state, report });
  } catch (e) {
    if (reservation)
      await db
        .from("receptionist_test_runs")
        .update({
          state: submitted ? "uncertain" : "failed",
          report: { error: "Test start needs review; no automatic retry sent." },
        })
        .eq("id", reservation);
    const msg = e instanceof Error ? e.message : "Testing unavailable";
    return reply(
      {
        error:
          /^(Vapi request|Emma changed|Fix |Another test|Every external|A scenario|Scenario webhook|Unsupported test|Suite must|Remove the suite|Provider run|Test start|Testing|Assistant tool|Could not save|Vapi did not)/.test(
            msg,
          )
            ? msg
            : "Testing could not complete. No live assistant was changed.",
      },
      503,
    );
  }
});
