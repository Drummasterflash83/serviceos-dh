/**
 * Learning Centre — live operator section (OpenFolk → Tenant → Command Centre → Learning).
 *
 * Read-only, tenant-scoped, provider-neutral. Fetches the dynamic `learning.overview`
 * projection and renders it across sub-tabs. Only Overview, Source Truth and Intelligence
 * function today; Waiting & Flow / Patterns / Opportunities are honestly marked not-yet-
 * available (no fabricated or decorative content). The Intelligence tab's factual queues
 * drill into the EXISTING canonical records behind each number via `learning.drill` —
 * never generating new intelligence. Absent evidence renders as an explicit honest state.
 */
import { useCallback, useEffect, useState } from "react";
import { Radio, ListTree, Search, Loader2, Clock, ChevronRight, Filter } from "lucide-react";
import { SectionCard, StatusPill, EmptyState } from "./openfolk-ui";
import { SourceCard, fmt } from "./LearningOverviewView";
import {
  getLearningOverview,
  getLearningDrill,
  getCommRelevance,
  type LearningOverview,
  type LcDrillResult,
  type LcDrillRecord,
  type CommRelevanceReport,
} from "@/lib/openfolk";

type Tab =
  "overview" | "source_truth" | "intelligence" | "waiting_flow" | "patterns" | "opportunities";
const TABS: { key: Tab; label: string; ready: boolean; soon?: string }[] = [
  { key: "overview", label: "Overview", ready: true },
  { key: "source_truth", label: "Source Truth", ready: true },
  { key: "intelligence", label: "Intelligence", ready: true },
  {
    key: "waiting_flow",
    label: "Waiting & Flow",
    ready: false,
    soon: "Needs the waiting relationship (waiting_on_ref) to be derived — it is not populated yet, so no flow can be shown without fabricating it.",
  },
  {
    key: "patterns",
    label: "Patterns",
    ready: false,
    soon: "Recurring operational themes beyond raw subject frequency are not mined yet.",
  },
  {
    key: "opportunities",
    label: "Opportunities",
    ready: false,
    soon: "Opportunity synthesis depends on Commusoft ingestion and Health, both inactive.",
  },
];

function isLiveTenant(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function duration(ms: number | null): string {
  if (ms == null) return "—";
  const abs = Math.abs(ms);
  const d = Math.floor(abs / 86_400_000);
  const h = Math.floor((abs % 86_400_000) / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const parts = d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
  return parts;
}

// Evidence excerpts come straight from raw email bodies, so they carry HTML entities and the
// zero-width tracking whitespace marketing senders inject. Decode/strip for a readable excerpt
// (display-only; the underlying canonical record is never modified).
const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&#39;": "'",
  "&apos;": "'",
  "&quot;": '"',
  "&lt;": "<",
  "&gt;": ">",
  "&nbsp;": " ",
  "&pound;": "£",
  "&euro;": "€",
  "&hellip;": "…",
  "&mdash;": "—",
  "&ndash;": "–",
};
function cleanText(s: string): string {
  // zero-width / soft-hyphen / BOM / combining-grapheme-joiner tracking chars
  let out = s.replace(/\u00AD|\u200B|\u200C|\u200D|\u2060|\u034F|\uFEFF/g, "");
  for (let i = 0; i < 2; i++) {
    out = out
      .replace(
        /&(amp|#39|apos|quot|lt|gt|nbsp|pound|euro|hellip|mdash|ndash);/g,
        (m) => ENTITIES[m] ?? m,
      )
      .replace(/&#(\d+);/g, (_, n) => {
        try {
          return String.fromCodePoint(Number(n));
        } catch {
          return _;
        }
      });
  }
  return out.replace(/\s+/g, " ").trim();
}

// The "customer" queue actually links any business-graph entity (often a sender/vendor domain),
// so present it honestly as a company/entity link rather than asserting "customer".
function displayQueueLabel(key: string, fallback: string): string {
  return key === "intel_customer" ? "Intelligence linked to a company / entity" : fallback;
}

export function LearningSection({ tenantId }: { tenantId: string }) {
  const live = isLiveTenant(tenantId);
  const [tab, setTab] = useState<Tab>("overview");
  const [overview, setOverview] = useState<LearningOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!live) {
      setLoading(false);
      return;
    }
    let on = true;
    setLoading(true);
    setError(null);
    getLearningOverview(tenantId)
      .then((r) => {
        if (!on) return;
        if (r.ok) setOverview(r.data);
        else setError(r.error.message);
      })
      .finally(() => on && setLoading(false));
    return () => {
      on = false;
    };
  }, [tenantId, live]);

  if (!live)
    return (
      <EmptyState>
        The Learning Centre reads a live tenant&apos;s canonical evidence. Open it from a real
        tenant workspace (this is a synthetic demo workspace).
      </EmptyState>
    );

  return (
    <div className="space-y-4">
      {/* Sub-navigation — future sections are visible but honestly gated */}
      <div className="flex flex-wrap gap-1 border-b border-hairline pb-2">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " +
                (active
                  ? "bg-foreground text-white"
                  : t.ready
                    ? "text-muted-foreground hover:bg-surface-alt hover:text-display"
                    : "text-muted-foreground/50 hover:bg-surface-alt/60")
              }
              title={t.ready ? undefined : "Not yet available"}
            >
              {t.label}
              {!t.ready && <span className="ml-1 text-[9px] uppercase tracking-wide">· soon</span>}
            </button>
          );
        })}
      </div>

      {loading && (
        <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading live evidence…
        </p>
      )}
      {error && (
        <div className="rounded-xl border border-destructive/30 bg-white p-4 text-sm text-muted-foreground">
          Could not load the Learning Centre: {error}
        </div>
      )}

      {!loading && !error && overview && (
        <>
          {tab === "overview" && <OverviewTab overview={overview} tenantId={tenantId} />}
          {tab === "source_truth" && <SourceTruthTab overview={overview} />}
          {tab === "intelligence" && <IntelligenceTab overview={overview} tenantId={tenantId} />}
          {!TABS.find((t) => t.key === tab)?.ready && (
            <NotYetAvailable
              label={TABS.find((t) => t.key === tab)?.label ?? ""}
              why={TABS.find((t) => t.key === tab)?.soon ?? ""}
            />
          )}
          <p className="text-[11px] text-muted-foreground">
            Generated {fmt(overview.generatedAt)} from live canonical evidence (read-only). Every
            figure is dynamically queried and traceable; empty areas are honest gaps, never
            fabricated.
          </p>
        </>
      )}
    </div>
  );
}

