import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  object,
  list,
  UUID,
  configurationChecks,
  assertSafeScenario,
  itemReport,
  safeRecording,
  recordingCallMatches,
  runState,
} from "../_shared/receptionist-testing.ts";
import { evidenceHash } from "../_shared/receptionist-care.ts";
import { prepareLaunchCandidate } from "../_shared/receptionist-launch-candidate.ts";
import {
  launchWordingModel,
  launchDialogueModel,
  launchClosingModel,
  launchConsolidatedModel,
} from "../_shared/receptionist-launch-wording.ts";
import { prepareLaunchSuite } from "../_shared/receptionist-launch-scenarios.ts";
import { startPhysicalTest, inspectPhysicalTest } from "../_shared/receptionist-physical-run.ts";
import { launchConsistencyPatch } from "../_shared/receptionist-launch-consistency.ts";
import { invokeFunction } from "../_shared/phone_pipeline.ts";
import { DH_APPROVED_REVIEW_POLICY } from "../_shared/receptionist-launch-review-policy.ts";
import { clearLaunchModel } from "../_shared/receptionist-launch-clear-contract.ts";
import { launchPromotion } from "../_shared/receptionist-launch-promotion.ts";
import { inspectLaunchGraph } from "../_shared/receptionist-launch-inspection.ts";
import { PHYSICAL_EVIDENCE_IDS, physicalEvidence } from "../_shared/receptionist-physical-evidence.ts";
import { captureTestHarness, compareTestHarness, inspectTestPersonality } from "../_shared/receptionist-test-harness.ts";
import { getSimwoodCredentials, basicAuthHeader } from "../_shared/simwood.ts";
import { timingSafeEqualStr } from "../_shared/marketing_tracking.ts";
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
  let harnessSnapshot: Awaited<ReturnType<typeof captureTestHarness>> | null = null;
  const db = dbClient();
  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const raw = await req.text();
    if (raw.length > 5000) return reply({ error: "Request too large" }, 400);
    const body = object(JSON.parse(raw));
    if (!UUID.test(body.tenantId ?? "")) return reply({ error: "Choose a client" }, 400);
    // The collector has one capability only: refresh an existing saved run.
    // Its actor comes from the database, never the request body. The operator
    // must still be authorised; no scheduler path can start or configure tests.
    const workerSecret = Deno.env.get("WORKER_SECRET");
    const scheduled =
      body.action === "refresh" &&
      !!workerSecret &&
      timingSafeEqualStr(workerSecret, req.headers.get("x-schedule-secret") ?? "");
    if (scheduled) {
      if (!UUID.test(body.runId ?? "")) return reply({ error: "Saved run required" }, 400);
      const saved = await db
        .from("receptionist_test_runs")
        .select("actor_id")
        .eq("id", body.runId)
        .eq("tenant_id", body.tenantId)
        .single();
      if (saved.error) return reply({ error: "Saved run unavailable" }, 404);
      body.actorId = saved.data.actor_id;
    }
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
    const service = scheduled || (serviceCheck !== null && !serviceCheck.error);
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
    // One pre-authorised, audited recovery sample. No arbitrary function, tenant
    // or recording can be supplied; concurrent/repeated requests never resubmit.
    if (body.action === "retry_pcm_sample" && service && !scheduled) {
      if (body.tenantId !== "00000000-0000-0000-0000-000000000001")
        return reply({ error: "Unapproved recovery tenant" }, 403);
      const recoveryIds = ["d6793aeb-382c-4c93-a971-ffddbe63d579", "6674a6d9-3f4f-4da1-9642-20d55280da83", "1c31d8b8-8914-4fa3-8adc-876c717de426", "d2d8ac9f-9314-4fc7-990e-1a8552220035", "3b39a52c-10f0-425b-85ae-9e3412d827a1", "6d9035bf-b658-4117-90d1-dcb29d14049b"];
      const recordingId = body.recordingId ?? recoveryIds[0];
      if (!recoveryIds.includes(recordingId)) return reply({ error: "Unapproved recovery sample" }, 403);
      const auditId = recordingId === recoveryIds[0] ? "03a1ca11-7ba1-4869-a83d-16c9075a6431" : recordingId;
      const sample = await db.from("phone_recordings").select("storage_path").eq("id", recordingId).eq("tenant_id", body.tenantId).single();
      if (sample.error || sample.data?.storage_path !== `${body.tenantId}/simwood/recordings/pcm/${recordingId}.wav`)
        return reply({ error: "Verified private PCM derivative required" }, 409);
      const reserved = await db.from("phone_operations_audit").insert({
        id: auditId, tenant_id: body.tenantId, actor_user_id: actor,
        actor_label: "OpenFolk launch maintenance", action: "pcm_recovery_requested",
        resource_type: "phone_recording", resource_ref: recordingId,
        reason: "Retry one verified private PCM derivative using existing processing pipeline; original retained; no force or new recipients.",
      });
      if (reserved.error) return reply({ error: "Recovery already reserved; inspect its saved outcome before any retry" }, 409);
      const result = await invokeFunction("phone-process-pipeline", {
        tenant_id: body.tenantId, recording_id: recordingId, force: false,
      }, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const safe = { http: result.status, success: result.json?.success === true,
        code: object(result.json?.error).code ?? null, stage: result.json?.stage ?? null };
      await db.from("phone_operations_audit").update({
        action: safe.success ? "pcm_recovery_completed" : "pcm_recovery_needs_review",
        after_state: safe,
      }).eq("id", auditId);
      return reply(safe);
    }
    // Read-only launch inspection. Fixed, verified DH account; never accept an
    // arbitrary provider URL or return SIP credentials / voicemail PINs.
    if (body.action === "provider_inventory" && service) {
      if (body.tenantId !== "00000000-0000-0000-0000-000000000001")
        return reply({ error: "Provider binding not verified" }, 403);
      const credentials = getSimwoodCredentials();
      if (!credentials) return reply({ error: "Provider credentials unavailable" }, 503);
      const base = "https://pbx.sipcentric.com/api/v1/customers/3950";
      const read = async (url: string) => {
        if (!url.startsWith(base + "/")) throw Error("Provider path outside verified account");
        const r = await fetch(url, {
          redirect: "error",
          signal: AbortSignal.timeout(15000),
          headers: { Authorization: basicAuthHeader(credentials), Accept: "application/json" },
        });
        return { status: r.status, data: r.ok ? await r.json() : null };
      };
      const result = await read(base + "/endpoints?pageSize=100");
      const endpoints = list(result.data?.items).map((e) => ({
        uri: e.uri,
        type: e.type,
        extension: e.shortNumber,
        name: e.name,
        voicemailEnabled: e.voicemailEnabled,
        links: e.links,
      }));
      const details = [];
      for (const id of [9304, 180997]) {
        const endpoint = await read(base + "/endpoints/" + id);
        // The documented endpoint voicemail subresource may not be advertised
        // in the account's links. Probe that one documented path only.
        const link = object(endpoint.data?.links).voicemail ?? `${base}/endpoints/${id}/voicemail`;
        const vm = typeof link === "string" ? await read(link.replace(/^http:/, "https:")) : null;
        details.push({
          id,
          endpointStatus: endpoint.status,
          links: endpoint.data?.links,
          voicemailStatus: vm?.status,
          voicemailFields: Object.keys(object(vm?.data)),
          voicemailLinks: object(vm?.data).links,
        });
      }
      return reply({ status: result.status, endpoints, details });
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
    if (body.action === "inspect_launch_graph") {
      if (!service || scheduled)
        return reply({ error: "Explicit OpenFolk service inspection required." }, 403);
      try {
        return reply(await inspectLaunchGraph(db, api, settings.data, workspace.data, actor));
      } catch {
        // Never return raw provider errors: these may contain request details.
        return reply({ error: "Launch graph inspection unavailable. Check the authorised operator, fixed DH bindings and provider availability.",
          readOnly: true, providerChanged: false, savedBaselineChanged: false, callsPlaced: false }, 409);
      }
    }
    if (body.action === "promote_launch_candidate") {
      if (!service || scheduled)
        return reply({ error: "Explicit OpenFolk service maintenance required for launch publication." }, 403);
      try {
        const result = await launchPromotion(db, api, settings.data, workspace.data, actor, body.expectedHash);
        return reply(result, result.state === "applied" ? 200 : 409);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        // Provider PATCH may succeed before its response/audit fails. Never
        // route this branch into the generic 'no live assistant changed' text.
        // Only our fixed, secret-free guard messages can reach the operator.
        return reply({
          error: /^(Launch |Latest launch |Every launch |Live Emma |Private launch |OpenFolk launch )/.test(message)
            ? message
            : "Launch publication needs review. Inspect the saved publication state before another action.",
          providerState: "review_required",
          automaticRetrySent: false,
        }, 409);
      }
    }
    const assistant = await api("assistant/" + settings.data.assistant_id);
    if (body.action === "inspect_suite" && service && !scheduled) {
      const suite = await api("eval/simulation/suite/" + settings.data.suite_id);
      const simulation = await api("eval/simulation/" + suite.simulationIds[0]);
      const personality = await api("eval/simulation/personality/" + simulation.personalityId);
      return reply({ suiteId: suite.id, personality: inspectTestPersonality(personality) });
    }
    if (body.action === "enable_auto_review" && service && !scheduled) {
      if (body.tenantId !== "00000000-0000-0000-0000-000000000001" || workspace.data.assistant_id !== "4eb2bee8-ac25-47c9-b962-409ed250ceb6")
        return reply({ error: "Unapproved automatic-review workspace" }, 403);
      const live = await api("assistant/" + workspace.data.assistant_id);
      const snapshotHash = await evidenceHash(live);
      const existing = await db.from("receptionist_review_settings").select("enabled,version").eq("tenant_id", body.tenantId).maybeSingle();
      if (existing.error) throw Error("Review settings unavailable");
      if (existing.data?.enabled) return reply({ enabled: true, alreadyEnabled: true });
      const rules = `${DH_APPROVED_REVIEW_POLICY}\nProduction configuration fingerprint at activation: ${snapshotHash}. Historical call-time configuration may differ. Use the approved policy above to assess defects, not assume the deployed configuration is correct.`;
      const audit = await db.from("phone_operations_audit").insert({ tenant_id: body.tenantId, actor_user_id: actor, actor_label: "OpenFolk launch maintenance", action: "automatic_review_enable_requested", resource_type: "receptionist_review_settings", resource_ref: body.tenantId, after_state: { productionAssistantId: live.id, configurationHash: snapshotHash, automaticProviderChanges: false, maxPaidAttemptsPerDay: 100, maxReviewsPerRun: 2 }, reason: "User requested continuous call/feedback review. Uses existing approved OpenFolk AI processor and verified alert routes, no autonomous provider edits." }).select("id").single();
      if (audit.error) throw Error("Review activation audit unavailable");
      const enabled = await db.from("receptionist_review_settings").upsert({ tenant_id: body.tenantId, enabled: true, approved_rules: rules, version: (existing.data?.version ?? 0) + 1, updated_by: actor, updated_at: new Date().toISOString() });
      if (enabled.error) throw Error("Review activation needs reconciliation");
      await db.from("phone_operations_audit").update({ action: "automatic_review_enabled" }).eq("id", audit.data.id);
      return reply({ enabled: true, automaticProviderChanges: false, maxReviewsPerRun: 2, maxPaidAttemptsPerDay: 100 });
    }
    if (body.action === "run_auto_review" && service && !scheduled) {
      if (body.tenantId !== "00000000-0000-0000-0000-000000000001") return reply({ error: "Unapproved review workspace" }, 403);
      const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/receptionist-review-collector`, { method: "POST", headers: { "content-type": "application/json", "x-schedule-secret": Deno.env.get("WORKER_SECRET")! }, body: "{}", signal: AbortSignal.timeout(120000) });
      return reply(await response.json(), response.status);
    }
    if (["physical_start", "physical_inspect"].includes(body.action) && service && !scheduled) {
      if (body.tenantId !== "00000000-0000-0000-0000-000000000001") return reply({ error: "Unapproved physical test tenant" }, 403);
      return reply(body.action === "physical_start"
        ? await startPhysicalTest(db, api, body.tenantId, actor, assistant, body.destination)
        : await inspectPhysicalTest(db, api, body.tenantId, body.destination));
    }
    if (body.action === "phone_sources" && service && !scheduled) {
      const numbers = await api("phone-number");
      return reply({ numbers: list(numbers).filter((n) => n.assistantId === workspace.data.assistant_id).map((n) => ({ id: n.id, number: n.number, provider: n.provider, assistantId: n.assistantId })) });
    }
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
    if (
      [
        "repair_candidate_wording",
        "repair_candidate_dialogue",
        "repair_candidate_closing",
        "consolidate_candidate",
        "candidate_consistency",
        "streamline_candidate",
      ].includes(body.action) &&
      service &&
      !scheduled
    ) {
      if (body.tenantId !== "00000000-0000-0000-0000-000000000001" || body.expectedHash !== hash)
        return reply({ error: "Candidate changed; inspect before updating" }, 409);
      const consistency = body.action === "candidate_consistency" ? launchConsistencyPatch(assistant) : null;
      const model = consistency?.model ?? (
        body.action === "streamline_candidate" ? clearLaunchModel(assistant) : body.action === "consolidate_candidate"
          ? launchConsolidatedModel(assistant)
          : body.action === "repair_candidate_closing"
          ? launchClosingModel(assistant)
          : body.action === "repair_candidate_dialogue"
            ? launchDialogueModel(assistant)
            : launchWordingModel(assistant, tools));
      const audit = await db
        .from("phone_operations_audit")
        .insert({
          tenant_id: body.tenantId,
          actor_user_id: actor,
          actor_label: "OpenFolk launch maintenance",
          action: "candidate_wording_repair_requested",
          resource_type: "vapi_test_candidate",
          resource_ref: assistant.id,
          before_state: { model: assistant.model, firstMessage: assistant.firstMessage },
          after_state: { model, firstMessage: consistency?.firstMessage ?? assistant.firstMessage },
          reason:
            body.action === "streamline_candidate"
              ? "Replace accumulated conflicting historical prompt patches with one ordered approved contract and computed office status; preserve voice, tools, all destinations and live assistant."
              : body.action === "candidate_consistency"
              ? "Remove conflicting legacy handoff/lookup/safety-repeat rules; apply verified approved England/Wales holiday closure calendar. Candidate only, no telephone or voice changes."
              : body.action === "consolidate_candidate"
              ? "Consolidate duplicate handover instructions; evidence-led availability and consent. Preserve safety, routes, voice, shared tools and live assistant."
              : body.action === "repair_candidate_closing"
              ? "One sales handover sentence and concise post-simulation closing. No route, safety or live assistant changes."
              : body.action === "repair_candidate_dialogue"
                ? "Prevent repeated ordinary tool invocation; answer holiday follow-ups without repeating closed status. Live assistant and routes unchanged."
                : "Single announcement source; factual staff availability and Mary overflow. Live assistant and shared tools unchanged.",
        })
        .select("id")
        .single();
      if (audit.error) throw Error("Cannot save repair audit; no provider change sent");
      // A provider 5xx can follow an applied PATCH. Reconcile by GET, never
      // blindly repeat a mutation or leave an applied version labelled failed.
      let patchError: unknown = null;
      try { await api("assistant/" + assistant.id, "PATCH", consistency ?? { model }); }
      catch (error) { patchError = error; }
      const verified = await api("assistant/" + assistant.id);
      const matches =
        (!consistency || verified.firstMessage === consistency.firstMessage) &&
        JSON.stringify(verified.model.messages) === JSON.stringify(model.messages) &&
        JSON.stringify(verified.model.toolIds) === JSON.stringify(model.toolIds) &&
        verified.model.tools?.length === 1 &&
        verified.model.tools[0].destinations?.every((d: any) => d.message === "");
      const saved = await db
        .from("phone_operations_audit")
        .update({
          action: matches
            ? "candidate_wording_repair_verified"
            : "candidate_wording_repair_needs_review",
        })
        .eq("id", audit.data.id);
      if (saved.error || !matches)
        throw Error(`Candidate read-back requires review; no retry sent${patchError ? "; provider response was uncertain" : ""}`);
      return reply({
        state: "verified",
        assistantId: assistant.id,
        liveAssistantChanged: false,
        sharedToolsChanged: false,
      });
    }
    if (body.action === "prepare_suite" && service) {
      if (body.expectedHash !== hash) return reply({ error: "Emma changed. Reload first." }, 409);
      if (assistant.id !== "dcfc2e66-a438-43ab-b863-467f5a5089df")
        return reply({ error: "Testing candidate required" }, 409);
      return reply(await prepareLaunchSuite(db, api, settings.data, tools, actor, assistant));
    }
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
      // Only reviewed, fixed physical test records may reach this operator view.
      // Never expose whole audit rows or infer delivery from a spoken message.
      const physical = await db.from("phone_operations_audit")
        .select("id,tenant_id,resource_type,action,after_state")
        .eq("tenant_id", body.tenantId)
        .in("id", PHYSICAL_EVIDENCE_IDS);
      if (physical.error) throw Error("Testing physical evidence unavailable.");
      const allowance = await db.from("receptionist_test_launch_allowances")
        .select("starts_at,ends_at,max_runs,used_run_ids,assistant_id")
        .eq("tenant_id", body.tenantId).maybeSingle();
      const grant = allowance.error ? null : allowance.data;
      const now = Date.now();
      const activeAllowance = grant && grant.assistant_id === settings.data.assistant_id &&
        now >= Date.parse(grant.starts_at) && now < Date.parse(grant.ends_at);
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
        physicalChecks: physicalEvidence(physical.data ?? [], body.tenantId),
        budget: { normalRunsPerRolling24Hours: 8, launchAllowance: activeAllowance ? {
          maximumExtraRuns: grant.max_runs,
          remainingExtraRuns: Math.max(0, grant.max_runs - list(grant.used_run_ids).length),
          expiresAt: grant.ends_at,
          serviceOnly: true,
        } : null },
      });
    }
    if (body.action === "run") {
      if (body.useLaunchAllowance === true && (!service || scheduled))
        return reply({ error: "The bounded launch allowance is available only to explicit OpenFolk service maintenance." }, 403);
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
      const harness = await captureTestHarness(api, settings.data.suite_id, {
        suite, onScenario: (scenario) => assertSafeScenario(scenario, tools, assistant),
      });
      harnessSnapshot = harness;
      const reserved = await db.rpc(body.useLaunchAllowance === true ? "receptionist_test_reserve_launch" : "receptionist_test_reserve", {
        p_tenant: body.tenantId,
        p_actor: actor,
        p_hash: hash,
      });
      if (reserved.error)
        throw Error(body.useLaunchAllowance === true
          ? "Another test is active, the two-minute cooldown applies, or the dated two-run launch allowance is unavailable. No provider run was sent."
          : "Another test is active, or the test usage safeguard was reached.");
      reservation = reserved.data;
      // Persist preflight evidence BEFORE submitting a paid provider run.
      // Historical runs are never retroactively assigned this snapshot.
      const evidenceSaved = await db.from("receptionist_test_runs")
        .update({ report: { harness, checks } }).eq("id", reservation);
      if (evidenceSaved.error) throw Error("Testing setup evidence could not be saved; no provider run sent.");
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
            harness,
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
    // Simulation metadata does not always include audio. Fetch only calls linked
    // by this saved provider run, and verify their assistant before attaching it.
    const items = await Promise.all(
        rawItems.map(async (raw: unknown) => {
          let item = itemReport(raw);
          let verifiedRunItem = false;
          // Vapi's list response can omit the signed recording while the
          // individual run-item response (used by its dashboard) includes it.
          if (run.status === "ended" && !item.recordingUrl && UUID.test(item.id ?? "")) {
            try {
              const detail = await api(
                "eval/simulation/run/" + row.data.provider_id + "/item/" + item.id,
              );
              if (detail.id === item.id && detail.runId === row.data.provider_id) {
                item = itemReport(detail);
                verifiedRunItem = true;
              }
            } catch {
              /* Retain list evidence; an unavailable recording is never a pass. */
            }
          }
          if (run.status === "ended" && !item.recordingUrl && UUID.test(item.callId ?? "")) {
            try {
              const call = await api("call/" + item.callId);
              // A simulation's call can use a transient tester assistant. It
              // must be linked by the verified run item AND belong to the same
              // provider organisation; never accept a call ID from the browser.
              if (
                recordingCallMatches(run, call, item.callId, row.data.assistant_id, verifiedRunItem)
              ) {
                const recording = await fetch(
                  "https://api.vapi.ai/call/" + item.callId + "/stereo-recording",
                  {
                    redirect: "manual",
                    signal: AbortSignal.timeout(15000),
                    headers: { Authorization: `Bearer ${key}` },
                  },
                );
                // Never forward the Vapi credential to the storage origin.
                if (recording.status === 302)
                  item.recordingUrl = safeRecording(recording.headers.get("location"));
              }
            } catch {
              /* Missing audio never becomes a pass or blocks other evidence. */
            }
          }
          return item;
        }),
      ),
      simulationState = runState(run, items);
    let currentHarness = null;
    if (row.data.report?.harness) {
      try { currentHarness = await captureTestHarness(api, row.data.suite_id); }
      catch { /* Missing provider setup is not evidence that it stayed unchanged. */ }
    }
    const harnessCheck = compareTestHarness(row.data.report?.harness, currentHarness, row.data.report?.harnessCheck);
    const state = simulationState === "passed" && row.data.report?.harness && harnessCheck.state !== "unchanged"
      ? "failed" : simulationState;
    const report = {
      items,
      simulationState,
      harness: row.data.report?.harness ?? null,
      harnessCheck,
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
          report: { harness: harnessSnapshot, error: "Test start needs review; no automatic retry sent." },
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
