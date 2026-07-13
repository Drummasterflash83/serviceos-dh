// Universal Intelligence Foundation — pure policy evaluator.
//
// Deterministic, side-effect-free, no I/O, clock injected. This purity is what
// makes confidence routing, learning and simulation possible (docs §6, §10.2).
// Policies are DATA; this function is the only interpreter of them.

import type {
  ActionProposal,
  Condition,
  EffectiveProfile,
  Effects,
  IntelligenceObject,
  MatchedRule,
  Operand,
  OwnershipAssignment,
  Policy,
  PolicyDecision,
  ReviewRoute,
} from "./types.ts";
import { profileValue } from "./profile.ts";

const ROUTE_RANK: Record<ReviewRoute, number> = {
  auto: 0,
  openfolk: 1,
  tenant_senior: 2,
  manual: 3,
};

/** Stable, dependency-free hash (djb2) over a JSON-serialisable value. */
export function stableHash(value: unknown): string {
  const json = JSON.stringify(value) ?? "null";
  let h = 5381;
  for (let i = 0; i < json.length; i++) h = ((h << 5) + h + json.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

function resolveOperand(
  operand: Operand | number | string,
  object: IntelligenceObject,
  profile: EffectiveProfile,
): unknown {
  if (typeof operand === "number" || typeof operand === "string") return operand;
  if ("field" in operand) return (object as Record<string, unknown>)[operand.field];
  if ("attr" in operand) return object.attributes?.[operand.attr];
  if ("profile" in operand) return profileValue(profile, operand.profile);
  if ("const" in operand) return operand.const;
  return undefined;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function evalCondition(
  cond: Condition,
  object: IntelligenceObject,
  profile: EffectiveProfile,
): boolean {
  switch (cond.op) {
    case "and":
      return cond.clauses.every((c) => evalCondition(c, object, profile));
    case "or":
      return cond.clauses.some((c) => evalCondition(c, object, profile));
    case "not":
      return !evalCondition(cond.clause, object, profile);
    case "exists": {
      const v = resolveOperand(cond.left, object, profile);
      return v !== undefined && v !== null;
    }
    case "in": {
      const l = resolveOperand(cond.left, object, profile);
      const r = resolveOperand(cond.right, object, profile);
      return Array.isArray(r) && r.includes(l as never);
    }
    default: {
      // eq | neq | lt | lte | gt | gte
      const l = resolveOperand(cond.left, object, profile);
      const r = resolveOperand(cond.right, object, profile);
      if (cond.op === "eq") return l === r;
      if (cond.op === "neq") return l !== r;
      const ln = asNumber(l);
      const rn = asNumber(r);
      if (ln === null || rn === null) return false; // undefined operand ⇒ comparison is false, never throws
      if (cond.op === "lt") return ln < rn;
      if (cond.op === "lte") return ln <= rn;
      if (cond.op === "gt") return ln > rn;
      if (cond.op === "gte") return ln >= rn;
      return false;
    }
  }
}

function applyEffects(
  effects: Effects,
  object: IntelligenceObject,
  profile: EffectiveProfile,
  acc: {
    priority: string | null;
    severity: string | null;
    deadlineHours: number | null;
    assignments: OwnershipAssignment[];
    route: ReviewRoute;
    recommended_action: string | null;
    automation_permission: "none" | "suggest" | "act";
    action_proposals: ActionProposal[];
    reasons: string[];
  },
): void {
  if (effects.set_priority !== undefined) acc.priority = effects.set_priority;
  if (effects.set_severity !== undefined) acc.severity = effects.set_severity;
  if (effects.set_deadline_hours !== undefined) {
    const hrs = asNumber(resolveOperand(effects.set_deadline_hours, object, profile));
    if (hrs !== null) acc.deadlineHours = hrs;
  }
  if (effects.assign) {
    for (const a of effects.assign) {
      const ref =
        typeof a.party_ref === "string"
          ? a.party_ref
          : (resolveOperand(a.party_ref, object, profile) as string | undefined);
      if (typeof ref === "string" && ref.length > 0) {
        acc.assignments.push({ raci_role: a.raci_role, party_kind: a.party_kind, party_ref: ref });
      }
    }
  }
  if (effects.propose_action) {
    const p = effects.propose_action;
    let owner: OwnershipAssignment | null = null;
    if (p.owner) {
      const ref =
        typeof p.owner.party_ref === "string"
          ? p.owner.party_ref
          : (resolveOperand(p.owner.party_ref, object, profile) as string | undefined);
      if (typeof ref === "string" && ref.length > 0) {
        owner = { raci_role: p.owner.raci_role, party_kind: p.owner.party_kind, party_ref: ref };
      }
    }
    acc.action_proposals.push({
      action_type: p.action_type,
      title: p.title,
      description: p.description ?? null,
      reason: p.reason ?? null,
      automation_intent: p.automation_intent ?? null,
      owner,
    });
  }
  if (effects.review_route && ROUTE_RANK[effects.review_route] > ROUTE_RANK[acc.route]) {
    acc.route = effects.review_route; // escalate to the most restrictive route
  }
  if (effects.recommended_action !== undefined) acc.recommended_action = effects.recommended_action;
  if (effects.automation_permission !== undefined) {
    acc.automation_permission = effects.automation_permission;
  }
  if (effects.reason) acc.reasons.push(effects.reason);
}

/**
 * Evaluate an object against the full policy set. Deterministic given
 * (policies, object, profile, now). Produces the decision + full explanation.
 */
export function evaluatePolicies(
  policies: Policy[],
  object: IntelligenceObject,
  profile: EffectiveProfile,
  opts: { now: number },
): PolicyDecision {
  const ordered = policies
    .filter((p) => p.enabled !== false && (p.domain === "core" || p.domain === object.domain))
    .sort((a, b) => a.priority - b.priority);

  const acc = {
    priority: object.priority ?? null,
    severity: object.severity ?? null,
    deadlineHours: null as number | null,
    assignments: [] as OwnershipAssignment[],
    route: "auto" as ReviewRoute,
    recommended_action: null as string | null,
    automation_permission: "none" as "none" | "suggest" | "act",
    action_proposals: [] as ActionProposal[],
    reasons: [] as string[],
  };
  const matched: MatchedRule[] = [];
  const versionIds = new Set<string>();

  for (const policy of ordered) {
    for (const rule of policy.rules) {
      if (evalCondition(rule.when, object, profile)) {
        applyEffects(rule.then, object, profile, acc);
        matched.push({ policy_id: policy.id, rule_id: rule.id, reason: rule.then.reason });
        versionIds.add(policy.version_id);
      }
    }
  }

  const deadline =
    acc.deadlineHours !== null
      ? new Date(opts.now + acc.deadlineHours * 3600_000).toISOString()
      : null;

  const outputs = {
    priority: acc.priority,
    severity: acc.severity,
    deadline,
    assignments: acc.assignments,
    review_route: acc.route,
    recommended_action: acc.recommended_action,
    automation_permission: acc.automation_permission,
    action_proposals: acc.action_proposals,
    reasons: acc.reasons,
  };

  return {
    ...outputs,
    matched_rules: matched,
    policy_version_ids: Array.from(versionIds),
    input_hash: stableHash({ object, profile, policies: ordered.map((p) => p.version_id) }),
  };
}
