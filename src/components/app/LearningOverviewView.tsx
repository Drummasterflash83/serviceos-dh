/**
 * Learning Centre — Stage 1 views (Source Truth + Existing Intelligence), read-only.
 *
 * Additive to the existing LearningCentre surface (which renders the architecture-doc four
 * sections). This component renders the operator's two Stage-1 questions from the dynamic
 * `learning.overview` projection: (1) exactly what OpenFolk can currently see per source, how
 * fresh & complete it is, and (2) what the existing intelligence pipeline has produced — as real
 * counts + factual, drillable queues. No hard-coded figures; absent evidence = an honest state;
 * no speculative Health scores; no fabricated Commusoft or waiting data.
 */
import { useState } from "react";
import { Radio, Phone, Mail, Database, MessageSquare, Brain, ListTree, Search } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SectionCard, StatusPill, EmptyState, type Tone } from "./openfolk-ui";
import type { LearningOverview, LcSourceStatus, LcIntelQueue } from "@/lib/openfolk";

const CONN_TONE: Record<string, Tone> = {
  live: "ok",
  foundation: "info",
  planned: "neutral",
  not_connected: "neutral",
};
const FRESH_TONE: Record<string, Tone> = {
  fresh: "ok",
  recent: "info",
  stale: "attention",
  none: "neutral",
};
const SOURCE_ICON: Record<string, ReactNode> = {
  telephony: <Phone className="h-4 w-4 text-muted-foreground" />,
  email: <Mail className="h-4 w-4 text-muted-foreground" />,
  commusoft: <Database className="h-4 w-4 text-muted-foreground" />,
  slack: <MessageSquare className="h-4 w-4 text-muted-foreground" />,
  pipeline: <Brain className="h-4 w-4 text-muted-foreground" />,
};

export function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export function SourceCard({ s }: { s: LcSourceStatus }) {
  return (
    <div className="rounded-lg border border-hairline p-3">
      <div className="flex flex-wrap items-center gap-2">
        {SOURCE_ICON[s.key]}
        <span className="text-sm font-medium text-display">{s.label}</span>
        <StatusPill tone={CONN_TONE[s.connectionState] ?? "neutral"}>
          {s.connectionState.replace("_", " ")}
        </StatusPill>
        {s.scheduleState !== "not_applicable" && (
          <StatusPill tone={s.scheduleState === "active" ? "ok" : "attention"}>
            schedule {s.scheduleState}
          </StatusPill>
        )}
        <StatusPill tone={FRESH_TONE[s.freshness] ?? "neutral"}>{s.freshness}</StatusPill>
        <span className="ml-auto text-[11px] text-muted-foreground">
          latest {fmt(s.latestEvidenceAt)}
        </span>
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-3">
        {s.received != null && (
          <span className="text-muted-foreground">
            received <span className="tabular text-display">{s.received}</span>
          </span>
        )}
        {s.processed != null && (
          <span className="text-muted-foreground">
            processed <span className="tabular text-display">{s.processed}</span>
          </span>
        )}
        {s.failedOrPending != null && (
          <span className="text-muted-foreground">
            unprocessed <span className="tabular text-display">{s.failedOrPending}</span>
          </span>
        )}
        {s.coverage.map((c) => (
          <span key={c.label} className="text-muted-foreground">
            {c.label} <span className="tabular text-display">{c.value}</span>
          </span>
        ))}
        {s.confirmedIdentities != null && (
          <span className="text-muted-foreground">
            identities{" "}
            <span className="tabular text-display">
              {s.confirmedIdentities} confirmed
              {s.unresolvedIdentities != null ? ` / ${s.unresolvedIdentities} unresolved` : ""}
            </span>
          </span>
        )}
      </div>
      {s.gaps.length > 0 && (
        <p className="mt-1 text-[11px] text-amber-700">⚠ {s.gaps.join("; ")}</p>
      )}
      {s.actionRequired && (
        <p className="mt-1 text-[11px] text-accent">Action: {s.actionRequired}</p>
      )}
    </div>
  );
}

