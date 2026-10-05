import type { CampaignContentInput } from "./campaigns";

export type CampaignDraftField = "name" | "sender_id" | "segment_id" | "subject" | "body_authored";

export type CampaignDraftErrors = Partial<Record<CampaignDraftField, string>>;

export function validateCampaignDraft(
  input: CampaignContentInput,
  available?: { senderIds: string[]; segmentIds: string[] },
): CampaignDraftErrors {
  const errors: CampaignDraftErrors = {};

  if (!input.name?.trim()) errors.name = "Enter a broadcast name.";
  if (!input.sender_id) errors.sender_id = "Choose a sender.";
  else if (available && !available.senderIds.includes(input.sender_id)) {
    errors.sender_id = "That sender is no longer available. Choose a sender again.";
  }
  if (!input.segment_id) errors.segment_id = "Choose a saved segment.";
  else if (available && !available.segmentIds.includes(input.segment_id)) {
    errors.segment_id = "That segment is no longer available. Choose a segment again.";
  }
  if (!input.subject?.trim()) errors.subject = "Enter an email subject.";
  if (!input.body_authored?.trim()) errors.body_authored = "Write the email body.";

  return errors;
}
