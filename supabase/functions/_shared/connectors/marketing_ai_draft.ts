// Marketing AI draft adapter — the ONE registered connector for the governed
// `ai.generate_marketing_draft` capability (intent type
// `generate_marketing_draft`). It performs exactly ONE provider call and its
// only write is one governed RPC that records the IMMUTABLE proposal. It can
// never transmit anything to a recipient, approve, launch, or touch campaign
// state: the capability's whole external surface is a bounded, paid model
// request whose output must pass the exact schema gate AND the canonical
// Marketing content validator before a proposal exists at all.
//
// Discipline (same contract as every adapter, conformance-enforced):
//  - executes ONLY the claimed immutable envelope (exact allowlist; the
//    prompt is built deterministically from the FROZEN brief — editing
//    anything after the request can never change what is asked);
//  - re-checks the REQUESTING ACTOR'S CURRENT AUTHORITY
//    (marketing.campaigns.draft via the canonical resolver) before the
//    provider call — a removed/moved/denied actor blocks permanently;
//  - resolves the provider credential SERVER-SIDE through the tenant Vault
//    broker (provider_secret_read) — NEVER a global environment key, never
//    the payload, and no key material ever appears in a result;
//  - fail-closed reads: a database/resolver error is a SAFE RETRYABLE
//    pre-provider failure, never conflated with a genuine refusal;
//  - classification: 429 → transient; network/timeout/5xx BEFORE the
//    provider answered → transient (nothing external mutated, so bounded
//    retry is safe); 401/403 → permanent configuration failures; a provider
//    REFUSAL is preserved honestly as a permanent result;
//    malformed/unsupported output is a permanent `model_output_rejected`,
//    never partially accepted;
//  - AFTER a successful provider call the paid side effect is DONE: a
//    recorder/persistence failure is retried in-place against the
//    idempotent recorder RPC only, and if persistence still cannot be
//    confirmed the result is `unknown` — the engine freezes automatic
//    retry (external_result_unknown) instead of re-running the paid call.
//    One logical generation request can never buy two provider calls just
//    because the database blinked; only an explicit human "generate again"
//    (a NEW request + intent) reaches the provider again.

import type {
  AutomationConnectorAdapter,
  ConnectorExecutionContext,
  ConnectorExecutionInput,
  ValidationResult,
} from "./index.ts";
import type { ConnectorExecutionResult } from "../intelligence/automation_guards.ts";
import { evaluateActorAuthority } from "../marketing_email.ts";
import {
  buildMarketingDraftPrompt,
  parseModelDraftOutput,
  validateGenerationEnvelope,
} from "../marketing_ai_prompt.ts";
import { OPENAI_CHAT_URL } from "../openai.ts";

const CAPABILITY = "ai.generate_marketing_draft";
const PROVIDER = "openai";
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_COMPLETION_TOKENS = 2048;

function permanent(code: string, message: string): ConnectorExecutionResult {
  return {
    outcome: "failed_permanent",
    errorCode: code,
    errorMessage: message.slice(0, 200),
    retryable: false,
  };
}
function transient(code: string, message: string): ConnectorExecutionResult {
  return {
    outcome: "failed_transient",
    errorCode: code,
    errorMessage: message.slice(0, 200),
    retryable: true,
  };
}