function SummaryBar({ overview }: { overview: LearningOverview }) {
  const { summary } = overview.sourceTruth;
  return (
    <div className="rounded-xl border border-hairline bg-surface-alt/40 p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Radio className="h-4 w-4 text-accent" />
        <span className="font-semibold text-display">Source truth</span>
        <StatusPill tone="ok">{summary.sourcesLive.length} live</StatusPill>
        <span className="text-muted-foreground">live: {summary.sourcesLive.join(", ") || "—"}</span>
        <span className="text-muted-foreground">
          · missing: {summary.sourcesMissing.join(", ") || "—"}
        </span>
        <StatusPill tone={summary.processingHealth === "ok" ? "ok" : "attention"}>
          processing {summary.processingHealth}
        </StatusPill>
        <StatusPill tone={summary.identityCoverage.confirmed > 1 ? "ok" : "attention"}>
          identity {summary.identityCoverage.pct ?? "—"}%
        </StatusPill>
        <span className="ml-auto text-muted-foreground">
          latest {fmt(summary.latestEvidenceAt)}
        </span>
      </div>
      {summary.majorBlindSpots.length > 0 && (
        <p className="mt-1.5 text-[11px] text-amber-700">
          Blind spots: {summary.majorBlindSpots.join(" · ")}
        </p>
      )}
    </div>
  );
}

