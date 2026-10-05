// Run: node supabase/functions/_shared/health/evaluation.verify.ts
//
// Measures the callback classifier + ownership + grouping against the labelled
// evaluation set and asserts the initial gate:
//   • callback precision ≥ 90%      • callback recall ≥ 90%
//   • duplicate proposal rate < 5%  • wrong-responsibility rate < 5%
//   • zero cross-tenant leakage
// Reports raw numerators/denominators. Pure — no DB, no network.

import { runShadowPipeline, type ShadowContext } from "./pipeline.ts";
import {
  CALLBACK_EVAL_SET,
  EVAL_OWNERSHIP_MAPS,
  type EvalCase,
} from "./fixtures/callback_eval_set.ts";

const NOW = Date.parse("2026-07-22T12:00:00Z");

function ctxFor(c: EvalCase): ShadowContext {
  return {
    tenantId: c.tenant,
    policyVersionId: `pv-${c.tenant}`,
    policyPublished: true,
    // The eval harness explicitly opens the source boundary for its two channels —
    // production tenants remain default-deny until an operator enables theirs.
    sourceAllowlistEnabled: true,
    allowedSources: ["phone_call", "email_message"],
    policy: {},
    ownershipMaps: EVAL_OWNERSHIP_MAPS[c.tenant] ?? {},
    companyId: c.identity.companyId,
    companyConfidence: c.identity.companyConf ?? null,
    personId: c.identity.personId,
    priorState: null,
    resolution: c.resolution ?? "none",
    nowMs: NOW,
  };
}

// predictedCandidate = classifier said this is a callback request.
// predictedOpenWork  = pipeline produced a NEW open proposal (state 'proposed').
interface Row {
  c: EvalCase;
  route: string;
  outcome: string;
  proposalState: string | null;
  groupKey: string | null;
  ownerSource: string | null;
  tenantOnRows: string[];
}

const rows: Row[] = CALLBACK_EVAL_SET.map((c) => {
  const r = runShadowPipeline({ communication: c.comm, ctx: ctxFor(c) });
  const tenantOnRows: string[] = [];
  if (r.healthObject) tenantOnRows.push(r.healthObject.tenant_id);
  if (r.assessment) tenantOnRows.push(r.assessment.tenant_id);
  if (r.proposal) tenantOnRows.push(r.proposal.tenant_id);
  for (const s of r.sources) tenantOnRows.push(s.tenant_id);
  return {
    c,
    route: r.classification.route,
    outcome: r.outcome,
    proposalState: r.proposal?.state ?? null,
    groupKey: r.groupKey,
    ownerSource: r.ownership?.source ?? null,
    tenantOnRows,
  };
});

// ── Precision / recall over "is there a callback request?". ────────────────
// POSITIVE truth = obligation ∈ {exists, already_satisfied}; NEGATIVE = none;
// UNCERTAIN = uncertain (a candidate prediction here is a false positive — we would
// have proposed work on an indeterminate message).
let tp = 0,
  fp = 0,
  fn = 0,
  tn = 0;
let uncertainCorrect = 0,
  uncertainTotal = 0;
for (const row of rows) {
  const truth = row.c.truth.obligation;
  const predictedCandidate = row.route === "candidate";
  if (truth === "exists" || truth === "already_satisfied") {
    if (predictedCandidate) tp++;
    else fn++;
  } else if (truth === "none") {
    if (predictedCandidate) fp++;
    else tn++;
  } else {
    // uncertain
    uncertainTotal++;
    if (row.route === "uncertain") uncertainCorrect++;
    if (predictedCandidate) fp++; // proposing work on ambiguous = false positive
  }
}
const precision = tp / (tp + fp || 1);
const recall = tp / (tp + fn || 1);

// ── Wrong-responsibility rate (over produced proposals with a resolved subject). ─
let ownerTotal = 0,
  ownerWrong = 0;
