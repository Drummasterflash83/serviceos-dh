export const deskStages = [
  { key: "received", label: "New" },
  { key: "reviewing", label: "Reviewing" },
  { key: "approval", label: "Needs approval" },
  { key: "approved", label: "In progress" },
  { key: "verifying", label: "Ready to test" },
  { key: "resolved", label: "Resolved" },
] as const;
export type DeskStage = (typeof deskStages)[number]["key"];
export type DeskIssue = {
  id: string;
  tenant_id: string;
  feedback_id: string | null;
  source_key: string;
  title: string;
  detail: string;
  priority: string;
  stage: DeskStage;
  diagnosis: string;
  proposal: string;
  test_plan: string;
  owner_id: string | null;
  customer_update: string;
  approved_at: string | null;
  release_ref: string | null;
  verification: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};
export function deskQueue<T extends { priority: string; created_at: string; id: string }>(
  rows: T[],
  order = "priority",
) {
  const rank: Record<string, number> = { urgent: 0, high: 1, normal: 2 };
  return [...rows].sort((a, b) => {
    const priority = order === "priority" ? (rank[a.priority] ?? 3) - (rank[b.priority] ?? 3) : 0;
    const recent = Date.parse(b.created_at) - Date.parse(a.created_at);
    return (
      priority ||
      (Number.isFinite(recent) ? (order === "oldest" ? -recent : recent) : 0) ||
      a.id.localeCompare(b.id)
    );
  });
}
export function stageLabel(stage: string) {
  return deskStages.find((s) => s.key === stage)?.label ?? "Needs review";
}
export function canApprove(issue: DeskIssue) {
  return (
    issue.stage === "approval" &&
    [issue.diagnosis, issue.proposal, issue.test_plan].every((x) => x.trim().length >= 5)
  );
}
