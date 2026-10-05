/**
 * Command Centre — story + briefing synthesis (PURE, no I/O).
 *
 * Two derivations over the already-fetched CommandFeed:
 *  1. buildStories() — collapses individual signals into BUSINESS STORIES. Items that
 *     share a decision lineage (signal → action → intent → outcome) or a customer entity
 *     become one narrative: what's happening, what ServiceOS understands, why it matters,
 *     what to do, how sure it is, and where it stands.
 *  2. buildBriefing() — an executive "daily briefing": how many signals were reviewed,
 *     the few things that need a decision (categorised from the real content), and what
 *     was handled automatically. Nothing is hardcoded — every line is derived from rows.
 */

import type { CommandFeed, CommandItem, CommandPriority } from "./command-centre";

export type StoryStatus = "needs_approval" | "in_progress" | "completed" | "monitoring";

export interface Story {
  id: string; // the shared story key (decision lineage or entity)
  title: string;
  context: string | null;
  situation: string | null; // what ServiceOS understands
  impact: string | null; // why it matters
  recommendation: string | null; // what should happen next
  confidence: number | null;
  priority: CommandPriority;
  status: StoryStatus;
  eventType: string;
  timestamp: string; // latest activity in the story
  items: CommandItem[];
  lead: CommandItem;
  /** The pending automation_intent id an operator can APPROVE, if the story has one. */
  approvableIntentId: string | null;
}

const PRIORITY_WEIGHT: Record<CommandPriority, number> = { high: 3, medium: 2, low: 1 };