const ownerMisses: string[] = [];
for (const row of rows) {
  if (!row.ownerSource) continue; // only where a proposal/ownership was produced
  if (row.c.truth.obligation === "exists" || row.c.truth.obligation === "already_satisfied") {
    ownerTotal++;
    if (row.ownerSource !== row.c.truth.expectedOwnerSource) {
      ownerWrong++;
      ownerMisses.push(
        `${row.c.id}: got ${row.ownerSource}, expected ${row.c.truth.expectedOwnerSource}`,
      );
    }
  }
}
const wrongOwnerRate = ownerWrong / (ownerTotal || 1);

// ── Duplicate proposal rate. ────────────────────────────────────────────────
// Group produced OPEN proposals by (tenant, obligationId truth). Extra distinct
// group_keys within one obligation = folding failure; a group_key shared across two
// different obligations = collision. Both are duplicates.
const openProps = rows.filter((r) => r.proposalState === "proposed");
const byObligation = new Map<string, Set<string>>();
const groupKeyToObligation = new Map<string, string>();
let collisions = 0;
for (const r of openProps) {
  const oblig = `${r.c.tenant}:${r.c.truth.obligationId}`;
  if (!byObligation.has(oblig)) byObligation.set(oblig, new Set());
  byObligation.get(oblig)!.add(r.groupKey!);
  const prev = groupKeyToObligation.get(r.groupKey!);
  if (prev && prev !== oblig) collisions++;
  else groupKeyToObligation.set(r.groupKey!, oblig);
}
let foldFailures = 0;
for (const [, keys] of byObligation) foldFailures += Math.max(0, keys.size - 1);
const totalObligations = byObligation.size;
const duplicateRate = (foldFailures + collisions) / (totalObligations || 1);

// ── Cross-tenant leakage. ───────────────────────────────────────────────────
let leaks = 0;
const leakDetail: string[] = [];
for (const row of rows) {
  for (const t of row.tenantOnRows) {
    if (t !== row.c.tenant) {
      leaks++;
      leakDetail.push(`${row.c.id}: row tenant ${t} != case tenant ${row.c.tenant}`);
    }
  }
}

// ── Report. ─────────────────────────────────────────────────────────────────
console.log("Customer Health — callback classifier evaluation");
console.log(`  cases: ${rows.length}  (positives incl. already_satisfied, negatives, uncertain)`);
console.log("");
console.log(
  `  Precision:  ${(precision * 100).toFixed(1)}%   TP=${tp} FP=${fp}  → ${tp}/${tp + fp}`,
);
console.log(`  Recall:     ${(recall * 100).toFixed(1)}%   TP=${tp} FN=${fn}  → ${tp}/${tp + fn}`);
console.log(`  (TN=${tn}; uncertain routed correctly ${uncertainCorrect}/${uncertainTotal})`);
console.log(
  `  Wrong-responsibility: ${(wrongOwnerRate * 100).toFixed(1)}%   ${ownerWrong}/${ownerTotal}`,
);
if (ownerMisses.length) ownerMisses.forEach((m) => console.log(`      - ${m}`));
console.log(
  `  Duplicate proposals:  ${(duplicateRate * 100).toFixed(1)}%   (fold-failures=${foldFailures} + collisions=${collisions}) / ${totalObligations} obligations`,
);
console.log(`  Cross-tenant leakage: ${leaks}`);
if (leakDetail.length) leakDetail.forEach((m) => console.log(`      - ${m}`));
console.log("");

const checks: Array<[string, boolean]> = [
  ["precision ≥ 90%", precision >= 0.9],
  ["recall ≥ 90%", recall >= 0.9],
  ["duplicate rate < 5%", duplicateRate < 0.05],
  ["wrong-responsibility rate < 5%", wrongOwnerRate < 0.05],
  ["zero cross-tenant leakage", leaks === 0],
];
let failed = 0;
for (const [label, pass] of checks) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}`);
  if (!pass) failed++;
}
console.log(
  failed === 0
    ? "\nevaluation.verify: GATE PASSED"
    : `\nevaluation.verify: GATE FAILED (${failed})`,
);
process.exit(failed === 0 ? 0 : 1);
