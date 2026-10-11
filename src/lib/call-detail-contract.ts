import { z } from "zod";

const nullableText = z.string().nullable();
const confidence = z.number().finite().min(0).max(1);
const party = z
  .object({
    entity_id: z.string().optional(),
    name: nullableText.optional(),
    role: nullableText.optional(),
    confidence: confidence.optional(),
    number: nullableText.optional(),
    unresolved: z.boolean().optional(),
  })
  .nullable();
export const reviewSchema = z
  .object({
    reviewed_at: z.string(),
    reviewed_by: nullableText,
    note: nullableText,
  })
  .nullable();
const detailSchema = z.object({
  success: z.literal(true),
  version: z.literal("phone-call-detail/2"),
  tenant_id: z.string().uuid(),
  provenance: z.object({
    freshness: z.literal("unverified"),
    transcript_id: z.string().uuid().nullable(),
  }),
  call: z.object({
    call_id: z.string().uuid(),
    occurred_at: nullableText,
    direction: z.string(),
    connector: z.string(),
    phone_from: nullableText,
    phone_to: nullableText,
    processing_status: nullableText,
  }),
  insight: z
    .object({
      summary: z.string(),
      intent: nullableText,
      urgency: nullableText,
      sentiment: nullableText,
      action_required: z.boolean().nullable(),
      suggested_owner: nullableText,
      confidence: confidence.nullable(),
      updated_at: nullableText,
    })
    .nullable(),
  identity: z.object({
    internal: party,
    external: party,
    direction: nullableText,
    direction_confidence: confidence.nullable(),
    has_conflict: z.boolean(),
    unresolved: z.array(z.string()),
    identity_confidence: confidence.nullable(),
  }),
  transcript: z.object({
    raw: nullableText,
    normalised: nullableText,
    corrections: z.array(
      z.object({
        from: z.string(),
        to: z.string(),
        applied: z.boolean(),
        confidence,
        category: z.string(),
        evidence: z.array(z.string()),
        span: z.object({
          start: z.number().int().nonnegative(),
          end: z.number().int().nonnegative(),
        }),
      }),
    ),
  }),
  review: reviewSchema,
});

export function parseCallDetail(value: unknown, callId: string) {
  const parsed = detailSchema.safeParse(value);
  if (!parsed.success || parsed.data.call.call_id !== callId)
    throw new Error("Call details could not be verified. Refresh or contact your administrator.");
  const { provenance, transcript } = parsed.data;
  if (
    (!provenance.transcript_id &&
      (transcript.raw !== null ||
        transcript.normalised !== null ||
        transcript.corrections.length)) ||
    (transcript.raw === null && (transcript.normalised !== null || transcript.corrections.length))
  )
    throw new Error("Saved transcript source could not be verified.");
  return parsed.data;
}
