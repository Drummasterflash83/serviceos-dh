/** Bind work observations to their retained calculation before scoring. This checks
 * receipt attribution and summary agreement, not every item's source provenance. */
import type { LearnReadClient } from "./learn-cards.ts";
import type { CorrectedPerformanceMeasurement } from "./learn-performance-corrections.ts";
import { WORK_COLLECTORS } from "./learn-work-collection.ts";
import { delayStamp, delayUuid } from "./learn-work-delays.ts";

const tables = [
  "learn_work_measurement_runs",
  "learn_team_work_measurement_runs",
  "learn_work_collection_runs",
];
const error = () =>
  Error("Work evidence does not match its measurement. No score has been calculated.");
const common =
  "id,tenant_id,source_system,metric_key,observed_at,receipt_contract:proof->contract,receipt_value:proof->value,receipt_covered:proof->coveredItems,receipt_eligible:proof->eligibleItems";
const columns = (table: string) =>
  common +
  (table === tables[2]
    ? ",subject_id,subject_kind,policy_id,policy_revision,window_start,window_end,unit,state,kind,snapshot_at,population,processed,receipt_run_id:proof->runId,receipt_kind:proof->kind,receipt_population:proof->populationCount,receipt_processed:proof->processed,receipt_items:proof->itemCount"
    : `,subject_id:${table === tables[1] ? "team_id" : "member_id"},policy_id:request->policyId,policy_revision:request->policyVersion,window_start:request->start,window_end:request->end,request_subject:request->${table === tables[1] ? "teamId" : "memberId"}`);
const sameTime = (a: unknown, b: unknown) => {
  try {
    return delayStamp(a) === delayStamp(b);
  } catch {
    return false;
  }
};

export async function verifyMeasurementReceipts(
  db: LearnReadClient,
  tenantId: string,
  measurements: CorrectedPerformanceMeasurement[],
): Promise<void> {
  const byId = new Map(measurements.map((m) => [m.id, m]));
  if (
    !delayUuid(tenantId) ||
    byId.size !== measurements.length ||
    measurements.length > 500 ||
    measurements.some((m) => m.tenantId !== tenantId)
  )
    throw error();
  const needed = new Map<string, Map<string, CorrectedPerformanceMeasurement>>();
  for (const measurement of measurements) {
    let root = measurement;
    const seen = new Set<string>();
    // Numerical corrections keep the original source calculation, not a invented
    // receipt for the corrected value. Correction validation runs before this.
    while (root.correction) {
      if (seen.has(root.id)) throw error();
      seen.add(root.id);
      const parent = byId.get(root.correction.predecessor_id);
      if (!parent || root.supersedes !== parent.id) throw error();
      root = parent;
    }
    const spec = Object.values(WORK_COLLECTORS).find((s) => s.source === root.sourceSystem);
    const receiptRefs = root.evidence.filter((r) => tables.includes(r.table));
    if (!spec && !receiptRefs.length) continue;
    if (
      !spec ||
      root.metricKey !== spec.metric ||
      root.unit !== spec.unit ||
      root.subject.kind !== spec.subjectKind ||
      root.evidence.length !== 1 ||
      receiptRefs.length !== 1 ||
      root.exclusions.length ||
      !Number.isSafeInteger(root.eligibleCount) ||
      root.eligibleCount! < 0
    )
      throw error();
    const ref = receiptRefs[0];
    if (
      ref.id !== root.id ||
      (ref.table !== tables[2] &&
        (spec.rpc === null || ref.table !== (spec.subjectKind === "team" ? tables[1] : tables[0])))
    )
      throw error();
    if (!needed.has(ref.table)) needed.set(ref.table, new Map());
    needed.get(ref.table)!.set(ref.id, root);
  }
  for (const [table, roots] of needed) {
    const ids = [...roots.keys()];
    for (let offset = 0; offset < ids.length; offset += 100) {
      const batch = ids.slice(offset, offset + 100);
      const {
        data,
        error: readError,
        count,
      } = await db
        .from(table)
        .select(columns(table), { count: "exact" })
        .eq("tenant_id", tenantId)
        .in("id", batch)
        .limit(101);
      if (readError || !Array.isArray(data) || count !== batch.length || data.length !== count)
        throw error();
      const seen = new Set<string>();
      for (const r of data) {
        const m = roots.get(r.id);
        if (!m || !batch.includes(r.id) || seen.has(r.id) || r.tenant_id !== tenantId)
          throw error();
        seen.add(r.id);
        const entry = Object.entries(WORK_COLLECTORS).find(([, s]) => s.source === m.sourceSystem)!;
        const [kind] = entry;
        if (
          r.subject_id !== m.subject.id ||
          r.policy_id !== m.policyId ||
          r.policy_revision !== m.policyVersion ||
          r.source_system !== m.sourceSystem ||
          r.metric_key !== m.metricKey ||
          !sameTime(r.window_start, m.period.start) ||
          !sameTime(r.window_end, m.period.end) ||
          !sameTime(r.observed_at, m.observedAt) ||
          r.receipt_value !== m.value ||
          r.receipt_covered !== m.coveredCount ||
          r.receipt_eligible !== m.eligibleCount ||
          m.sampleCount !== m.coveredCount ||
          (m.value !== null && m.coveredCount !== m.eligibleCount)
        )
          throw error();
        if (table === tables[2]) {
          if (
            r.state !== "completed" ||
            r.subject_kind !== m.subject.kind ||
            r.unit !== m.unit ||
            r.kind !== kind ||
            r.receipt_contract !== "work-collection@1" ||
            r.receipt_kind !== kind ||
            r.receipt_run_id !== m.id ||
            !Number.isSafeInteger(r.population) ||
            r.population < 0 ||
            r.processed !== r.population ||
            r.receipt_population !== r.population ||
            r.receipt_processed !== r.population ||
            r.receipt_items !== r.population ||
            m.coveredCount > m.eligibleCount! ||
            m.eligibleCount! > r.population ||
            (m.value === null
              ? m.sourceThrough !== null
              : !sameTime(m.sourceThrough, r.snapshot_at))
          )
            throw error();
        } else {
          const contract =
            kind === "handoffs"
              ? "work-handoffs@1"
              : kind === "residence"
                ? "work-residence@1"
                : "team-work-residence@1";
          if (
            r.request_subject !== m.subject.id ||
            r.receipt_contract !== contract ||
            (m.value === null ? m.sourceThrough !== null : m.coveredCount !== m.eligibleCount)
          )
            throw error();
        }
      }
    }
  }
}
