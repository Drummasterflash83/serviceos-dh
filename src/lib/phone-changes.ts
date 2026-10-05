import { z } from "zod";
import { phonePlanSchema, type PhonePlan } from "./phone-plan.ts";
export const phoneSnapshotSchema = z.object({
  version: z.string().min(1).max(100),
  observedAt: z.string().datetime({ offset: true }),
  evidenceRef: z.string().min(1).max(300),
  plan: phonePlanSchema,
});
export type PhoneSnapshot = z.infer<typeof phoneSnapshotSchema>;
export function phoneChanges(before: PhonePlan, after: PhonePlan) {
  phonePlanSchema.parse(before);
  phonePlanSchema.parse(after);
  const changes: string[] = [];
  for (const p of before.phones) {
    const next = after.phones.find((x) => x.id === p.id);
    if (!next || next.extension !== p.extension)
      throw Error("Phone identity changed. Reload the verified setup.");
    if (next.name !== p.name) changes.push(`Extension ${p.extension}: ${p.name} → ${next.name}`);
  }
  if (
    before.phones.length !== after.phones.length ||
    before.groups.length !== after.groups.length ||
    before.hours !== after.hours ||
    before.notes !== after.notes
  )
    throw Error("This editor only changes phone names and group membership.");
  for (const g of before.groups) {
    const next = after.groups.find((x) => x.id === g.id);
    if (
      !next ||
      next.name !== g.name ||
      next.strategy !== g.strategy ||
      next.seconds !== g.seconds ||
      next.fallback !== g.fallback
    )
      throw Error("Group rules changed. Ask OpenFolk to review routing separately.");
    if (JSON.stringify(g.members) !== JSON.stringify(next.members)) {
      const names = (ids: string[], plan: PhonePlan) =>
        ids
          .map((id) => {
            const p = plan.phones.find((p) => p.id === id)!;
            return `${p.name} (${p.extension})`;
          })
          .join(" → ");
      changes.push(`${g.name}: ${names(g.members, before)} → ${names(next.members, after)}`);
    }
  }
  return changes;
}
export const CHANGE_PREFIX = "OPENFOLK_PHONE_CHANGE_V1\n";
export function describePhoneChanges(body: string): string | null {
  if (!body.startsWith(CHANGE_PREFIX) || body.length > 10000) return null;
  try {
    const parsed = z
      .object({
        baselineVersion: z.string().max(100),
        baselineObservedAt: z.string().datetime({ offset: true }),
        changes: z.array(z.string().max(5000)).max(100),
        proposed: phonePlanSchema,
      })
      .parse(JSON.parse(body.slice(CHANGE_PREFIX.length)));
    return [
      `Requested phone changes · awaiting provider application and testing`,
      `Based on verified setup ${parsed.baselineVersion}`,
      ...parsed.changes,
    ].join("\n");
  } catch {
    return "Phone change request needs OpenFolk review; its saved format is invalid.";
  }
}
export function encodePhoneChanges(snapshot: PhoneSnapshot, plan: PhonePlan) {
  const baseline = phoneSnapshotSchema.parse(snapshot),
    changes = phoneChanges(baseline.plan, plan);
  if (!changes.length) throw Error("No changes to save.");
  const body =
    CHANGE_PREFIX +
    JSON.stringify({
      baselineVersion: baseline.version,
      baselineObservedAt: baseline.observedAt,
      changes,
      proposed: phonePlanSchema.parse(plan),
    });
  if (body.length > 10000) throw Error("Please submit fewer changes at once.");
  return body;
}
