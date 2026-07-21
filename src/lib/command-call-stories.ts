/**
 * Live call-insight stories — a reusable model that turns actionable phone calls
 * (phone_ai_insights) into Command Centre business stories. No hard-coded call ids:
 * it queries the tenant's actionable calls generically (RLS-scoped) and each story
 * links back to its real source call via `callId` (opens the call detail).
 */
import { getSupabaseClient, isSupabaseConfigured } from "./supabase";
import type { ApiResult } from "./types";

export interface CallStory {
  callId: string; // phone_calls.id — the source link (opens CallDetail)
  event: string; // headline: what happened, derived from intent
  summary: string; // the AI summary (the real context)
  owner: string | null; // suggested owner (office/manager/engineer)
  action: string; // recommended next action
  intent: string | null;
  urgency: string | null;
  confidence: number | null;
  occurredAt: string;
}

// Which intents are genuine business stories worth surfacing (actionable calls).
const STORY_INTENTS: Record<string, { event: string; action: string }> = {
  site_visit_request: {
    event: "Site visit requested",
    action: "Assign an owner and propose visit dates",
  },
  schedule_visit: { event: "Visit to arrange", action: "Confirm attendees and lock a date" },
  service_scheduling: {
    event: "Service appointment",
    action: "Confirm the slot and assign an engineer",
  },
  callback_request: { event: "Callback requested", action: "Return the call" },
  quote_request: { event: "Quote requested", action: "Prepare and send a quote" },
  complaint: { event: "Complaint raised", action: "Call the customer to resolve it" },
};

function eventFor(intent: string | null): { event: string; action: string } {
  return (
    (intent && STORY_INTENTS[intent]) || {
      event: "Needs a response",
      action: "Review the call and take the next best action",
    }
  );
}

/** Actionable call stories, most recent first. */
export async function getCallStories(limit = 6): Promise<ApiResult<CallStory[]>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("phone_ai_insights")
    .select(
      "call_id, summary, intent, urgency, action_required, suggested_owner, confidence, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(80);
  if (error) {
    return { ok: false, error: { code: "call_stories_unavailable", message: error.message } };
  }
  const rows = (data ?? []) as Record<string, unknown>[];
  const stories: CallStory[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const intent = (r.intent as string | null) ?? null;
    const actionRequired = r.action_required === true;
    // A story is an actionable call: either flagged action-required or a known
    // business intent. Skip voicemail/no-op summaries and duplicates per call.
    const isStoryIntent = intent != null && intent in STORY_INTENTS;
    if (!actionRequired && !isStoryIntent) continue;
    const callId = r.call_id as string | null;
    if (!callId || seen.has(callId)) continue;
    const summary = (r.summary as string | null) ?? "";
    if (!summary || /voicemail|no available participant|unavailable recipient/i.test(summary))
      continue;
    seen.add(callId);
    const meta = eventFor(intent);
    stories.push({
      callId,
      event: meta.event,
      summary,
      owner: (r.suggested_owner as string | null) ?? null,
      action: meta.action,
      intent,
      urgency: (r.urgency as string | null) ?? null,
      confidence: typeof r.confidence === "number" ? (r.confidence as number) : null,
      occurredAt: (r.created_at as string) ?? "",
    });
    if (stories.length >= limit) break;
  }
  return { ok: true, data: stories };
}

/** Deep-link helper: stash the target call and route to Communications, which opens it. */
export function openCallDetail(callId: string): void {
  try {
    window.sessionStorage.setItem("serviceos:openCall", callId);
  } catch {
    /* ignore storage errors */
  }
  window.location.hash = "#/communications";
}
