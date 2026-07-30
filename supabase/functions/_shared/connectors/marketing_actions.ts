// Marketing internal-actions adapter — the governed executor for the four
// contact actions and the follow-up work item a Sequence step can perform.
//
// INTERNAL means internal: this adapter makes NO network call, touches NO
// provider, and has no external side effect. Everything it does is a canonical
// tenant-data change the platform already knows how to make:
//
//   marketing_apply_tag        → marketing_tag_mutate(assign)   [Phase-2 RPC]
//   marketing_remove_tag       → marketing_tag_mutate(remove)   [Phase-2 RPC]
//   marketing_change_lifecycle → marketing_classify_contact     [Phase-2 RPC]
//   marketing_assign_owner     → marketing_classify_contact     [Phase-2 RPC]
//   marketing_create_follow_up → marketing_sequence_create_follow_up, which
//                                creates the canonical work item on the
//                                platform spine the Command Centre projects,
//                                plus its append-only state-history seed, in
//                                ONE transaction
//
// It NEVER writes a table directly — the frozen adapter contract forbids it
// and conformance G6 enforces it. Every change goes through a governed RPC:
// existing guarded mutation path is the authority, so tenant validation,
// evidence, canonical events and audit rows all keep happening exactly once,
// in one place. The adapter's own job is only: validate the frozen envelope,
// re-check the target still belongs to this tenant, call the canonical path,
// and return a sanitized universal result.
//
// Authority: the intent carries `authorised_by` — the owner/admin who approved
// the immutable sequence revision containing this step. requires_approval is
// FALSE for these intent types and NO automation_approvals row is created or
// fabricated; the approval that authorises them is the sequence approval, and
// it is recorded on the revision and named in the Decision Package.

import type {
  AutomationConnectorAdapter,
  ConnectorExecutionContext,
  ConnectorExecutionInput,
  ValidationResult,
} from "./index.ts";
import type { ConnectorExecutionResult } from "../intelligence/automation_guards.ts";

const CAPABILITY = "marketing.contact_action";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SUPPORTED = [
  "marketing_apply_tag",
  "marketing_remove_tag",
  "marketing_change_lifecycle",
  "marketing_assign_owner",
  "marketing_create_follow_up",
] as const;
type SupportedIntent = (typeof SUPPORTED)[number];

/** The ONE declared shape of a frozen contact-action envelope. Nothing else. */
export const CONTACT_ACTION_ENVELOPE_KEYS: readonly string[] = [
  "tenant_id",
  "person_id",
  "campaign_id",
  "sequence_revision_id",
  "sequence_enrolment_id",
  "sequence_execution_id",
  "sequence_step_id",
  "step_order",
  "action_type",
  "config",
  "authorised_by",
  "request_id",
];

export interface ContactActionEnvelope {
  tenant_id: string;
  person_id: string;
  campaign_id: string;
  sequence_revision_id: string;
  sequence_enrolment_id: string;
  sequence_execution_id: string;
  sequence_step_id: string;
  step_order: number;
  action_type: string;
  config: Record<string, unknown>;
  authorised_by: string;
  request_id: string;
}

export function validateContactActionEnvelope(
  p: Record<string, unknown>,
): { ok: true; envelope: ContactActionEnvelope } | { ok: false; error: string } {
  const bad = (error: string) => ({ ok: false as const, error });
  for (const k of Object.keys(p)) {
    if (!CONTACT_ACTION_ENVELOPE_KEYS.includes(k)) return bad(`undeclared envelope field ${k}`);
  }
  for (const k of CONTACT_ACTION_ENVELOPE_KEYS) {
    if (!(k in p)) return bad(`missing envelope field ${k}`);
  }
  for (const k of [
    "tenant_id",
    "person_id",
    "campaign_id",
    "sequence_revision_id",
    "sequence_enrolment_id",
    "sequence_execution_id",
    "sequence_step_id",
    "authorised_by",
  ]) {
    const v = p[k];
    if (typeof v !== "string" || !UUID_RE.test(v)) return bad(`${k} must be a uuid`);
  }
  if (typeof p.step_order !== "number" || !Number.isInteger(p.step_order) || p.step_order < 1) {
    return bad("step_order must be a positive integer");
  }
  const action = p.action_type;
  if (
    typeof action !== "string" ||
    !["apply_tag", "remove_tag", "change_lifecycle", "assign_owner", "create_follow_up"].includes(
      action,
    )
  ) {
    return bad("action_type is not a supported contact action");
  }
  const cfg = p.config;
  if (typeof cfg !== "object" || cfg === null || Array.isArray(cfg)) {
    return bad("config must be an object");
  }
  const requestId = p.request_id;
  if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) {
    return bad("request_id invalid");
  }
  return {
    ok: true,
    envelope: {
      tenant_id: p.tenant_id as string,
      person_id: p.person_id as string,
      campaign_id: p.campaign_id as string,
      sequence_revision_id: p.sequence_revision_id as string,
      sequence_enrolment_id: p.sequence_enrolment_id as string,
      sequence_execution_id: p.sequence_execution_id as string,
      sequence_step_id: p.sequence_step_id as string,
      step_order: p.step_order as number,
      action_type: action,
      config: cfg as Record<string, unknown>,
      authorised_by: p.authorised_by as string,
      request_id: requestId,
    },
  };
}

