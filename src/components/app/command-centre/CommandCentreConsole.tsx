/**
 * CommandCentreConsole — the role-specific operating surface.
 *
 * Data-source-agnostic (like the legacy CommandCentreView): it renders a resolved
 * WorkProjection + honest extras, so the authenticated container and the demo/proof route
 * mount the SAME component. No backend/authority logic lives here — ranking, folding and
 * permission all come from the server (work-projection / work-transition / user-ownership).
 * Sections render honest empty / "not yet measurable" / Preview states rather than fake data.
 */
import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Clock,
  Flag,
  GraduationCap,
  ListChecks,
  ShieldAlert,
  Target,
  TriangleAlert,
  UserCog,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Oversight, WorkItem, WorkProjection, WorkVerb } from "@/lib/command-work";

// ── honest extras the projection doesn't yet compute live (fixtures populate; live = empty) ─
export interface ConsoleExtras {
  objectives?: {
    title: string;
    metric: string | null;
    target: string | null;
    current: string | null;
    health: string | null;
    freshness: string;
    note: string | null;
  }[];
  learning?: { kind: string; detail: string; when: string }[];
  cadence?: { name: string; date: string; number: string | null; missing: string | null }[] | null;
  health?: { label: string; status: string; detail: string }[];
  leadership?: {
    profitLeakage: string | null;
    trappedCapacity: string | null;
    interventionValue: string | null;
  };
}
export interface ConsoleProps {
  projection: WorkProjection;
  extras?: ConsoleExtras;
  /** false in demo / View-As read-only / before deploy → actions disabled with an honest label. */
  writeCapable: boolean;
  writeLabel?: string; // e.g. "Read only", "Preview — not connected"
  onTransition?: (item: WorkItem, verb: WorkVerb) => void;
  banner?: ReactNode; // ViewAsBar mounts here
}

const EYEBROW = "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";
function Panel({
  title,
  icon,
  count,
  children,
  tone,
}: {
  title: string;
  icon: ReactNode;
  count?: number | null;
  children: ReactNode;
  tone?: "danger";
}) {
  return (
    <section
      className={cn(
        "rounded-xl border bg-white p-4 sm:p-5",
        tone === "danger" ? "border-destructive/30" : "border-hairline",
      )}
    >
      <header className="mb-3 flex items-center gap-2">
        <span className={cn("text-muted-foreground", tone === "danger" && "text-destructive")}>
          {icon}
        </span>
        <h2 className="text-sm font-semibold text-display">{title}</h2>
        {count != null && (
          <span className="ml-auto rounded-full bg-surface-alt px-2 py-0.5 text-[11px] tabular text-muted-foreground">
            {count}
          </span>
        )}
      </header>
      {children}
    </section>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return <p className="text-[13px] text-muted-foreground">{children}</p>;
}
function stateBadge(state: string) {
  const map: Record<string, string> = {
    proposed: "bg-surface-alt text-muted-foreground",
    ready: "bg-accent/10 text-accent",
    in_progress: "bg-blue-500/10 text-blue-600",
    waiting: "bg-amber-500/10 text-amber-600",
    blocked: "bg-destructive/10 text-destructive",
    escalated: "bg-destructive/15 text-destructive",
  };
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        map[state] ?? "bg-surface-alt text-muted-foreground",
      )}
    >
      {state.replace("_", " ")}
    </span>
  );
}
const isSafety = (w: WorkItem) =>
  /h&s|safety|rams|compliance|gas\s*safe|hazard|unsafe|legal/i.test(w.title + (w.blocker ?? ""));
function dueLabel(dueAt: string | null): { text: string; overdue: boolean } | null {
  if (!dueAt) return null;
  const d = new Date(dueAt),
    now = Date.now();
  const overdue = d.getTime() < now;
  const days = Math.round((d.getTime() - now) / 8.64e7);
  return {
    text: overdue
      ? "overdue"
      : days <= 0
        ? "due today"
        : days === 1
          ? "due tomorrow"
          : `due in ${days}d`,
    overdue,
  };
}

