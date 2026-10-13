import type { LearnCardDetail } from './learn-cards.ts';

/** Summarise the accessible evidence window, never infer completed work from
 * silence or turn a missing owner into an assignment. No new AI claims. */
export function cardBrief(data: LearnCardDetail) {
  const terminal = new Set(['complete', 'completed', 'cancelled', 'resolved', 'closed', 'done']);
  const closed = data.findings.filter(f => terminal.has(f.status.toLowerCase()));
  const outstanding = data.findings.filter(f => !terminal.has(f.status.toLowerCase()));
  const ordered = [...outstanding].sort((a, b) =>
    Number(b.overdue) - Number(a.overdue) ||
    (a.deadline ? Date.parse(a.deadline) : Infinity) - (b.deadline ? Date.parse(b.deadline) : Infinity));
  const next = ordered[0] ?? null;
  const latest = [...data.evidence].filter(e => e.occurredAt)
    .sort((a, b) => Date.parse(b.occurredAt!) - Date.parse(a.occurredAt!))[0] ?? null;
  return { outstanding, closed, next, latest, limited: data.moreFindings || data.moreEvidence || data.gaps.length > 0 };
}