/** The Person's CURRENT display relationship, using the SAME ordering the
 *  Marketing contacts projection uses (active first, then oldest). Lifecycle
 *  and owner steps must read this before mutating: the canonical
 *  marketing_classify_contact REFUSES to create a second classification when an
 *  active relationship exists, and REFUSES a no-op update — so a step that
 *  blindly "creates" fails on the common case, and a retry after a successful
 *  mutation would fail as a no-op. Reading first turns both into convergence. */
async function currentRelationship(
  db: ConnectorExecutionContext["supabaseAdmin"],
  tenantId: string,
  personId: string,
): Promise<
  | { ok: true; row: Record<string, unknown> | null }
  | { ok: false; result: ConnectorExecutionResult }
> {
  const res = await db
    .from("contact_relationships")
    .select("id, version, status, lifecycle_stage_key, owner_id, created_at")
    .eq("tenant_id", tenantId)
    .eq("person_id", personId)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1);
  if (res.error) {
    return {
      ok: false,
      result: transient("relationship_read_failed", "could not read the current relationship"),
    };
  }
  const rows = (res.data ?? []) as Record<string, unknown>[];
  return { ok: true, row: rows.length > 0 ? rows[0] : null };
}

function permanent(errorCode: string, message: string): ConnectorExecutionResult {
  return { outcome: "failed_permanent", errorCode, errorMessage: message, retryable: false };
}
function transient(errorCode: string, message: string): ConnectorExecutionResult {
  return { outcome: "failed_transient", errorCode, errorMessage: message, retryable: true };
}

