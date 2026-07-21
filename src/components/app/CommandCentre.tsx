/**
 * Command Centre — the ServiceOS AI Operations Cockpit. Opens with an executive daily
 * briefing, then a prioritised stream of BUSINESS STORIES (not raw events) synthesised
 * live from the intelligence backend. Approving a story routes through the EXISTING
 * intelligence-review-action endpoint → approval snapshot → automation engine → outcome;
 * the cockpit never bypasses the approval layer, audit trail or execution envelope.
 *
 * Reuses the house UI system (hairline cards, surface-alt, text-display, segmented tabs,
 * lucide, cn()) and the ApiResult query pattern. No new backend architecture.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  RotateCcw,
  Loader2,
  AlertTriangle,
  Check,
  Pencil,
  X,
  Lightbulb,
  Bot,
  Activity,
  Flag,
  CheckCircle2,
  Sparkles,
  ShieldCheck,
  Phone,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import {
  getCommandFeed,
  type CommandFeed,
  type CommandPriority,
  type CommandSource,
} from "@/lib/command-centre";
import { buildStories, buildBriefing, type Story, type StoryStatus } from "@/lib/command-stories";
import { approveAutomationIntent } from "@/lib/command-actions";
import { DailyBriefing } from "./DailyBriefing";
import { getSystemHealth } from "@/lib/system-health";
import { getCallStories, openCallDetail, type CallStory } from "@/lib/command-call-stories";
import { AuthDiagnostics } from "./AuthDiagnostics";
import type { ApiResult } from "@/lib/types";

type ViewFilter = "attention" | "recommendations" | "automated" | "completed" | "everything";
type Triage = "approved" | "dismissed";

const FILTERS: { key: ViewFilter; label: string }[] = [
  { key: "attention", label: "Needs attention" },
  { key: "recommendations", label: "Recommendations" },
  { key: "automated", label: "Automated actions" },
  { key: "completed", label: "Completed" },
  { key: "everything", label: "Everything" },
];

const PRIORITY_TONE: Record<CommandPriority, { dot: string; text: string; ring: string }> = {
  high: { dot: "bg-accent", text: "text-accent", ring: "border-l-accent" },
  medium: { dot: "bg-warning", text: "text-warning", ring: "border-l-warning" },
  low: {
    dot: "bg-muted-foreground/40",
    text: "text-muted-foreground",
    ring: "border-l-transparent",
  },
};

const STATUS_META: Record<StoryStatus, { label: string; cls: string }> = {
  needs_approval: { label: "Needs approval", cls: "border-accent/30 bg-accent/10 text-accent" },
  in_progress: { label: "Automating", cls: "border-warning/30 bg-warning/10 text-warning" },
  monitoring: { label: "Monitoring", cls: "border-hairline bg-surface-alt text-muted-foreground" },
  completed: { label: "Completed", cls: "border-success/30 bg-success/10 text-success" },
};

const SOURCE_ICON: Record<CommandSource, typeof Lightbulb> = {
  recommendation: Lightbulb,
  signal: Activity,
  action: Flag,
  automation: Bot,
  outcome: CheckCircle2,
  event: Sparkles,
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString([], {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** A story belongs to a view (honouring local triage). Dismissed → nowhere. */
function storyInView(story: Story, filter: ViewFilter, triage: Triage | undefined): boolean {
  if (triage === "dismissed") return false;
  const approved = triage === "approved";
  switch (filter) {
    case "attention":
      return (
        !approved &&
        story.priority === "high" &&
        (story.status === "needs_approval" || story.status === "monitoring")
      );
    case "recommendations":
      return story.items.some((i) => i.source === "recommendation");
    case "automated":
      return story.items.some((i) => i.isAutomated);
    case "completed":
      return approved || story.status === "completed";
    case "everything":
      return true;
  }
}

function ConfidenceMeter({ v }: { v: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, v)) * 100);
  return (
    <span className="inline-flex items-center gap-1.5" title={`Confidence ${pct}%`}>
      <span className="h-1 w-12 overflow-hidden rounded-full bg-surface-alt">
        <span className="block h-full rounded-full bg-foreground" style={{ width: `${pct}%` }} />
      </span>
      <span className="tabular text-[10px] font-medium text-muted-foreground">{pct}%</span>
    </span>
  );
}

function DetailLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="text-xs leading-relaxed">
      <span className="font-medium text-muted-foreground">{label}:</span>{" "}
      <span className="text-foreground">{children}</span>
    </p>
  );
}

