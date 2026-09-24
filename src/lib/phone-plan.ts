import { z } from "zod";

const name = z.string().trim().min(1).max(80);
export const phonePlanSchema = z
  .object({
    version: z.literal(1),
    phones: z
      .array(
        z.object({
          id: z.string().uuid(),
          name,
          extension: z
            .string()
            .trim()
            .regex(/^\d{2,8}$/, "Use a 2–8 digit extension"),
        }),
      )
      .min(1)
      .max(40),
    groups: z
      .array(
        z.object({
          id: z.string().uuid(),
          name,
          members: z.array(z.string().uuid()).min(1).max(40),
          strategy: z.enum(["Together", "In order"]),
          seconds: z.number().int().min(5).max(120),
          fallback: z.string().trim().min(1).max(300),
        }),
      )
      .min(1)
      .max(12),
    hours: z.string().trim().min(1).max(500),
    notes: z.string().trim().max(1000),
  })
  .superRefine((p, ctx) => {
    const ids = new Set(p.phones.map((p) => p.id));
    if (ids.size !== p.phones.length || new Set(p.groups.map((g) => g.id)).size !== p.groups.length)
      ctx.addIssue({ code: "custom", message: "Phone and group IDs must be unique" });
    if (new Set(p.phones.map((p) => p.extension)).size !== p.phones.length)
      ctx.addIssue({ code: "custom", message: "Each phone needs a different extension" });
    for (const group of p.groups) {
      if (
        new Set(group.members).size !== group.members.length ||
        group.members.some((id) => !ids.has(id))
      )
        ctx.addIssue({
          code: "custom",
          message: "Group members must be unique phones in this plan",
        });
    }
  });
export type PhonePlan = z.infer<typeof phonePlanSchema>;
export const emptyPhonePlan = (): PhonePlan => ({
  version: 1,
  phones: [],
  groups: [],
  hours: "",
  notes: "",
});
export const PLAN_PREFIX = "OPENFOLK_PHONE_PLAN_V1\n";
export function encodePhonePlan(plan: PhonePlan) {
  const body = PLAN_PREFIX + JSON.stringify(phonePlanSchema.parse(plan));
  if (body.length > 10000)
    throw Error("This plan is too large. Please split it into smaller requests.");
  return body;
}
export function decodePhonePlan(body: string): PhonePlan | null {
  if (!body.startsWith(PLAN_PREFIX) || body.length > 10000) return null;
  try {
    return phonePlanSchema.parse(JSON.parse(body.slice(PLAN_PREFIX.length)));
  } catch {
    return null;
  }
}
export function addPhoneToGroup(plan: PhonePlan, phoneId: string, groupId: string): PhonePlan {
  if (!plan.phones.some((p) => p.id === phoneId)) return plan;
  return {
    ...plan,
    groups: plan.groups.map((g) =>
      g.id !== groupId || g.members.includes(phoneId)
        ? g
        : { ...g, members: [...g.members, phoneId] },
    ),
  };
}
export function describePhonePlan(plan: PhonePlan) {
  return [
    "Proposed phone configuration — not live. OpenFolk must verify the current Birchills configuration, review the requested changes, apply them and test calls before confirming completion.",
    ...plan.phones.map((p) => `Phone: ${p.name} · extension ${p.extension}`),
    ...plan.groups.map(
      (g) =>
        `${g.name}: ${g.members
          .map((id) => {
            const p = plan.phones.find((p) => p.id === id)!;
            return `${p.name} (${p.extension})`;
          })
          .join(
            " → ",
          )} · ring ${g.strategy.toLowerCase()} · ${g.seconds}s · no answer: ${g.fallback}`,
    ),
    `Hours and time zone: ${plan.hours}`,
    `Additional instructions: ${plan.notes || "None"}`,
  ].join("\n");
}