export const marketingActionsAdapter: AutomationConnectorAdapter = {
  connectorType: "marketing-internal",
  supportedIntentTypes: [...SUPPORTED],
  adapterVersion: "1",

  validate(input: ConnectorExecutionInput): ValidationResult {
    if (!SUPPORTED.includes(input.intentType as SupportedIntent)) {
      return {
        ok: false,
        errorCode: "intent_type_unsupported",
        errorMessage: `unsupported intent type ${input.intentType}`,
      };
    }
    if (input.capabilityKey !== CAPABILITY) {
      return {
        ok: false,
        errorCode: "capability_mismatch",
        errorMessage: `capability must be ${CAPABILITY}`,
      };
    }
    const v = validateContactActionEnvelope(input.parameters);
    if (!v.ok) return { ok: false, errorCode: "payload_invalid", errorMessage: v.error };
    if (`marketing_${v.envelope.action_type}` !== input.intentType) {
      return {
        ok: false,
        errorCode: "payload_invalid",
        errorMessage: `intent type ${input.intentType} does not match action ${v.envelope.action_type}`,
      };
    }
    return { ok: true };
  },

  async execute(
    input: ConnectorExecutionInput,
    context: ConnectorExecutionContext,
  ): Promise<ConnectorExecutionResult> {
    const db = context.supabaseAdmin;
    const parsed = validateContactActionEnvelope(input.parameters);
    if (!parsed.ok) return permanent("payload_invalid", parsed.error);
    const env = parsed.envelope;

    // the envelope's tenant must be the executing tenant — a frozen parameter
    // is never trusted to widen scope
    if (env.tenant_id !== input.tenantId) {
      return permanent("cross_tenant_reference", "the envelope names a different tenant");
    }

    // RACE CLOSURE: the same canonical authority the worker used before the
    // intent existed. An exited enrolment or a cancelled campaign stops the
    // action here, before any tenant data changes.
    const authRes = await db.rpc("marketing_sequence_authority_core", {
      p_tenant: input.tenantId,
      p_enrolment: env.sequence_enrolment_id,
      p_execution: env.sequence_execution_id,
    });
    if (authRes.error || authRes.data == null) {
      return transient("authority_unavailable", "sequence authority could not be derived");
    }
    const verdict = authRes.data as { allowed?: unknown; code?: unknown };
    if (verdict.allowed !== true) {
      const code = String(verdict.code ?? "blocked");
      // email-only preconditions never block an INTERNAL action
      const emailOnly = [
        "not_subscribed",
        "endpoint_changed",
        "sender_disabled",
        "sender_not_ready",
        "capability_disabled",
      ];
      if (!emailOnly.includes(code)) {
        return permanent(`policy_${code}`, "sequence policy blocked this internal action");
      }
    }

    // the Person must still exist in THIS tenant
    const personRes = await db
      .from("people")
      .select("id, tenant_id, display_name")
      .eq("id", env.person_id)
      .maybeSingle();
    if (personRes.error) return transient("person_read_failed", "could not read the Person");
    if (!personRes.data || personRes.data.tenant_id !== input.tenantId) {
      return permanent("person_invalid", "the Person is not part of this tenant");
    }

    try {
      switch (env.action_type) {
        case "apply_tag":
        case "remove_tag": {
          const tagId = env.config.tag_id;
          if (typeof tagId !== "string" || !UUID_RE.test(tagId)) {
            return permanent("payload_invalid", "tag_id must be a uuid");
          }
          // a tag deactivated or deleted since approval is a TRUTHFUL refusal,
          // never a silent no-op
          const tagRes = await db
            .from("marketing_tags")
            .select("id, tenant_id, active")
            .eq("id", tagId)
            .maybeSingle();
          if (tagRes.error) return transient("tag_read_failed", "could not read the tag");
          if (!tagRes.data || tagRes.data.tenant_id !== input.tenantId) {
            return permanent("target_invalid", "the tag is not part of this tenant");
          }
          if (env.action_type === "apply_tag" && tagRes.data.active === false) {
            return permanent("target_inactive", "the tag was deactivated after approval");
          }
          const r = await db.rpc("marketing_tag_mutate", {
            p_tenant: input.tenantId,
            p_actor: env.authorised_by,
            p_op: env.action_type === "apply_tag" ? "assign" : "remove",
            p_args: { tag_id: tagId, person_id: env.person_id },
          });
          if (r.error) {
            return r.error.code === "P0002"
              ? permanent("target_invalid", "the tag or Person no longer resolves")
              : transient("tag_mutate_failed", "the governed tag mutation did not complete");
          }
          return {
            outcome: "succeeded",
            externalReference: `${env.action_type}:${tagId}`,
            result: { action: env.action_type, tag_id: tagId, applied: r.data ?? null },
          };
        }

        case "change_lifecycle": {
          const stageKey = env.config.stage_key;
          if (typeof stageKey !== "string" || stageKey.length > 60) {
            return permanent("payload_invalid", "stage_key invalid");
          }
          const stageRes = await db
            .from("marketing_lifecycle_stages")
            .select("stage_key, tenant_id, active")
            .eq("tenant_id", input.tenantId)
            .eq("stage_key", stageKey)
            .maybeSingle();
          if (stageRes.error) return transient("stage_read_failed", "could not read the stage");
          if (!stageRes.data) {
            return permanent("target_invalid", "the lifecycle stage no longer exists");
          }
          if (stageRes.data.active === false) {
            return permanent("target_inactive", "the lifecycle stage was retired after approval");
          }
          const cur = await currentRelationship(db, input.tenantId, env.person_id);
          if (!cur.ok) return cur.result;
          // ALREADY THERE — either a retry after a successful mutation, or a
          // human got there first. Either way the intended state holds, so this
          // converges instead of failing a step whose work is done.
          if (cur.row && cur.row.lifecycle_stage_key === stageKey) {
            return {
              outcome: "succeeded",
              externalReference: `lifecycle:${stageKey}`,
              result: { action: env.action_type, stage_key: stageKey, converged: true },
            };
          }
          const changes: Record<string, unknown> = cur.row
            ? {
                relationship_id: cur.row.id,
                expected_version: cur.row.version,
                lifecycle_stage: stageKey,
              }
            : { lifecycle_stage: stageKey, allow_new: true };
          const r = await db.rpc("marketing_classify_contact", {
            p_tenant: input.tenantId,
            p_person: env.person_id,
            p_actor: env.authorised_by,
            p_changes: changes,
          });
          if (r.error) {
            // MK409: the relationship changed under us. The approved step does
            // NOT authorise overwriting newer human work, so this is a policy
            // outcome for review, never a clobbering retry.
            if (r.error.code === "MK409") {
              return permanent(
                "policy_target_changed",
                "the relationship changed after this step was approved — not overwritten",
              );
            }
            return ["22023", "P0002"].includes(r.error.code ?? "")
              ? permanent(
                  "target_invalid",
                  "the lifecycle change was refused by the canonical path",
                )
              : transient("classify_failed", "the governed lifecycle change did not complete");
          }
          return {
            outcome: "succeeded",
            externalReference: `lifecycle:${stageKey}`,
            result: { action: env.action_type, stage_key: stageKey, converged: false },
          };
        }

        case "assign_owner": {
          const ownerId = env.config.owner_profile_id;
          if (typeof ownerId !== "string" || !UUID_RE.test(ownerId)) {
            return permanent("payload_invalid", "owner_profile_id must be a uuid");
          }
          const ownerRes = await db
            .from("profiles")
            .select("id, tenant_id, role")
            .eq("id", ownerId)
            .maybeSingle();
          if (ownerRes.error) return transient("owner_read_failed", "could not read the owner");
          if (!ownerRes.data || ownerRes.data.tenant_id !== input.tenantId) {
            return permanent("target_invalid", "the owner is not part of this tenant");
          }
          if (!["owner", "admin", "ops"].includes(String(ownerRes.data.role))) {
            return permanent(
              "target_invalid",
              "the owner is no longer an operational user of this tenant",
            );
          }
          const curOwner = await currentRelationship(db, input.tenantId, env.person_id);
          if (!curOwner.ok) return curOwner.result;
          // already the owner — a retry after success, or a human agreed first
          if (curOwner.row && curOwner.row.owner_id === ownerId) {
            return {
              outcome: "succeeded",
              externalReference: `owner:${ownerId}`,
              result: { action: env.action_type, owner_profile_id: ownerId, converged: true },
            };
          }
          const ownerChanges: Record<string, unknown> = curOwner.row
            ? {
                relationship_id: curOwner.row.id,
                expected_version: curOwner.row.version,
                owner_id: ownerId,
              }
            : { owner_id: ownerId, allow_new: true };
          const r = await db.rpc("marketing_classify_contact", {
            p_tenant: input.tenantId,
            p_person: env.person_id,
            p_actor: env.authorised_by,
            p_changes: ownerChanges,
          });
          if (r.error) {
            if (r.error.code === "MK409") {
              return permanent(
                "policy_target_changed",
                "the relationship changed after this step was approved — not overwritten",
              );
            }
            return ["22023", "P0002"].includes(r.error.code ?? "")
              ? permanent("target_invalid", "the owner change was refused by the canonical path")
              : transient("classify_failed", "the governed owner change did not complete");
          }
          return {
            outcome: "succeeded",
            externalReference: `owner:${ownerId}`,
            result: { action: env.action_type, owner_profile_id: ownerId, converged: false },
          };
        }

        case "create_follow_up": {
          const subject = env.config.subject;
          if (typeof subject !== "string" || subject.length < 1 || subject.length > 200) {
            return permanent("payload_invalid", "follow-up subject invalid");
          }
          // The adapter NEVER writes tables: the canonical work item and its
          // append-only state-history seed are created by ONE governed RPC, in
          // one transaction, idempotent on this execution.
          const r = await db.rpc("marketing_sequence_create_follow_up", {
            p_tenant: input.tenantId,
            p_execution: env.sequence_execution_id,
            p_person: env.person_id,
            p_config: env.config,
            p_actor: env.authorised_by,
          });
          if (r.error) {
            // A platform that cannot progress a core Action refuses the seam
            // outright. That is a CONFIGURATION fact, not a blip: retrying it
            // can never succeed, so it must never be classified transient.
            if (r.error.code === "MK428") {
              return permanent(
                "configuration_required",
                "this platform has no state machine for core Actions, so a follow-up would be unprogressable work",
              );
            }
            return ["22023", "P0002"].includes(r.error.code ?? "")
              ? permanent("target_invalid", "the follow-up was refused by the canonical path")
              : transient("work_item_create_failed", "the work item could not be created");
          }
          const out = (r.data ?? {}) as Record<string, unknown>;
          return {
            outcome: "succeeded",
            externalReference: `follow_up:${String(out.work_item_id ?? "")}`,
            result: {
              action: env.action_type,
              work_item_id: out.work_item_id ?? null,
              idempotent: out.idempotent === true,
            },
          };
        }

        default:
          return permanent("intent_type_unsupported", "unsupported contact action");
      }
    } catch {
      // an unexpected fault is TRANSIENT: the engine's retry policy decides,
      // and nothing here has an irreversible external effect
      return transient("action_failed", "the internal action did not complete");
    }
  },
};