// ═══ A. My position now ══════════════════════════════════════════════════════
function PositionSummary({ p }: { p: WorkProjection }) {
  const tiles: { n: number; label: string; tone?: string }[] = [
    { n: p.position.urgent, label: "urgent", tone: "text-destructive" },
    { n: p.position.dueToday, label: "due today" },
    { n: p.position.waitingOnYou, label: "waiting on you" },
    { n: p.position.handledAutomatically, label: "handled automatically", tone: "text-success" },
    { n: p.position.automationActive, label: "automation active" },
    { n: p.position.blocked, label: "blocked", tone: "text-destructive" },
    { n: p.position.objectivesAtRisk, label: "objective at risk", tone: "text-amber-600" },
  ];
  const hour = new Date(p.generatedAt).getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  // Name fallback: preferred/full name → first name → email local-part.
  const greetingName = p.user.displayName?.trim().split(/\s+/)[0] || p.user.userRef.split("@")[0];
  return (
    <section className="rounded-xl border border-hairline bg-white p-5">
      <p className={EYEBROW}>Your position now{p.user.isLeadership ? " · leadership" : ""}</p>
      <h1 className="mt-1 text-xl font-semibold text-display">
        {greeting}, {greetingName}
      </h1>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {tiles.map((t) => (
          <div
            key={t.label}
            className="rounded-lg border border-hairline bg-surface-alt/40 px-3 py-2"
          >
            <div className={cn("text-2xl font-semibold tabular", t.tone ?? "text-display")}>
              {t.n}
            </div>
            <div className="text-[11px] leading-tight text-muted-foreground">{t.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ═══ B. Do next ══════════════════════════════════════════════════════════════
const ACTIONS: { verb: WorkVerb; label: string }[] = [
  { verb: "acknowledge", label: "Acknowledge" },
  { verb: "start", label: "Start" },
  { verb: "complete", label: "Complete" },
  { verb: "wait", label: "Waiting" },
  { verb: "block", label: "Blocked" },
  { verb: "dismiss", label: "Dismiss" },
];
function WorkCard({
  item,
  writeCapable,
  writeLabel,
  onTransition,
  rank,
}: {
  item: WorkItem;
  writeCapable: boolean;
  writeLabel?: string;
  onTransition?: (i: WorkItem, v: WorkVerb) => void;
  rank: number;
}) {
  const [open, setOpen] = useState(false);
  const due = dueLabel(item.dueAt);
  return (
    <li
      className={cn(
        "rounded-lg border p-3",
        isSafety(item) ? "border-destructive/40 bg-destructive/5" : "border-hairline",
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-[11px] font-semibold tabular text-muted-foreground">
          {rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {isSafety(item) && <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-destructive" />}
            <span className="text-sm font-medium text-display">{item.title}</span>
            {stateBadge(item.state)}
            {due && (
              <span
                className={cn(
                  "text-[11px]",
                  due.overdue ? "text-destructive" : "text-muted-foreground",
                )}
              >
                · {due.text}
              </span>
            )}
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">
            <span className="font-medium text-foreground">Why:</span> {item.explanation.whyHere}
            {item.explanation.whyYours && (
              <>
                {" "}
                · <span className="font-medium text-foreground">Yours:</span>{" "}
                {item.explanation.whyYours}
              </>
            )}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {item.objectiveTitle && (
              <span className="inline-flex items-center gap-1">
                <Target className="h-3 w-3" />
                {item.objectiveTitle}
                {item.objectiveHealth ? ` (${item.objectiveHealth})` : ""}
              </span>
            )}
            {item.kpi ? (
              <span>KPI: {item.kpi}</span>
            ) : item.objectiveId ? (
              <span className="italic">KPI not measured</span>
            ) : null}
            {item.accountableOwner && (
              <span className="inline-flex items-center gap-1">
                <UserCog className="h-3 w-3" />
                {item.accountableOwner}
              </span>
            )}
            {item.confidence != null && <span>conf {Math.round(item.confidence * 100)}%</span>}
          </div>
          {item.unresolved.length > 0 && (
            <p className="mt-1 text-[11px] text-amber-600">
              Needs review: {item.unresolved.join(", ").replace(/_/g, " ")}
            </p>
          )}
          <button
            onClick={() => setOpen(!open)}
            className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-accent"
          >
            <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />{" "}
            {open ? "less" : "why this, what proves done"}
          </button>
          {open && (
            <div className="mt-2 space-y-1 rounded-md bg-surface-alt/50 p-2 text-[11px] text-muted-foreground">
              {item.explanation.whyAboveNext && (
                <p>
                  <span className="font-medium text-foreground">Ranks above next:</span>{" "}
                  {item.explanation.whyAboveNext}
                </p>
              )}
              {item.explanation.consequenceOfDelay && (
                <p>
                  <span className="font-medium text-foreground">If delayed:</span>{" "}
                  {item.explanation.consequenceOfDelay}
                </p>
              )}
              {item.recommendedAction && (
                <p>
                  <span className="font-medium text-foreground">Recommended:</span>{" "}
                  {item.recommendedAction}
                </p>
              )}
              {item.doneWhen && (
                <p>
                  <span className="font-medium text-foreground">Done when:</span> {item.doneWhen}
                </p>
              )}
              {item.explanation.aiCanHandle && (
                <p>
                  <span className="font-medium text-foreground">Automation:</span>{" "}
                  {item.explanation.aiCanHandle}
                </p>
              )}
              {item.explanation.humanJudgement && (
                <p>
                  <span className="font-medium text-foreground">Your judgement:</span>{" "}
                  {item.explanation.humanJudgement}
                </p>
              )}
              {item.evidence.length > 0 && (
                <p>
                  <span className="font-medium text-foreground">Evidence:</span>{" "}
                  {item.evidence.length} signal(s) folded —{" "}
                  {item.evidence
                    .map((e) => e.detail ?? e.kind)
                    .slice(0, 3)
                    .join("; ")}
                </p>
              )}
              <p className="text-[10px] opacity-70">
                factors:{" "}
                {item.explanation.factors
                  .slice(0, 4)
                  .map((f) => `${f.factor} +${f.contribution}`)
                  .join(", ")}
              </p>
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {ACTIONS.map((a) => (
              <button
                key={a.verb}
                disabled={!writeCapable}
                onClick={() => onTransition?.(item, a.verb)}
                title={!writeCapable ? (writeLabel ?? "Not available") : undefined}
                className={cn(
                  "rounded-md border px-2 py-1 text-[11px] font-medium",
                  writeCapable
                    ? "border-hairline text-foreground hover:bg-surface-alt"
                    : "border-hairline/60 text-muted-foreground/50 cursor-not-allowed",
                )}
              >
                {a.label}
              </button>
            ))}
            {!writeCapable && (
              <span className="text-[10px] text-muted-foreground">{writeLabel ?? "Read only"}</span>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
function DoNextSection({
  p,
  writeCapable,
  writeLabel,
  onTransition,
}: ConsoleProps & { p: WorkProjection }) {
  return (
    <Panel title="Do next" icon={<ListChecks className="h-4 w-4" />} count={p.doNext.length}>
      {p.doNext.length === 0 ? (
        <Empty>No priority operational actions are currently assigned to you.</Empty>
      ) : (
        <ol className="space-y-2">
          {p.doNext.map((item, i) => (
            <WorkCard
              key={item.id}
              item={item}
              rank={i + 1}
              writeCapable={writeCapable}
              writeLabel={writeLabel}
              onTransition={onTransition}
            />
          ))}
        </ol>
      )}
      <p className="mt-2 text-[10px] text-muted-foreground">
        {p.consolidation.recommendationsFoldedAsEvidence} signal(s) folded as evidence ·{" "}
        {p.consolidation.routedToReview} routed to review · ranked by {p.weightsVersion}
      </p>
    </Panel>
  );
}

// ═══ C–J. remaining sections ═════════════════════════════════════════════════
function WaitingOnMeSection({ items }: { items: WorkItem[] }) {
  const waiting = items.filter((w) => w.state === "waiting" || w.state === "blocked");
  return (
    <Panel title="Waiting on me" icon={<Clock className="h-4 w-4" />} count={waiting.length}>
      {waiting.length === 0 ? (
        <Empty>Nothing is currently blocked on you.</Empty>
      ) : (
        <ul className="space-y-1.5">
          {waiting.map((w) => (
            <li key={w.id} className="flex items-center gap-2 text-[13px]">
              {stateBadge(w.state)}
              <span className="text-display">{w.title}</span>
              {w.waitingOn && (
                <span className="text-[11px] text-muted-foreground">· {w.waitingOn}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
function MyAgentsSection({ items }: { items: WorkItem[] }) {
  const acts = items.flatMap((w) => w.agentActivity.map((a) => ({ ...a, title: w.title })));
  return (
    <Panel
      title="My agents & automation"
      icon={<Bot className="h-4 w-4" />}
      count={acts.length || null}
    >
      {acts.length === 0 ? (
        <Empty>No active agents or automations are currently assigned to your work.</Empty>
      ) : (
        <ul className="space-y-1.5">
          {acts.map((a) => (
            <li key={a.intentId} className="flex items-center gap-2 text-[13px]">
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] uppercase",
                  /fail|block|error/i.test(a.status)
                    ? "bg-destructive/10 text-destructive"
                    : "bg-surface-alt text-muted-foreground",
                )}
              >
                {a.status}
              </span>
              <span className="text-display">{a.title}</span>
              <span className="ml-auto text-[11px] text-muted-foreground">
                {a.outcome ?? "outcome not yet measured"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
function MyAreaSection({ items, isLeadership }: { items: WorkItem[]; isLeadership: boolean }) {
  const overdue = items.filter((w) => w.dueAt && new Date(w.dueAt).getTime() < Date.now());
  const unowned = items.filter((w) => w.unresolved.includes("owner"));
  return (
    <Panel
      title={isLeadership ? "My area & business" : "My area"}
      icon={<Users className="h-4 w-4" />}
    >
      <ul className="space-y-1 text-[13px] text-muted-foreground">
        <li>
          <span className="tabular text-display">{items.length}</span> active work items in your
          scope
        </li>
        <li>
          <span className="tabular text-display">{overdue.length}</span> overdue ·{" "}
          <span className="tabular text-display">{unowned.length}</span> with unresolved owner
        </li>
        {isLeadership && (
          <li className="text-[12px] italic">
            Profit leakage, trapped capacity & role-transition tracking — not yet measurable
            (finance/Commusoft source not connected).
          </li>
        )}
      </ul>
    </Panel>
  );
}
function ObjectiveMovementSection({
  items,
  extras,
}: {
  items: WorkItem[];
  extras?: ConsoleExtras;
}) {
  const derived =
    extras?.objectives ??
    Array.from(
      new Map(
        items
          .filter((w) => w.objectiveTitle)
          .map((w) => [
            w.objectiveTitle!,
            {
              title: w.objectiveTitle!,
              metric: w.kpi,
              target: null as string | null,
              current: null as string | null,
              health: w.objectiveHealth,
              freshness: "Target configured; live actual unavailable",
              note: null as string | null,
            },
          ]),
      ).values(),
    );
  return (
    <Panel
      title="Objective movement"
      icon={<Flag className="h-4 w-4" />}
      count={derived.length || null}
    >
      {derived.length === 0 ? (
        <Empty>No objectives linked to your current work.</Empty>
      ) : (
        <ul className="space-y-2">
          {derived.map((o) => (
            <li key={o.title} className="rounded-md border border-hairline p-2">
              <div className="flex items-center gap-2 text-[13px]">
                <span className="font-medium text-display">{o.title}</span>
                {o.health && (
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] uppercase",
                      /risk|red|off|breach/i.test(o.health)
                        ? "bg-amber-500/10 text-amber-600"
                        : "bg-success/10 text-success",
                    )}
                  >
                    {o.health}
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {o.metric ? (
                  <>
                    KPI {o.metric}: {o.current ?? "measurement unavailable"}
                    {o.target ? ` / target ${o.target}` : ""}
                  </>
                ) : (
                  "Measurement unavailable — baseline not connected"
                )}{" "}
                · {o.freshness}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
function AutomationHandledSection({ p }: { p: WorkProjection }) {
  return (
    <Panel
      title="AI & automation handled"
      icon={<CheckCircle2 className="h-4 w-4" />}
      count={p.position.handledAutomatically || null}
    >
      {p.position.handledAutomatically === 0 && p.position.automationActive === 0 ? (
        <Empty>No automation activity recorded for your work yet.</Empty>
      ) : (
        <ul className="space-y-1 text-[13px] text-muted-foreground">
          <li>
            <span className="tabular text-display">{p.position.handledAutomatically}</span> handled
            automatically ·{" "}
            <span className="tabular text-display">{p.position.automationActive}</span> in progress
          </li>
          <li className="text-[12px] italic">
            Time/cost/revenue value — not yet measurable (requires outcome provenance).
          </li>
        </ul>
      )}
    </Panel>
  );
}
function OperatingReviewSection({ extras }: { extras?: ConsoleExtras }) {
  const cadence = extras?.cadence;
  return (
    <Panel title="Upcoming operating review" icon={<CalendarClock className="h-4 w-4" />}>
      {!cadence || cadence.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          Preview — operating cadence not yet modelled for this tenant.
        </p>
      ) : (
        <ul className="space-y-1 text-[13px]">
          {cadence.map((c) => (
            <li key={c.name} className="flex items-center gap-2">
              <span className="text-display">{c.name}</span>
              <span className="text-[11px] text-muted-foreground">
                {c.date}
                {c.number ? ` · ${c.number}` : ""}
              </span>
              {c.missing && <span className="ml-auto text-[11px] text-amber-600">{c.missing}</span>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
function RecentLearningSection({ extras }: { extras?: ConsoleExtras }) {
  const learning = extras?.learning ?? [];
  return (
    <Panel
      title="Recent learning"
      icon={<GraduationCap className="h-4 w-4" />}
      count={learning.length || null}
    >
      {learning.length === 0 ? (
        <Empty>No recent corrections or learning captured.</Empty>
      ) : (
        <ul className="space-y-1 text-[13px] text-muted-foreground">
          {learning.map((l, i) => (
            <li key={i}>
              <span className="font-medium text-display">{l.kind}:</span> {l.detail}{" "}
              <span className="text-[11px] opacity-70">· {l.when}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
function CompactSystemHealth({ extras }: { extras?: ConsoleExtras }) {
  const health = (extras?.health ?? []).filter((h) => h.status !== "ok");
  if (health.length === 0) return null;
  return (
    <section className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
        <span className="text-[12px] font-medium text-amber-700">System</span>
      </div>
      <ul className="mt-1 space-y-0.5 text-[11px] text-amber-700/90">
        {health.map((h) => (
          <li key={h.label}>
            {h.label}: {h.detail}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ═══ Console composition ═════════════════════════════════════════════════════
// ═══ Tenant-Superadmin: input → work intelligence oversight ══════════════════
function Funnel({ label, n, sub }: { label: string; n: number; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-hairline/60 py-1 text-[12px] last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular font-medium text-display">
        {n.toLocaleString()}
        {sub && <span className="ml-1 text-[10px] font-normal text-muted-foreground">{sub}</span>}
      </span>
    </div>
  );
}
function OversightSection({ o }: { o: Oversight }) {
  const [open, setOpen] = useState(true);
  const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "—");
  return (
    <Panel
      title="Input & intelligence oversight"
      icon={<Bot className="h-4 w-4" />}
      count={o.inputs.total}
    >
      <p className="-mt-1 mb-2 text-[11px] text-muted-foreground">
        Tenant-Superadmin only · how source inputs convert to work ({o.period.replace("_", " ")})
      </p>
      <button
        onClick={() => setOpen(!open)}
        className="mb-2 inline-flex items-center gap-1 text-[11px] text-accent"
      >
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />{" "}
        {open ? "hide" : "show"} funnel
      </button>
      {open && (
        <div className="space-y-0.5">
          <Funnel
            label="Inputs (calls + emails)"
            n={o.inputs.total}
            sub={`${o.inputs.phone} phone · ${o.inputs.email} email`}
          />
          <Funnel
            label="Identity resolved (people)"
            n={o.identity.peopleIdentified}
            sub={`${o.identity.unresolvedIdentity} unresolved`}
          />
          <Funnel label="Companies matched" n={o.identity.companiesIdentified} />
          <Funnel
            label="Jobs / sites matched"
            n={o.identity.jobsMatched + o.identity.sitesMatched}
            sub={
              o.identity.jobsMatched + o.identity.sitesMatched === 0
                ? "Commusoft not connected"
                : undefined
            }
          />
          <Funnel
            label="Observations created"
            n={o.interpretation.observations}
            sub={pct(o.interpretation.observations, o.inputs.total)}
          />
          <Funnel
            label="Recommendations"
            n={o.interpretation.recommendations}
            sub={`${o.interpretation.recommendationsOpen} open`}
          />
          <Funnel
            label="Meaningful work created"
            n={o.work.meaningfulActions}
            sub={`of ${o.work.totalActionObjects} actions`}
          />
          <Funnel label="Handled automatically" n={o.work.handledAutomatically} />
          <Funnel
            label="Automation active runs"
            n={o.automation.activeRuns}
            sub={`${o.automation.awaitingApproval} awaiting`}
          />
          <Funnel
            label="Executions · outcomes"
            n={o.automation.executions}
            sub={`${o.work.outcomes} outcomes`}
          />
        </div>
      )}
      {o.exceptions.fallbackNonActionable.count > 0 && (
        <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-amber-700">
            <AlertTriangle className="h-3.5 w-3.5" /> Observation fallback policy generated
            non-actionable records
          </div>
          <p className="mt-1 text-[11px] text-amber-700/90">
            <span className="tabular font-semibold">
              {o.exceptions.fallbackNonActionable.count.toLocaleString()}
            </span>{" "}
            records were created by a now-
            <span className="font-medium">
              {o.exceptions.fallbackNonActionable.policyState}
            </span>{" "}
            policy. No meaningful operational outcome was resolved. Evidence is preserved; excluded
            from all normal work.
          </p>
        </div>
      )}
    </Panel>
  );
}

export function CommandCentreConsole(props: ConsoleProps) {
  const { projection: p, extras, banner } = props;
  return (
    <div className="space-y-4">
      {banner}
      <PositionSummary p={p} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <DoNextSection {...props} p={p} />
          <WaitingOnMeSection items={p.all} />
          <MyAreaSection items={p.all} isLeadership={p.user.isLeadership} />
          {p.user.isLeadership && <ObjectiveMovementSection items={p.all} extras={extras} />}
        </div>
        <div className="space-y-4">
          {p.oversight && <OversightSection o={p.oversight} />}
          <MyAgentsSection items={p.all} />
          {!p.user.isLeadership && <ObjectiveMovementSection items={p.all} extras={extras} />}
          <AutomationHandledSection p={p} />
          <OperatingReviewSection extras={extras} />
          <RecentLearningSection extras={extras} />
          <CompactSystemHealth extras={extras} />
        </div>
      </div>
    </div>
  );
}
