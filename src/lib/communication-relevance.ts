import type { CommRelevanceReport } from "./openfolk";
/** Presentation guard only. Server-side operator authorisation remains mandatory. */
export function communicationRelevanceForTenant(
  value: unknown,
  tenant: string,
): CommRelevanceReport | null {
  const r = value as CommRelevanceReport | null;
  const count = (n: unknown): n is number =>
    typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
  const counts = (v: unknown): v is Record<string, number> =>
    !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every(count);
  const sum = (v: Record<string, number>) => Object.values(v).reduce((a, b) => a + b, 0);
  if (
    !r ||
    r.tenantId !== tenant ||
    r.classificationScope !== "historical_eligibility_consensus" ||
    typeof r.generatedAt !== "string" ||
    !Number.isFinite(Date.parse(r.generatedAt)) ||
    ![
      r.totalCommunications,
      r.ledgerRecords,
      r.reprocessedCommunications,
      r.conflictingCommunications,
    ].every(count) ||
    !counts(r.byClass) ||
    !counts(r.byRelevance) ||
    !counts(r.exclusion) ||
    ![
      "noiseInteractions",
      "intelligenceObjectsExcluded",
      "recommendationsExcluded",
      "recommendationsOpenExcluded",
    ].every((k) => count(r.exclusion[k as keyof typeof r.exclusion])) ||
    sum(r.byClass) !== r.totalCommunications ||
    sum(r.byRelevance) !== r.totalCommunications ||
    r.ledgerRecords < r.totalCommunications ||
    r.reprocessedCommunications > r.totalCommunications ||
    r.conflictingCommunications > r.reprocessedCommunications ||
    r.exclusion.noiseInteractions !== (r.byRelevance.not_relevant ?? 0) ||
    r.exclusion.recommendationsOpenExcluded > r.exclusion.recommendationsExcluded ||
    typeof r.caveat !== "string" ||
    !r.caveat
  )
    return null;
  return r;
}