function OverviewTab({ overview, tenantId }: { overview: LearningOverview; tenantId: string }) {
  const ei = overview.existingIntelligence;
  const [rel, setRel] = useState<CommRelevanceReport | null>(null);
  useEffect(() => {
    let on = true;
    getCommRelevance(tenantId).then((r) => on && r.ok && setRel(r.data));
    return () => {
      on = false;
    };
  }, [tenantId]);
  return (
    <div className="space-y-4">
      <SummaryBar overview={overview} />
      <div className="flex flex-wrap gap-3 text-xs">
        {Object.entries(ei.totals).map(([k, v]) => (
          <span key={k} className="rounded-md border border-hairline bg-surface-alt/40 px-2 py-1">
            <span className="tabular font-semibold text-display">{v}</span>{" "}
            <span className="text-muted-foreground">
              {k.replace(/([A-Z])/g, " $1").toLowerCase()}
            </span>
          </span>
        ))}
      </div>

      {rel && (
        <SectionCard
          title="Communication relevance"
          icon={<Filter className="h-4 w-4 text-muted-foreground" />}
          right={`${rel.totalCommunications} classified`}
        >
          <div className="flex flex-wrap gap-2 text-xs">
            <StatusPill tone="ok">
              {rel.byRelevance.relevant ?? 0} operationally relevant
            </StatusPill>
            <StatusPill tone="neutral">
              {rel.byRelevance.not_relevant ?? 0} excluded (marketing/system/internal-noise)
            </StatusPill>
            <StatusPill tone="attention">{rel.byRelevance.uncertain ?? 0} uncertain</StatusPill>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
            {Object.entries(rel.byClass)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => (
                <span key={k}>
                  {k.replace(/_/g, " ")} <span className="tabular text-display">{v}</span>
                </span>
              ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Applying relevance would exclude ~{rel.exclusion.recommendationsExcluded}{" "}
            recommendations ({rel.exclusion.recommendationsOpenExcluded} open) from operational
            queues. {rel.caveat}
          </p>
        </SectionCard>
      )}
    </div>
  );
}

function SourceTruthTab({ overview }: { overview: LearningOverview }) {
  return (
    <div className="space-y-4">
      <SummaryBar overview={overview} />
      <SectionCard
        title="Source truth — per source"
        icon={<Radio className="h-4 w-4 text-muted-foreground" />}
      >
        <div className="space-y-2">
          {overview.sourceTruth.sources.map((s) => (
            <SourceCard key={s.key} s={s} />
          ))}
        </div>
      </SectionCard>
    </div>
  );
}

function IntelligenceTab({ overview, tenantId }: { overview: LearningOverview; tenantId: string }) {
  const ei = overview.existingIntelligence;
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [drill, setDrill] = useState<LcDrillResult | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillError, setDrillError] = useState<string | null>(null);

  const onDrill = useCallback(
    (key: string) => {
      if (openKey === key) {
        setOpenKey(null);
        setDrill(null);
        return;
      }
      setOpenKey(key);
      setDrill(null);
      setDrillError(null);
      setDrillLoading(true);
      getLearningDrill(tenantId, key)
        .then((r) => {
          if (r.ok) setDrill(r.data);
          else setDrillError(r.error.message);
        })
        .finally(() => setDrillLoading(false));
    },
    [openKey, tenantId],
  );

  return (
    <SectionCard
      title="Existing intelligence"
      icon={<ListTree className="h-4 w-4 text-muted-foreground" />}
      right={`${ei.totals.intelligenceObjects} objects`}
    >
      <div className="mb-1 text-[11px] font-medium text-muted-foreground">
        Factual queues (click to open the underlying records)
      </div>
      {ei.queues.map((q) => (
        <div key={q.key}>
          <button
            type="button"
            onClick={() => (q.note ? undefined : onDrill(q.key))}
            disabled={!!q.note}
            className={
              "flex w-full items-center gap-2 border-b border-hairline py-1.5 text-left last:border-0 " +
              (q.note ? "cursor-default opacity-70" : "hover:bg-surface-alt/40")
            }
            title={q.note ?? `Open records — ${displayQueueLabel(q.key, q.label)}`}
          >
            <span className="tabular w-14 shrink-0 text-sm font-semibold text-display">
              {q.count}
            </span>
            <span className="flex-1 text-xs text-display">{displayQueueLabel(q.key, q.label)}</span>
            {q.note ? (
              <span className="text-[10px] text-muted-foreground">{q.note}</span>
            ) : openKey === q.key ? (
              <ChevronRight className="h-3.5 w-3.5 rotate-90 text-accent transition-transform" />
            ) : (
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </button>
          {openKey === q.key && (
            <DrillPanel
              loading={drillLoading}
              error={drillError}
              drill={drill}
              fallbackLabel={displayQueueLabel(q.key, q.label)}
            />
          )}
        </div>
      ))}

      <div className="mt-3 space-y-1 text-xs">
        <div className="text-[11px] font-medium text-muted-foreground">Repeated themes</div>
        {ei.repeatedThemes.length === 0 ? (
          <span className="text-muted-foreground">none</span>
        ) : (
          ei.repeatedThemes.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="tabular w-10 text-display">×{t.count}</span>
              <span className="text-muted-foreground">{cleanText(t.subject)}</span>
            </div>
          ))
        )}
      </div>

      <p
        className={
          "mt-3 rounded-md border border-dashed border-hairline px-2 py-1.5 text-[11px] " +
          (ei.waiting.derived ? "text-muted-foreground" : "text-amber-700")
        }
      >
        {ei.waiting.note}
      </p>
    </SectionCard>
  );
}

function DrillPanel({
  loading,
  error,
  drill,
  fallbackLabel,
}: {
  loading: boolean;
  error: string | null;
  drill: LcDrillResult | null;
  fallbackLabel: string;
}) {
  return (
    <div className="my-2 rounded-md border border-accent/30 bg-accent/5 p-2.5">
      {loading && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading records for {fallbackLabel}…
        </p>
      )}
      {error && <p className="text-xs text-destructive">Could not load records: {error}</p>}
      {!loading && !error && drill && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-display">
              {displayQueueLabel(drill.queueKey, drill.label)}
            </span>
            <StatusPill tone="info">
              {drill.returned}
              {drill.truncated ? "+" : ""} shown
            </StatusPill>
            {drill.truncated && (
              <span className="text-[10px] text-muted-foreground">
                first {drill.returned} of the queue (read-only preview)
              </span>
            )}
          </div>

          {drill.records.length === 0 && !drill.drillable && (
            <p className="text-[11px] text-amber-700">
              {drill.note ?? "Record-level drill is not available for this derived aggregate."}
            </p>
          )}
          {drill.records.length === 0 && drill.drillable && (
            <p className="text-[11px] text-muted-foreground">No records in this queue.</p>
          )}

          {drill.records.map((r) => (
            <DrillRow key={r.id} r={r} />
          ))}

          {/* Evidence and provenance — the canonical trace is retained here */}
          <div className="mt-1 rounded border border-hairline bg-white/60 px-2 py-1.5 text-[10px] text-muted-foreground">
            <span className="font-semibold uppercase tracking-wide">Evidence and provenance</span> —
            traces to <code>{drill.trace.table}</code> where <code>{drill.trace.filter}</code>.
            Records are existing canonical rows fetched read-only; no new intelligence is generated.
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="text-muted-foreground">
      {label} <span className="text-display">{children}</span>
    </span>
  );
}

function DrillRow({ r }: { r: LcDrillRecord }) {
  return (
    <div className="rounded border border-hairline bg-white p-2 text-[11px]">
      <div className="flex flex-wrap items-center gap-1.5">
        {r.objectType && <StatusPill tone="neutral">{r.objectType}</StatusPill>}
        <span className="font-medium text-display">{r.subject}</span>
        {r.isOverdue && (
          <StatusPill tone="attention">
            <Clock className="mr-0.5 inline h-3 w-3" />
            {duration(r.overdueMs)} overdue
          </StatusPill>
        )}
        {r.owner.state === "unresolved" ? (
          <StatusPill tone="attention">owner unresolved</StatusPill>
        ) : (
          <StatusPill tone="ok">owner {r.owner.label}</StatusPill>
        )}
      </div>
      <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-3">
        {r.deadline && <Field label="deadline">{fmt(r.deadline)}</Field>}
        {r.occurredAt && <Field label="occurred">{fmt(r.occurredAt)}</Field>}
        {r.elapsedMs != null && <Field label="elapsed">{duration(r.elapsedMs)}</Field>}
        {r.customer && <Field label="linked entity">{r.customer}</Field>}
        {r.status && <Field label="status">{r.status}</Field>}
        {r.confidence != null && (
          <Field label="confidence">{Math.round(r.confidence * 100)}%</Field>
        )}
        {r.source?.type && <Field label="source">{r.source.type}</Field>}
      </div>
      {r.evidenceExcerpt && cleanText(r.evidenceExcerpt) && (
        <p className="mt-1 line-clamp-2 border-l-2 border-hairline pl-2 text-muted-foreground">
          “{cleanText(r.evidenceExcerpt)}”
        </p>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
        <span>Why: {r.whyQualified}</span>
        {r.source?.interactionId && (
          <span className="text-muted-foreground/80" title={r.source.interactionId}>
            source ref {r.source.ref ? r.source.ref : r.source.interactionId.slice(0, 8)}
          </span>
        )}
      </div>
    </div>
  );
}

function NotYetAvailable({ label, why }: { label: string; why: string }) {
  return (
    <SectionCard title={label} icon={<ListTree className="h-4 w-4 text-muted-foreground" />}>
      <div className="rounded-md border border-dashed border-hairline bg-surface-alt/30 px-3 py-4">
        <div className="text-sm font-medium text-display">Not yet available</div>
        <p className="mt-1 text-xs text-muted-foreground">{why}</p>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          This section is intentionally empty rather than showing fabricated data.
        </p>
      </div>
    </SectionCard>
  );
}
