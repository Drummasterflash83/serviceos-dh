export const clientFeedbackStages = [
  { key: "submitted", label: "Submitted" },
  { key: "in_review", label: "In review" },
  { key: "resolved", label: "Resolved" },
] as const;
export type ClientFeedbackStage = (typeof clientFeedbackStages)[number]["key"];
export function clientFeedbackStage(stage: string): ClientFeedbackStage {
  if (stage === "resolved") return "resolved";
  if (stage === "received") return "submitted";
  return "in_review";
}
export function clientFeedbackLabel(stage: ClientFeedbackStage) {
  return clientFeedbackStages.find((s) => s.key === stage)!.label;
}