function ms(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** Turn an Observation subject ("Inbound email from Sarah Mitchell: my boiler…") into a
 *  clean headline ("My boiler…") — the customer name is shown separately. Idempotent on
 *  subjects that carry no such prefix. */
function headline(subject: string): string {
  const m = subject.match(/^Inbound\s+\w+\s+from\s+[^:]+:\s*(.+)$/i);
  const body = (m ? m[1] : subject).trim();
  return body.charAt(0).toUpperCase() + body.slice(1);
}

/** How representative an item is of "what to do" — the highest scorer leads the story. */
function leadScore(i: CommandItem): number {
  let s = 0;
  if (i.source === "automation" && i.status === "pending") s += 100; // the thing to approve
  if (i.actionable) s += 40;
  s += PRIORITY_WEIGHT[i.priority] * 10;
  if (i.recommendedAction) s += 5;
  if (i.source === "recommendation" || i.source === "action") s += 3;
  if (i.source === "event") s -= 20; // events are the least representative
  return s;
}

function maxPriority(items: CommandItem[]): CommandPriority {
  if (items.some((i) => i.priority === "high" && i.isOpen)) return "high";
  if (items.some((i) => i.priority === "high")) return "high";
  if (items.some((i) => i.priority === "medium")) return "medium";
  return "low";
}

function impactFor(priority: CommandPriority, status: StoryStatus): string {
  if (status === "completed") return "Resolved — recorded for the audit trail.";
  if (status === "in_progress") return "In motion — the automation engine is executing this.";
  switch (priority) {
    case "high":
      return "High — acting today protects the outcome.";
    case "medium":
      return "Medium — worth reviewing before it escalates.";
    default:
      return "Low — informational, no action needed.";
  }
}

/** Canonical presentation key: when an item is anchored to a known customer, group it
 *  by customer + the normalised issue so near-identical items for one underlying problem
 *  (e.g. "…(report 1/2/3)") collapse into a single story. Items with no customer keep their
 *  lineage `storyKey`, so unrelated work is never merged. Presentation-only — this changes
 *  what is shown, never the underlying rows or feed counts. */
function groupKeyFor(it: CommandItem): string {
  if (it.customerName && it.customerName.trim()) {
    const issue = headline(it.title)
      .toLowerCase()
      .replace(/\(report\s*\d+\)/g, "")
      .replace(/\breport\s*\d+\b/g, "")
      .replace(/[0-9#]+/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return `cust:${it.customerName.toLowerCase().trim()}|${issue}`;
  }
  return it.storyKey;
}

export function buildStories(items: CommandItem[]): Story[] {
  const groups = new Map<string, CommandItem[]>();
  for (const it of items) {
    const key = groupKeyFor(it);
    const arr = groups.get(key);
    if (arr) arr.push(it);
    else groups.set(key, [it]);
  }

  const stories: Story[] = [];
  for (const [key, group] of groups) {
    const sorted = [...group].sort((a, b) => ms(b.timestamp) - ms(a.timestamp));
    const lead = sorted.reduce((best, i) => (leadScore(i) > leadScore(best) ? i : best), sorted[0]);
    const priority = maxPriority(sorted);
    const pendingIntent = sorted.find((i) => i.source === "automation" && i.status === "pending");
    const status: StoryStatus = pendingIntent
      ? "needs_approval"
      : sorted.some((i) => i.isAutomated && !i.isCompleted && i.status !== "pending")
        ? "in_progress"
        : sorted.some((i) => i.isOpen)
          ? "monitoring"
          : "completed";

    // The narrative is customer-first: when a known customer anchors the story, headline
    // THEM (name + what happened), not the automation that will act on it. `lead` still
    // drives the approve affordance + status. Falls back to the lead when no customer.
    const customerItem = sorted.find((i) => i.customerName);
    const narrative = customerItem ?? lead;
    const title = customerItem?.customerName
      ? `${customerItem.customerName} — ${headline(customerItem.title)}`
      : lead.title;

    const baseContext = narrative.context ?? sorted.find((i) => i.context)?.context ?? null;
    const related = sorted.length - 1;
    const context =
      related > 0
        ? `${baseContext ? `${baseContext} · ` : ""}${related} related signal${related > 1 ? "s" : ""}`
        : baseContext;

    stories.push({
      id: key,
      title,
      context,
      // "Why this surfaced / why it matters" prefers the human customer narrative, then
      // the AI reasoning from the decision log.
      situation:
        narrative.whySurfaced ??
        sorted.find((i) => i.whySurfaced)?.whySurfaced ??
        lead.reasoning ??
        sorted.find((i) => i.reasoning)?.reasoning ??
        null,
      impact: impactFor(priority, status),
      recommendation:
        narrative.recommendedAction ??
        lead.recommendedAction ??
        sorted.find((i) => i.recommendedAction)?.recommendedAction ??
        null,
      confidence:
        narrative.confidence ??
        lead.confidence ??
        sorted.find((i) => i.confidence != null)?.confidence ??
        null,
      priority,
      status,
      eventType: lead.eventType,
      timestamp: sorted[0]?.timestamp ?? lead.timestamp,
      items: sorted,
      lead,
      approvableIntentId: pendingIntent ? pendingIntent.rawId : null,
    });
  }

  // Prioritisation over chronology: highest priority first, then most recent.
  stories.sort(
    (a, b) =>
      PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority] ||
      ms(b.timestamp) - ms(a.timestamp),
  );
  return stories;
}

// ── Daily briefing ─────────────────────────────────────────────────────────────

export type BriefingCategory = "customer_risk" | "revenue" | "operational" | "attention";

export interface BriefingAttention {
  category: BriefingCategory;
  label: string;
  emoji: string;
  title: string;
  detail: string | null;
  recommendation: string | null;
  risk: string; // High / Medium / Low
  storyId: string;
}

export interface BriefingHandled {
  label: string;
  count: number;
}

export interface Briefing {
  greeting: string;
  reviewedCount: number;
  attention: BriefingAttention[];
  handled: BriefingHandled[];
  clear: boolean;
}

function greet(now: Date, name: string | null): string {
  const h = now.getHours();
  const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const first = (name ?? "").trim().split(/\s+/)[0] || null;
  return first ? `${part}, ${first}` : part;
}

function categoryOf(story: Story): { key: BriefingCategory; label: string; emoji: string } {
  const hay =
    `${story.title} ${story.context ?? ""} ${story.situation ?? ""} ${story.eventType}`.toLowerCase();
  if (
    /risk|complaint|unhappy|frustrat|churn|retention|escalat|angry|dissatisf|cancel|unresolved|broken|breakdown|no heating|no hot water|failure|declin|repeat/.test(
      hay,
    )
  )
    return { key: "customer_risk", label: "Customer risk", emoji: "🔥" };
  if (
    /quote|follow.?up|opportunit|revenue|upsell|renew|proposal|lead|sale|invoice|payment/.test(hay)
  )
    return { key: "revenue", label: "Revenue opportunity", emoji: "💰" };
  if (
    /engineer|part|job|delay|schedul|supplier|stock|route|dispatch|visit|install|repair/.test(hay)
  )
    return { key: "operational", label: "Operational issue", emoji: "⚙️" };
  return { key: "attention", label: "Needs attention", emoji: "📌" };
}

const RISK_LABEL: Record<CommandPriority, string> = { high: "High", medium: "Medium", low: "Low" };

function lower1(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

export function buildBriefing(
  feed: CommandFeed,
  name: string | null,
  now: Date,
  maxAttention = 3,
): Briefing {
  const stories = buildStories(feed.items);

  const attentionStories = stories
    .filter(
      (s) => s.priority === "high" && (s.status === "needs_approval" || s.status === "monitoring"),
    )
    .slice(0, maxAttention);

  const attention: BriefingAttention[] = attentionStories.map((s) => {
    const cat = categoryOf(s);
    return {
      category: cat.key,
      label: cat.label,
      emoji: cat.emoji,
      title: s.title,
      detail: s.context ?? s.situation,
      recommendation: s.recommendation,
      risk: RISK_LABEL[s.priority],
      storyId: s.id,
    };
  });

  // Handled automatically — completed outcomes + finished automations, grouped by kind.
  const handledMap = new Map<string, number>();
  for (const it of feed.items) {
    if (it.source === "outcome" || (it.source === "automation" && it.isCompleted)) {
      handledMap.set(it.title, (handledMap.get(it.title) ?? 0) + 1);
    }
  }
  const handled: BriefingHandled[] = Array.from(handledMap.entries())
    .map(([label, count]) => ({ label: lower1(label), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    greeting: greet(now, name),
    reviewedCount: feed.summary.total,
    attention,
    handled,
    clear: attention.length === 0,
  };
}
