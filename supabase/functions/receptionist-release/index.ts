import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  releaseCandidate,
  releaseHash,
  applyExactRelease,
  releaseDiagnosis,
} from "../_shared/receptionist-release.ts";
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { headers, status });
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  let claimed: string | null = null;
  try {
    const authorization = req.headers.get("authorization");
    if (!authorization) return reply({ error: "Sign in to OpenFolk." }, 401);
    const userDb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const auth = await userDb.auth.getUser(),
      allowed = await userDb.rpc("care_desk_operator");
    if (auth.error || !auth.data.user) return reply({ error: "Sign in to OpenFolk." }, 401);
    if (
      allowed.error ||
      allowed.data !== true ||
      auth.data.user.email?.toLowerCase() !== "chris@openfolk.ai"
    )
      return reply({ error: "OpenFolk administrator required. Leave client preview first." }, 403);
    const raw = await req.text();
    if (raw.length > 3000) return reply({ error: "Request too large." }, 400);
    const body = JSON.parse(raw);
    if (
      !uuid(body.tenantId) ||
      !uuid(body.issueId) ||
      !["prepare", "publish", "rollback", "reconcile"].includes(body.action)
    )
      return reply({ error: "Choose a saved task." }, 400);
    const workspace = await db
      .from("receptionist_workspaces")
      .select("assistant_id,vapi_secret_name")
      .eq("tenant_id", body.tenantId)
      .single();
    if (workspace.error) return reply({ error: "Workspace unavailable." }, 404);
    const key = Deno.env.get(workspace.data.vapi_secret_name);
    if (!key) throw Error("provider_unavailable");
    const endpoint = "https://api.vapi.ai/assistant/" + workspace.data.assistant_id;
    const transport = {
      get: async () => {
        const r = await fetch(endpoint, {
          headers: { Authorization: "Bearer " + key },
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) throw Error("provider_unavailable");
        const s = await r.json();
        if (s.id !== workspace.data.assistant_id || typeof s.updatedAt !== "string")
          throw Error("assistant_mismatch");
        return s as Record<string, unknown>;
      },
      patch: async (patch: { model: unknown }) => {
        const r = await fetch(endpoint, {
          method: "PATCH",
          headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
          body: JSON.stringify(patch),
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) throw Error("provider_write_unconfirmed");
      },
    };
    if (body.action === "prepare") {
      if (!Number.isInteger(body.version)) return reply({ error: "Reload the task." }, 400);
      const issue = await db
        .from("receptionist_care_issues")
        .select("proposal,version,stage")
        .eq("id", body.issueId)
        .eq("tenant_id", body.tenantId)
        .single();
      if (
        issue.error ||
        issue.data.version !== body.version ||
        !["approval", "approved"].includes(issue.data.stage)
      )
        return reply({ error: "Save the proposal before preparing a release." }, 409);
      const before = await transport.get(),
        { candidate, instruction } = releaseCandidate(before, issue.data.proposal, body.issueId);
      const r = await db.rpc("care_prepare_release", {
        p_tenant: body.tenantId,
        p_issue: body.issueId,
        p_actor: auth.data.user.id,
        p_version: body.version,
        p_assistant: workspace.data.assistant_id,
        p_source_version: before.updatedAt,
        p_source_hash: await releaseHash(before),
        p_candidate_hash: await releaseHash(candidate),
        p_instruction: instruction,
        p_before: before,
        p_candidate: candidate,
      });
      if (r.error)
        return reply({ error: "The proposal changed. Reload before preparing it again." }, 409);
      return reply({ id: r.data, instruction, sourceVersion: before.updatedAt, liveChanges: 0 });
    }
    if (!uuid(body.releaseId)) return reply({ error: "Prepare the exact change first." }, 400);
    const r = await db
      .from("receptionist_releases")
      .select("*")
      .eq("id", body.releaseId)
      .eq("tenant_id", body.tenantId)
      .eq("issue_id", body.issueId)
      .eq("actor_id", auth.data.user.id)
      .single();
    if (r.error || r.data.assistant_id !== workspace.data.assistant_id)
      return reply({ error: "Release unavailable." }, 404);
    const release = r.data;
    if (body.action === "reconcile") {
      if (!["publishing", "rolling_back", "uncertain"].includes(release.state))
        return reply({ state: release.state });
      if (!release.started_at || Date.now() - Date.parse(release.started_at) < 60000)
        return reply({ error: "The request may still be running. Check again in a minute." }, 409);
      const current = await transport.get();
      // Recompute from immutable snapshots so older receipts remain compatible when
      // provider-generated metadata is excluded from the semantic comparison.
      const snapshot = await db
        .from("receptionist_release_snapshots")
        .select("before_config,candidate_config")
        .eq("release_id", release.id)
        .single();
      if (snapshot.error) throw Error("snapshot_missing");
      const expected = await releaseHash(
        release.operation === "rollback"
          ? snapshot.data.before_config
          : snapshot.data.candidate_config,
      );
      if ((await releaseHash(current)) !== expected) {
        const diagnosis = await releaseDiagnosis(
          current,
          snapshot.data.before_config,
          snapshot.data.candidate_config,
          release.instruction,
        );
        return reply(
          {
            error:
              (diagnosis.unchanged
                ? "Vapi is still on the exact previous configuration; the approved change is not live. "
                : diagnosis.instructionPresent
                  ? "The approved instruction is present in Vapi, but other configuration differs. "
                  : "Vapi has changed, but the approved instruction could not be confirmed. ") +
              "Differences from the intended version: " +
              diagnosis.differingFields.join(", ") +
              ". No retry was sent.",
            diagnosis,
          },
          409,
        );
      }
      const done = await db.rpc("care_finish_release", {
        p_id: release.id,
        p_state: "applied",
        p_provider_version: current.updatedAt,
      });
      if (done.error) throw Error("save_unconfirmed");
      return reply({ state: release.operation === "rollback" ? "rolled_back" : "applied" });
    }
    if (
      (body.confirm !== "PUBLISH_TO_VAPI" && body.action === "publish") ||
      (body.confirm !== "RESTORE_PREVIOUS_VERSION" && body.action === "rollback")
    )
      return reply({ error: "Explicit confirmation of this exact change is required." }, 400);
    if (
      (body.action === "publish" && release.state === "applied") ||
      (body.action === "rollback" && release.state === "rolled_back")
    )
      return reply({ state: release.state });
    const snapshot = await db
      .from("receptionist_release_snapshots")
      .select("before_config,candidate_config")
      .eq("release_id", release.id)
      .single();
    if (snapshot.error) throw Error("snapshot_missing");
    const target =
      body.action === "rollback" ? snapshot.data.before_config : snapshot.data.candidate_config;
    const expected = await releaseHash(
      body.action === "rollback" ? snapshot.data.candidate_config : snapshot.data.before_config,
    );
    const reserved = await db.rpc("care_claim_release", {
      p_id: release.id,
      p_actor: auth.data.user.id,
      p_operation: body.action,
    });
    if (reserved.error)
      return reply(
        {
          error:
            "This release expired, changed, or another update needs checking. Reload the task; do not resend blindly.",
        },
        409,
      );
    claimed = release.id;
    const result = await applyExactRelease(transport, expected, target);
    const done = await db.rpc("care_finish_release", {
      p_id: release.id,
      p_state: result.state,
      p_provider_version: result.state === "applied" ? result.providerVersion : null,
    });
    if (done.error) throw Error("save_unconfirmed");
    claimed = null;
    return reply(
      {
        state:
          result.state === "applied" && body.action === "rollback" ? "rolled_back" : result.state,
      },
      result.state === "applied" ? 200 : 409,
    );
  } catch {
    if (claimed)
      await db.rpc("care_finish_release", {
        p_id: claimed,
        p_state: "uncertain",
        p_provider_version: null,
      });
    return reply(
      {
        error: claimed
          ? "The Vapi result is unconfirmed. Use Check Vapi result; do not publish again."
          : "The release could not be prepared or checked. No new publish request was sent.",
      },
      502,
    );
  }
});