function StoryCard({
  story,
  triage,
  edited,
  busy,
  confirming,
  onApprove,
  onDismiss,
  onEditChange,
}: {
  story: Story;
  triage: Triage | undefined;
  edited: string | undefined;
  busy: boolean;
  confirming: boolean;
  onApprove: () => void;
  onDismiss: () => void;
  onEditChange: (v: string | undefined) => void;
}) {
  const [editing, setEditing] = useState(false);
  const approved = triage === "approved";
  const p = PRIORITY_TONE[story.priority];
  const Icon = SOURCE_ICON[story.lead.source];
  const status = approved ? STATUS_META.completed : STATUS_META[story.status];
  const recommendation = edited ?? story.recommendation ?? "";
  const canApprove = story.approvableIntentId != null && !approved;

  return (
    <div
      className={cn(
        "flex gap-4 border-l-2 p-5 transition",
        approved ? "border-l-success bg-success/[0.04]" : p.ring,
        !approved && "hover:bg-surface-alt/30",
      )}
    >
      <div className="flex w-24 shrink-0 flex-col items-start gap-1.5 pt-0.5">
        <span className="font-mono text-[11px] text-muted-foreground">
          {fmtTime(story.timestamp)}
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-[10px] font-medium",
            approved ? "text-success" : p.text,
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", approved ? "bg-success" : p.dot)} />
          {story.priority === "high" ? "High" : story.priority === "medium" ? "Medium" : "Low"}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-hairline bg-surface-alt px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            <Icon className="h-3 w-3" />
            {story.eventType}
          </span>
          <span
            className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium", status.cls)}
          >
            {status.label}
          </span>
          {story.confidence != null && <ConfidenceMeter v={story.confidence} />}
        </div>

        <div className="text-display mt-2 text-base font-semibold leading-snug text-foreground">
          {story.title}
        </div>

        <div className="mt-2 space-y-1">
          {story.context && <DetailLine label="Context">{story.context}</DetailLine>}
          {story.situation && <DetailLine label="Situation">{story.situation}</DetailLine>}
          {story.impact && <DetailLine label="Impact">{story.impact}</DetailLine>}
          {story.recommendation && !editing && (
            <DetailLine label="Recommendation">{recommendation}</DetailLine>
          )}
          {editing && (
            <div className="pt-1">
              <textarea
                value={recommendation}
                onChange={(e) => onEditChange(e.target.value)}
                rows={3}
                className="w-full resize-y rounded-lg border border-hairline bg-white px-3 py-2 text-xs text-foreground outline-none focus:border-accent"
                placeholder="Refine the recommended action…"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Edits stay local in this view — persisting a refinement uses the response-refinement
                endpoint (next milestone).
              </p>
            </div>
          )}
        </div>

        {!approved && (canApprove || story.lead.actionable) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {canApprove ? (
              <button
                onClick={onApprove}
                disabled={busy}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium transition disabled:opacity-50",
                  confirming
                    ? "border border-accent bg-accent text-accent-foreground"
                    : "border border-foreground bg-foreground text-background hover:opacity-90",
                )}
                title="Records an immutable approval; the automation engine executes it."
              >
                {busy ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : confirming ? (
                  <ShieldCheck className="h-3 w-3" />
                ) : (
                  <Check className="h-3 w-3" />
                )}
                {busy ? "Approving…" : confirming ? "Confirm — run automation" : "Approve"}
              </button>
            ) : (
              <button
                onClick={onDismiss}
                className="inline-flex items-center gap-1.5 rounded-full border border-foreground bg-foreground px-3 py-1 text-[11px] font-medium text-background transition hover:opacity-90"
              >
                <Check className="h-3 w-3" /> Acknowledge
              </button>
            )}
            <button
              onClick={() => setEditing((v) => !v)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition",
                editing
                  ? "border-accent text-accent"
                  : "border-hairline text-muted-foreground hover:bg-surface-alt hover:text-foreground",
              )}
            >
              <Pencil className="h-3 w-3" /> {editing ? "Done" : "Edit"}
            </button>
            <button
              onClick={onDismiss}
              className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-3 py-1 text-[11px] font-medium text-muted-foreground transition hover:bg-surface-alt hover:text-foreground"
            >
              <X className="h-3 w-3" /> Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Approve a pending intent. Authenticated mode routes through the review-action
 *  endpoint; demo mode has no endpoint, so approval is a local acknowledgement. */
export type ApproveFn = (intentId: string) => Promise<ApiResult<{ note?: string }>>;

/**
 * The Command Centre presentation — data-source agnostic. It receives an already-resolved
 * CommandFeed and renders the executive briefing + prioritised business stories, owning
 * only view-local interaction state (filter, triage, edits, approval confirm). BOTH the
 * authenticated container and the demo render harness mount THIS component; no UI logic
 * is duplicated. Approval is delegated via `onApprove` (absent ⇒ a local demo ack).
 */