export const marketingAiDraftAdapter: AutomationConnectorAdapter = {
  connectorType: "openai",
  supportedIntentTypes: ["generate_marketing_draft"],
  adapterVersion: "1",

  validate(input: ConnectorExecutionInput): ValidationResult {
    if (!input.parameters || typeof input.parameters !== "object") {
      return { ok: false, errorCode: "payload_invalid", errorMessage: "parameters missing" };
    }
    if (input.capabilityKey !== CAPABILITY) {
      return {
        ok: false,
        errorCode: "payload_invalid",
        errorMessage: `capability must be ${CAPABILITY}`,
      };
    }
    const v = validateGenerationEnvelope(input.parameters);
    if (!v.ok) return { ok: false, errorCode: "payload_invalid", errorMessage: v.error };
    return { ok: true };
  },

  async execute(
    input: ConnectorExecutionInput,
    context: ConnectorExecutionContext,
  ): Promise<ConnectorExecutionResult> {
    const db = context.supabaseAdmin;
    const parsed = validateGenerationEnvelope(input.parameters);
    if (!parsed.ok) return permanent("payload_invalid", parsed.error);
    const env = parsed.envelope;

    // marketing must still be enabled for the tenant
    const settingsRes = await db
      .from("marketing_settings")
      .select("marketing_enabled")
      .eq("tenant_id", input.tenantId)
      .maybeSingle();
    if (settingsRes.error) {
      return transient("settings_read_failed", "could not read marketing settings");
    }
    if (settingsRes.data && settingsRes.data.marketing_enabled === false) {
      return permanent("marketing_disabled", "marketing is disabled for this tenant");
    }

    // ACTOR AUTHORITY recheck — canonical resolver, current facts
    const actorRes = await db
      .from("profiles")
      .select("id, tenant_id")
      .eq("id", env.actor_profile_id)
      .maybeSingle();
    if (actorRes.error) {
      return transient("actor_read_failed", "could not read the requesting actor");
    }
    const verdictRes = await db.rpc("marketing_effective_permissions", {
      p_profile_id: env.actor_profile_id,
    });
    if (verdictRes.error || verdictRes.data == null || typeof verdictRes.data !== "object") {
      return transient(
        "authority_resolver_unavailable",
        "could not resolve the actor's current authority",
      );
    }
    const authority = evaluateActorAuthority(
      {
        tenantId: input.tenantId,
        actor: (actorRes.data ?? null) as { id: string; tenant_id: string | null } | null,
        resolverVerdict: verdictRes.data as { enabled?: unknown; permissions?: unknown },
      },
      "marketing.campaigns.draft",
    );
    if (!authority.ok) return permanent(authority.code, authority.message);

    // provider configuration — the canonical state derivation, fail-closed
    const stateRes = await db.rpc("marketing_ai_provider_state", {
      p_tenant: input.tenantId,
    });
    if (stateRes.error || stateRes.data == null || typeof stateRes.data !== "object") {
      return transient("provider_state_unavailable", "could not derive provider configuration");
    }
    const state = stateRes.data as { configured?: unknown; model?: unknown };
    if (state.configured !== true) {
      return permanent(
        "configuration_required",
        "AI drafting is not configured for this tenant (provider, model or credential missing)",
      );
    }
    const model = typeof state.model === "string" ? state.model : "";
    if (model.length === 0) {
      return permanent("configuration_required", "no model is configured for this tenant");
    }

    // credential — tenant Vault broker only; a missing secret is a
    // configuration refusal, a failed read is retryable
    const secretRes = await db.rpc("provider_secret_read", {
      p_tenant: input.tenantId,
      p_provider: PROVIDER,
      p_field: "api_key",
    });
    if (secretRes.error) {
      return transient("credential_read_failed", "could not read the provider credential");
    }
    const apiKey = typeof secretRes.data === "string" ? secretRes.data : "";
    if (apiKey.length === 0) {
      return permanent(
        "configuration_required",
        "no provider credential is stored for this tenant",
      );
    }

    // ── the ONE provider call, deterministic prompt from the FROZEN brief ──
    const prompt = buildMarketingDraftPrompt(env);
    let response: Response;
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = context.signal ? AbortSignal.any([context.signal, timeout]) : timeout;
    try {
      response = await fetch(OPENAI_CHAT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ],
          response_format: { type: "json_object" },
          temperature: 0,
          max_tokens: MAX_COMPLETION_TOKENS,
        }),
        signal,
      });
    } catch {
      // a lost/timed-out generation call has no recipient-facing effect —
      // bounded retry is safe and cost stays capped by max_attempts
      return transient("provider_network_error", "the provider request failed or timed out");
    }

    if (!response.ok) {
      const status = response.status;
      const bodyText = await response.text().catch(() => "");
      if (status === 401 || status === 403) {
        return permanent(
          "provider_auth_failed",
          `the provider rejected the stored credential (HTTP ${status})`,
        );
      }
      if (status === 429) {
        return transient("provider_rate_limited", "the provider rate-limited the request");
      }
      if (status >= 500) {
        return transient("provider_unavailable", `the provider returned HTTP ${status}`);
      }
      return permanent(
        "provider_rejected",
        `the provider rejected the request (HTTP ${status}): ${bodyText.slice(0, 120)}`,
      );
    }

    let payload: Record<string, unknown>;
    try {
      payload = (await response.json()) as Record<string, unknown>;
    } catch {
      return permanent("model_output_malformed", "the provider response was not JSON");
    }
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const first = (choices[0] ?? null) as Record<string, unknown> | null;
    const message = (first?.message ?? null) as Record<string, unknown> | null;
    const refusal = typeof message?.refusal === "string" ? message.refusal : null;
    if (refusal && refusal.length > 0) {
      // the provider's safety refusal is a FACT — preserved honestly, never
      // retried into compliance and never rewritten
      return permanent("provider_refused", `the model declined: ${refusal.slice(0, 150)}`);
    }
    const content = typeof message?.content === "string" ? message.content : "";
    const finishReason = typeof first?.finish_reason === "string" ? first.finish_reason : null;
    if (finishReason === "length") {
      return permanent(
        "model_output_truncated",
        "the model output was truncated — a partial draft is never accepted",
      );
    }
    const draft = parseModelDraftOutput(content);
    if (!draft.ok) return permanent("model_output_rejected", draft.message);

    const usage = (payload.usage ?? null) as Record<string, unknown> | null;
    const respModel = typeof payload.model === "string" ? payload.model : model;

    // ── the ONLY write: the governed proposal recorder (idempotent per
    // intent; it runs the CANONICAL content validator — invalid content
    // raises and no proposal ever exists). The paid provider call is now a
    // FACT, so a persistence failure retries the recorder RPC alone (one
    // immediate retry — the finaliser precedent; a lost-response commit
    // converges idempotently), and if it still cannot be confirmed the
    // outcome is UNKNOWN: the engine freezes automatic retry rather than
    // re-running the paid side effect. ──
    const recorderPayload = {
      p_tenant: input.tenantId,
      p_intent: input.intentId,
      p_payload: {
        provider: PROVIDER,
        model: respModel,
        subject: draft.draft.subject,
        preview_text: draft.draft.preview_text,
        body_authored: draft.draft.body_authored,
        token_fallbacks: draft.draft.token_fallbacks,
        prompt_tokens: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : null,
        completion_tokens:
          typeof usage?.completion_tokens === "number" ? usage.completion_tokens : null,
        finish_reason: finishReason,
      },
    };
    let recordRes = await db.rpc("marketing_ai_record_proposal", recorderPayload);
    if (recordRes.error && (recordRes.error as { code?: string }).code !== "22023") {
      recordRes = await db.rpc("marketing_ai_record_proposal", recorderPayload);
    }
    if (recordRes.error) {
      const code = (recordRes.error as { code?: string }).code ?? "";
      if (code === "22023") {
        // the canonical validator refused the content — a stable permanent
        // outcome; the user can regenerate as a NEW proposal
        return permanent(
          "model_output_rejected",
          `the canonical content validator refused the draft: ${recordRes.error.message ?? ""}`,
        );
      }
      // the provider call SUCCEEDED but persistence could not be confirmed.
      // Never a transient: an engine retry would re-run the whole paid call.
      // UNKNOWN parks the intent (external_result_unknown) for review; if the
      // recorder actually committed and only its response was lost, the
      // derived request status already reads succeeded from the proposal fact.
      return {
        outcome: "unknown",
        errorCode: "proposal_record_failed",
        errorMessage:
          "the provider call succeeded but the proposal could not be confirmed as recorded — frozen for review, never re-billed automatically",
        retryable: false,
      };
    }
    const recorded = (recordRes.data ?? {}) as { proposal_id?: string };

    return {
      outcome: "succeeded",
      externalReference: recorded.proposal_id ?? null,
      retryable: false,
      evidenceRefs: recorded.proposal_id ? [recorded.proposal_id] : [],
      result: {
        proposal_id: recorded.proposal_id ?? null,
        provider: PROVIDER,
        model: respModel,
        prompt_tokens: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : null,
        completion_tokens:
          typeof usage?.completion_tokens === "number" ? usage.completion_tokens : null,
      },
    };
  },
};