function QueueRow({ q, onDrill }: { q: LcIntelQueue; onDrill: (q: LcIntelQueue) => void }) {
  return (
    <button
      type="button"
      onClick={() => onDrill(q)}
      className="flex w-full items-center gap-2 border-b border-hairline py-1.5 text-left last:border-0 hover:bg-surface-alt/40"
      title={`Drill: ${q.drill.table} [${q.drill.filter}]`}
    >
      <span className="tabular w-14 shrink-0 text-sm font-semibold text-display">{q.count}</span>
      <span className="flex-1 text-xs text-display">{q.label}</span>
      <Search className="h-3.5 w-3.5 text-muted-foreground" />
    </button>
  );
}

export function LearningOverviewView({
  overview,
  loading,
  error,
}: {
  overview: LearningOverview | null;
  loading?: boolean;
  error?: string | null;
}) {
  const [drill, setDrill] = useState<LcIntelQueue | null>(null);

  if (loading) return <p className="p-4 text-sm text-muted-foreground">Loading Learning Centre…</p>;
  if (error)
    return (
      <div className="rounded-xl border border-destructive/30 bg-white p-4 text-sm text-muted-foreground">
        Could not load the Learning Centre: {error}
      </div>
    );
  if (!overview) return <EmptyState>No learning overview available.</EmptyState>;

  const { summary } = overview.sourceTruth;
  const ei = overview.existingIntelligence;

  return (
    <div className="space-y-4">
      {/* Compact Source Truth summary */}
      <div className="rounded-xl border border-hairline bg-surface-alt/40 p-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Radio className="h-4 w-4 text-accent" />
          <span className="font-semibold text-display">Source truth</span>
          <StatusPill tone="ok">{summary.sourcesLive.length} live</StatusPill>
          <span className="text-muted-foreground">
            live: {summary.sourcesLive.join(", ") || "—"}
          </span>
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

      {/* Source truth detail */}
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

      {/* Existing intelligence */}
      <SectionCard
        title="Existing intelligence"
        icon={<ListTree className="h-4 w-4 text-muted-foreground" />}
        right={`${ei.totals.intelligenceObjects} objects`}
      >
        <div className="mb-3 flex flex-wrap gap-3 text-xs">
          {Object.entries(ei.totals).map(([k, v]) => (
            <span key={k} className="rounded-md border border-hairline bg-surface-alt/40 px-2 py-1">
              <span className="tabular font-semibold text-display">{v}</span>{" "}
              <span className="text-muted-foreground">
                {k.replace(/([A-Z])/g, " $1").toLowerCase()}
              </span>
            </span>
          ))}
        </div>
        <div className="mb-1 text-[11px] font-medium text-muted-foreground">
          Factual queues (click to trace to evidence)
        </div>
        {ei.queues.map((q) => (
          <QueueRow key={q.key} q={q} onDrill={setDrill} />
        ))}

        {drill && (
          <div className="mt-2 rounded-md border border-accent/30 bg-accent/5 p-2.5 text-xs">
            <div className="font-medium text-display">
              {drill.label} — {drill.count}
            </div>
            <div className="mt-0.5 text-muted-foreground">
              Traces to <code className="text-[11px]">{drill.drill.table}</code> where{" "}
              <code className="text-[11px]">{drill.drill.filter}</code>. Records are fetched live
              (read-only) from the canonical evidence when this view is connected.
            </div>
            <button
              type="button"
              onClick={() => setDrill(null)}
              className="mt-1 rounded border border-hairline bg-white px-2 py-0.5 text-[11px] text-muted-foreground"
            >
              Close
            </button>
          </div>
        )}

        <div className="mt-3 space-y-1 text-xs">
          <div className="text-[11px] font-medium text-muted-foreground">Repeated themes</div>
          {ei.repeatedThemes.length === 0 ? (
            <span className="text-muted-foreground">none</span>
          ) : (
            ei.repeatedThemes.map((t, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="tabular w-10 text-display">×{t.count}</span>
                <span className="text-muted-foreground">{t.subject}</span>
              </div>
            ))
          )}
        </div>

        <p
          className={cn(
            "mt-3 rounded-md border border-dashed border-hairline px-2 py-1.5 text-[11px]",
            ei.waiting.derived ? "text-muted-foreground" : "text-amber-700",
          )}
        >
          {ei.waiting.note}
        </p>
      </SectionCard>

      <p className="text-[11px] text-muted-foreground">
        Generated {fmt(overview.generatedAt)} from live canonical evidence (read-only). Every figure
        is dynamically queried and traceable; empty areas are honest gaps, never fabricated.
      </p>
    </div>
  );
}