export function CommandCentreView({
  data,
  profileName,
  onApprove,
  onRefresh,
  refreshing = false,
}: {
  data: CommandFeed;
  profileName: string | null;
  onApprove?: ApproveFn;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const [filter, setFilter] = useState<ViewFilter>("attention");
  const [triage, setTriage] = useState<Record<string, Triage>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const stories = useMemo(() => buildStories(data.items), [data]);
  const briefing = useMemo(() => buildBriefing(data, profileName, new Date()), [data, profileName]);

  const counts = useMemo(() => {
    const c: Record<ViewFilter, number> = {
      attention: 0,
      recommendations: 0,
      automated: 0,
      completed: 0,
      everything: 0,
    };
    for (const s of stories)
      for (const f of FILTERS) if (storyInView(s, f.key, triage[s.id])) c[f.key]++;
    return c;
  }, [stories, triage]);

  const visible = useMemo(
    () => stories.filter((s) => storyInView(s, filter, triage[s.id])),
    [stories, filter, triage],
  );

  const partial = Object.values(data.sources).filter((s) => s === "unavailable").length;
  const triagedCount = Object.keys(triage).length;

  async function approve(story: Story) {
    if (!story.approvableIntentId) return;
    // Two-click confirm — a safe, premium gate for an irreversible, executing action.
    if (confirmId !== story.id) {
      setConfirmId(story.id);
      setTimeout(() => setConfirmId((c) => (c === story.id ? null : c)), 4000);
      return;
    }
    setConfirmId(null);
    // Demo/presentation mode has no approval endpoint — acknowledge locally so the same
    // component still demonstrates the human-in-the-loop gate.
    if (!onApprove) {
      setTriage((t) => ({ ...t, [story.id]: "approved" }));
      setNotice({
        tone: "success",
        text: `Approved “${story.title}” — the Automation Engine executes the reviewed action (demo view).`,
      });
      return;
    }
    setBusyId(story.id);
    const res = await onApprove(story.approvableIntentId);
    setBusyId(null);
    if (res.ok) {
      setTriage((t) => ({ ...t, [story.id]: "approved" }));
      setNotice({
        tone: "success",
        text: `Approved “${story.title}”${res.data.note ? ` — ${res.data.note}` : ""}`,
      });
      onRefresh?.();
    } else {
      setNotice({
        tone: "error",
        text: `Could not approve: ${res.error.code} — ${res.error.message}`,
      });
    }
  }

  return (
    <div className="space-y-5">
      {/* PHASE 1 — the executive briefing */}
      <DailyBriefing briefing={briefing} onOpen={() => setFilter("attention")} />

      {/* action notice */}
      {notice && (
        <div
          className={cn(
            "flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs",
            notice.tone === "success"
              ? "border-success/30 bg-success/5 text-foreground"
              : "border-destructive/30 bg-destructive/5 text-destructive",
          )}
        >
          <span>{notice.text}</span>
          <button
            onClick={() => setNotice(null)}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Filters + toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                filter === f.key
                  ? "border-foreground bg-foreground text-background"
                  : "border-hairline text-muted-foreground hover:bg-surface-alt hover:text-foreground",
              )}
            >
              {f.label}
              <span
                className={cn(
                  "tabular rounded-full px-1.5 text-[10px]",
                  filter === f.key
                    ? "bg-background/20 text-background"
                    : "bg-surface-alt text-muted-foreground",
                )}
              >
                {counts[f.key]}
              </span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {triagedCount > 0 && (
            <button
              onClick={() => {
                setTriage({});
                setEdits({});
              }}
              className="text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Reset triage ({triagedCount})
            </button>
          )}
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-alt hover:text-foreground disabled:opacity-50"
            >
              <RotateCcw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
              Refresh
            </button>
          )}
        </div>
      </div>

      {partial > 0 && (
        <div className="rounded-lg border border-warning/20 bg-warning/5 px-3 py-2 text-[11px] text-muted-foreground">
          {partial} intelligence source{partial > 1 ? "s are" : " is"} currently unavailable — the
          stream below is complete for every source that responded.
        </div>
      )}

      {/* PHASE 2 — stories, not events */}
      {visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-hairline bg-white py-16 text-center">
          <Sparkles className="mx-auto h-5 w-5 text-muted-foreground" />
          <div className="mt-2 text-sm font-medium text-foreground">Nothing in this view</div>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            {filter === "attention"
              ? "No open stories need a decision right now — you’re clear."
              : "No stories match this filter yet."}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline bg-white">
          {visible.map((s) => (
            <StoryCard
              key={s.id}
              story={s}
              triage={triage[s.id]}
              edited={edits[s.id]}
              busy={busyId === s.id}
              confirming={confirmId === s.id}
              onApprove={() => approve(s)}
              onDismiss={() => setTriage((t) => ({ ...t, [s.id]: "dismissed" }))}
              onEditChange={(v) =>
                setEdits((e) => {
                  const next = { ...e };
                  if (v == null) delete next[s.id];
                  else next[s.id] = v;
                  return next;
                })
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Authenticated container — the real product surface. Loads the tenant's live feed via
 * the RLS browser client, wires the real approval endpoint, and mounts the sensor-health
 * widgets above the shared <CommandCentreView>. This is the ONLY place the browser
 * touches Supabase; the presentation is identical to the demo harness.
 */
/**
 * Compact health warning — shown ONLY when a source materially needs attention, so
 * infrastructure status never dominates the operating view. Full detail lives under
 * Settings → System Health.
 */
function CompactHealth() {
  const [issues, setIssues] = useState<{ component: string; label: string }[]>([]);
  useEffect(() => {
    void getSystemHealth().then((r) => {
      if (!r.ok) return;
      setIssues(
        r.data.components
          .filter((c) => c.light === "failed" || c.light === "attention")
          .map((c) => ({ component: c.component, label: c.label })),
      );
    });
  }, []);
  if (issues.length === 0) return null;
  const describe = (i: { component: string; label: string }) =>
    i.component === "email_gmail" ? "Gmail reconnect required" : i.label;
  return (
    <a
      href="#/settings"
      className="flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs transition hover:bg-warning/10"
    >
      <span className="flex items-center gap-2 text-foreground">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
        {issues.length} source{issues.length === 1 ? "" : "s"} need
        {issues.length === 1 ? "s" : ""} attention: {issues.map(describe).join(", ")}
      </span>
      <span className="shrink-0 font-medium text-muted-foreground">System Health →</span>
    </a>
  );
}

/**
 * Live business stories from actionable calls — the reusable call-insight model.
 * Each story is a real call (named event, context, owner, action, confidence) and
 * clicking it opens the exact source call detail. No hard-coded call ids.
 */
function CallStories() {
  const [stories, setStories] = useState<CallStory[] | null>(null);
  useEffect(() => {
    void getCallStories(6).then((r) => setStories(r.ok ? r.data : []));
  }, []);
  if (!stories || stories.length === 0) return null;
  const owner = (o: string | null) => (o ? o.charAt(0).toUpperCase() + o.slice(1) : "Unassigned");
  return (
    <div className="rounded-2xl border border-hairline bg-white p-5">
      <div className="mb-3 flex items-center gap-2">
        <Phone className="h-4 w-4 text-accent" />
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          From your calls · action needed
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {stories.map((s) => (
          <button
            key={s.callId}
            onClick={() => openCallDetail(s.callId)}
            className="rounded-xl border border-hairline p-4 text-left transition hover:border-foreground/40"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
                {s.event}
              </span>
              {s.confidence != null && <ConfidenceMeter v={s.confidence} />}
            </div>
            <div className="mt-2 line-clamp-2 text-sm text-foreground">{s.summary}</div>
            <div className="mt-3 grid grid-cols-2 gap-2 border-t border-hairline pt-2 text-[11px] text-muted-foreground">
              <div>
                <span className="text-muted-foreground/70">Owner</span>{" "}
                <span className="font-medium text-foreground">{owner(s.owner)}</span>
              </div>
              <div className="text-right">
                <span className="text-accent">Open call →</span>
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground/70">Do</span> {s.action}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export function CommandCentre() {
  const { profile } = useAuth();
  const [feed, setFeed] = useState<ApiResult<CommandFeed> | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFeed(await getCommandFeed({ perSource: 60 }));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const data = feed && feed.ok ? feed.data : null;
  const unavailable = feed && !feed.ok ? feed.error : null;

  return (
    <div className="space-y-5">
      {/* Business items lead the operating view. Live call stories first, then a
          compact health warning only when something materially needs attention —
          full health detail lives under Settings → System Health. */}
      <CallStories />
      <CompactHealth />
      <AuthDiagnostics />

      {loading && !feed && (
        <div className="flex items-center justify-center rounded-2xl border border-hairline bg-white py-20 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Reviewing your business…
        </div>
      )}

      {unavailable && (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-6">
          <div className="flex items-center gap-2 text-sm font-medium text-destructive">
            <AlertTriangle className="h-4 w-4" />
            Command Centre unavailable
          </div>
          <div className="mt-1 font-mono text-xs text-muted-foreground">
            {unavailable.code}: {unavailable.message}
          </div>
        </div>
      )}

      {data && (
        <CommandCentreView
          data={data}
          profileName={profile?.full_name ?? null}
          onApprove={approveAutomationIntent}
          onRefresh={load}
          refreshing={loading}
        />
      )}
    </div>
  );
}
