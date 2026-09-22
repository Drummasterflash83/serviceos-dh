import { z } from "zod";

const text = z.string().max(10000);
export const packageStatus = [
  "Proposed",
  "Scoping",
  "Agreed",
  "In progress",
  "Delivered",
  "On hold",
] as const;
export const systemStatus = [
  "Awaiting review",
  "Not connected",
  "In testing",
  "Operational",
  "Needs attention",
  "Paused",
] as const;
export const outcomeSchema = z.object({
  id: z.string().min(1),
  title: text,
  outcome: text,
  scope: text,
  measure: text,
  baseline: text,
  target: text,
  dependencies: text,
  acceptance: text,
  status: z.enum(packageStatus),
  optional: z.boolean(),
  setup: z.number().nonnegative().max(1e9).nullable(),
  monthly: z.number().nonnegative().max(1e9).nullable(),
  timing: text,
});
export const programmeSchema = z.object({
  company: text,
  title: text,
  objective: text,
  nextStep: text,
  commercialNote: text,
  outcomes: z.array(outcomeSchema).max(100),
  systems: z
    .array(
      z.object({
        id: z.string(),
        name: text,
        purpose: text,
        owner: text,
        status: z.enum(systemStatus),
        checkedAt: text,
        nextAction: text,
      }),
    )
    .max(100),
  links: z
    .array(
      z.object({
        id: z.string(),
        title: text,
        url: z
          .string()
          .url()
          .refine((v) => v.startsWith("https://"), "Use an https:// link"),
        description: text,
      }),
    )
    .max(100),
});
export type OutcomePackage = z.infer<typeof outcomeSchema>;
export type Programme = z.infer<typeof programmeSchema>;
export interface ProgrammeRow {
  tenant_id: string;
  content: Programme;
  version: number;
  updated_at: string;
}
export interface ProgrammeNote {
  id: string;
  author_id: string;
  body: string;
  created_at: string;
}
export function money(amount: number | null) {
  return amount === null
    ? "To be agreed"
    : new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: "GBP",
        maximumFractionDigits: 2,
      }).format(amount);
}
export function pricedSubtotal(outcomes: OutcomePackage[], field: "setup" | "monthly") {
  const included = outcomes.filter((p) => !p.optional);
  return {
    amount: included.reduce((n, p) => n + (p[field] ?? 0), 0),
    pending: included.filter((p) => p[field] === null).length,
    count: included.length,
  };
}
export function newOutcome(): OutcomePackage {
  return {
    id: crypto.randomUUID(),
    title: "New outcome",
    outcome: "",
    scope: "",
    measure: "",
    baseline: "To establish",
    target: "To agree",
    dependencies: "",
    acceptance: "",
    status: "Proposed",
    optional: true,
    setup: null,
    monthly: null,
    timing: "To agree",
  };
}
