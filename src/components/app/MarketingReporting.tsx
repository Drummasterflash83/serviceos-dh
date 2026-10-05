// Marketing Objectives & Reporting (Phase 7) — one factual overview across
// Broadcasts and Sequences, composed server-side from the canonical per-type
// report authorities. UNKNOWN IS NOT ZERO: delivered/opened/clicked/bounced
// have no evidence pipeline and render as “Unavailable”, never 0, with the
// server's reason. Objective links record INTENT; verified contribution is
// shown ONLY when a canonical assessment exists — otherwise the explicit
// absence of evidence is stated. No decorative charts; the browser performs
// no authoritative calculation.

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, BarChart3, Link2, Loader2, Target, Unlink } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getCampaignReporting,
  getReportingOverview,
  linkObjective,
  newObjectiveLinkRequestId,
  searchObjectives,
  unlinkObjective,
  type CampaignReportData,
  type ObjectiveSearchRow,
  type OverviewFilters,
  type OverviewRow,
} from "@/lib/marketing/reporting";
import { EXCLUSION_REASON_LABELS } from "@/lib/marketing/campaigns";

/* ── local atoms (file-local by repo convention) ─────────────────────────── */

const inputCls =
  "w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm text-foreground outline-none focus:border-foreground/40";

function Btn({
  children,
  onClick,
  tone = "default",
  disabled,
  busy,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  tone?: "default" | "primary" | "danger";
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        tone === "primary" && "bg-foreground text-background hover:opacity-90",
        tone === "danger" && "border border-destructive/30 bg-destructive/5 text-destructive",
        tone === "default" && "border border-hairline bg-white hover:bg-surface-alt",
      )}
    >
      {busy && <Loader2 className="h-3 w-3 animate-spin" />}
      {children}
    </button>
  );
}

function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-destructive">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" /> Something went wrong
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{message}</div>
      {onRetry && (
        <div className="mt-2">
          <Btn onClick={onRetry}>Retry</Btn>
        </div>
      )}
    </div>
  );
}

/** honest metric cell: null = Unavailable (with reason), never zero */
function Metric({ label, value, reason }: { label: string; value: unknown; reason?: string }) {
  const unavailable = value === null || value === undefined;
  return (
    <div className="rounded-lg border border-hairline bg-white p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={cn(
          "tabular text-sm",
          unavailable ? "text-muted-foreground" : "font-semibold text-foreground",
        )}
        title={unavailable ? (reason ?? "No evidence pipeline exists for this metric") : undefined}
      >
        {unavailable ? "Unavailable" : String(value)}
      </div>
    </div>
  );
}

const HEALTH_TONE: Record<string, string> = {
  on_track: "bg-success/10 text-success",
  achieved: "bg-success/10 text-success",
  at_risk: "bg-warning/10 text-warning",
  off_track: "bg-destructive/10 text-destructive",
  missed: "bg-destructive/10 text-destructive",
  blocked: "bg-destructive/10 text-destructive",
  unknown: "bg-surface-alt text-muted-foreground",
};

/* ── objective link dialog ───────────────────────────────────────────────── */

function LinkObjectiveDialog({
  campaignId,
  campaignName,
  expectedVersion,
  onClose,
  onDone,
}: {
  campaignId: string;
  campaignName: string;
  expectedVersion: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [requestId] = useState(newObjectiveLinkRequestId());
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<ObjectiveSearchRow[]>([]);
  const [objectiveId, setObjectiveId] = useState("");
  const [relation, setRelation] = useState<"supports" | "contributes_to">("supports");
  const [expected, setExpected] = useState("");
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // remember the invoking control on OPEN and restore focus on CLOSE; if it
  // disappeared, fall back deterministically to the selected tab
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      const target =
        opener.current && opener.current.isConnected
          ? opener.current
          : document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      target?.focus();
    };
  }, []);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const f = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        );
        if (f.length === 0) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await searchObjectives(search.trim() || undefined, 20);
      if (!cancelled && r.ok) setOptions(r.data.objectives ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [search]);

  const run = async () => {
    setBusy(true);
    setError(null);
    const res = await linkObjective({
      campaign_id: campaignId,
      expected_version: expectedVersion,
      objective_id: objectiveId,
      relation,
      ...(expected.trim() ? { expected_contribution: expected.trim() } : {}),
      ...(rationale.trim() ? { rationale: rationale.trim() } : {}),
      request_id: requestId,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    onDone();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="link-objective-title"
        className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-xl border border-hairline bg-white p-5"
      >
        <div id="link-objective-title" className="text-sm font-semibold text-foreground">
          Link “{campaignName}” to an Objective
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          A link records that this campaign is INTENDED to support the objective. It never claims or
          fabricates contribution — verified contribution comes only from the Objective engine’s own
          evidence rules.
        </p>
        <div className="mt-3 space-y-3">
          <label className="block text-xs">
            <span className="font-medium text-foreground">Search active objectives</span>
            <input
              className={cn(inputCls, "mt-1")}
              value={search}
              maxLength={200}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Type to filter…"
            />
          </label>
          <label className="block text-xs">
            <span className="font-medium text-foreground">Objective</span>
            <select
              className={cn(inputCls, "mt-1")}
              value={objectiveId}
              onChange={(e) => setObjectiveId(e.target.value)}
            >
              <option value="">Choose an objective…</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title} ({o.objective_type}
                  {o.health ? ` · ${o.health.status}` : " · never evaluated"})
                </option>
              ))}
            </select>
            {options.length === 0 && (
              <span className="mt-1 block text-muted-foreground">
                No active objectives found for this tenant.
              </span>
            )}
          </label>
          <label className="block text-xs">
            <span className="font-medium text-foreground">Relation</span>
            <select
              className={cn(inputCls, "mt-1")}
              value={relation}
              onChange={(e) => setRelation(e.target.value as "supports" | "contributes_to")}
            >
              <option value="supports">supports</option>
              <option value="contributes_to">contributes_to</option>
            </select>
          </label>
          <label className="block text-xs">
            <span className="font-medium text-foreground">Expected contribution</span>
            <span className="ml-1 text-muted-foreground">optional, your intent — not a claim</span>
            <textarea
              className={cn(inputCls, "mt-1 min-h-[52px]")}
              maxLength={500}
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
            />
          </label>
          <label className="block text-xs">
            <span className="font-medium text-foreground">Rationale</span>
            <span className="ml-1 text-muted-foreground">optional</span>
            <textarea
              className={cn(inputCls, "mt-1 min-h-[52px]")}
              maxLength={500}
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
            />
          </label>
        </div>
        {error && <div className="mt-2 text-xs text-destructive">{error}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            ref={cancelRef}
            onClick={onClose}
            className="rounded-lg border border-hairline bg-white px-3 py-1.5 text-xs font-medium hover:bg-surface-alt"
          >
            Cancel
          </button>
          <Btn tone="primary" busy={busy} disabled={!objectiveId} onClick={run}>
            <Link2 className="h-3 w-3" /> Link objective
          </Btn>
        </div>
      </div>
    </div>
  );
}

/* ── report drill panel ──────────────────────────────────────────────────── */

function ReportPanel({
  data,
  canLink,
  onChanged,
}: {
  data: CampaignReportData;
  canLink: boolean;
  onChanged: () => void;
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [busyUnlink, setBusyUnlink] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const report = data.report as Record<string, unknown>;
  const oc = data.objective_context;
  const isSequence = data.campaign_type === "sequence";
  const dispatch = (report.dispatch ?? {}) as Record<string, number>;
  const enrolments = (report.enrolments ?? {}) as Record<string, number>;
  const snapshot = (report.snapshot ?? null) as Record<string, unknown> | null;
  const exclusions = (snapshot?.exclusion_breakdown ?? {}) as Record<string, number>;
  const trackingNote =
    ((report.tracking as Record<string, unknown> | undefined)?.note as string | undefined) ??
    "No evidence pipeline exists for this metric";
  // optimistic-concurrency token: the server report carries the campaign
  // version; link/unlink send it back and reload via onChanged on success
  const expectedVersion = data.version;

  return (
    <div className="space-y-3 rounded-xl border border-hairline bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-foreground">{data.name}</div>
          <div className="text-xs text-muted-foreground">
            {data.campaign_type} · {data.status} · created{" "}
            {new Date(data.created_at).toLocaleString()}
          </div>
        </div>
      </div>
      {notice && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-hairline bg-surface-alt p-2 text-xs"
        >
          {notice}
        </div>
      )}

      {/* factual counts */}
      {isSequence ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric label="Candidates" value={report.candidates} />
            <Metric label="Eligible" value={report.eligible} />
            <Metric label="Excluded" value={report.excluded} />
            <Metric label="Unsubscribed" value={report.unsubscribed} />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {["active", "paused", "completed", "exited", "held"].map((k) => (
              <Metric key={k} label={`Enrolments ${k}`} value={enrolments[k] ?? 0} />
            ))}
          </div>
        </>
      ) : (
        <>
          {snapshot ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric label="Candidates" value={snapshot.candidate} />
              <Metric label="Included" value={snapshot.included} />
              <Metric label="Excluded" value={snapshot.excluded} />
              <Metric label="Unsubscribed" value={report.unsubscribed} />
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
              No audience snapshot yet — preflight has not run.
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {["queued", "submitted", "skipped", "failed", "unknown"].map((k) => (
              <Metric key={k} label={k} value={dispatch[k] ?? 0} />
            ))}
          </div>
        </>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Delivered" value={report.delivered} reason={trackingNote} />
        <Metric label="Opened" value={report.opened} reason={trackingNote} />
        <Metric label="Clicked" value={report.clicked} reason={trackingNote} />
        <Metric label="Bounced" value={report.bounced} reason={trackingNote} />
      </div>
      {isSequence && (
        <div className="text-[11px] text-muted-foreground">
          Replies proven by thread evidence:{" "}
          <span className="tabular">{String(report.replied_proven ?? 0)}</span>
          {" · "}
          {String(report.bounce_evidence ?? "")}
        </div>
      )}
      <div className="text-[11px] text-muted-foreground">
        “Submitted” means {String(report.submitted_meaning ?? "provider acceptance — NOT delivery")}
        .
      </div>
      {Object.keys(exclusions).length > 0 && (
        <div className="rounded-lg border border-hairline bg-surface-alt p-2">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Exclusions by exact reason
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-foreground">
            {Object.entries(exclusions).map(([k, v]) => (
              <span key={k} className="rounded border border-hairline bg-white px-1.5 py-0.5">
                {EXCLUSION_REASON_LABELS[k] ?? k}: <span className="tabular">{v}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      {data.template_lineage.length > 0 && (
        <div className="text-[11px] text-muted-foreground">
          Content lineage:{" "}
          {data.template_lineage
            .map((l) =>
              l.template_revision_id
                ? `pinned template revision ${String(l.template_revision_id).slice(0, 8)}…`
                : l.ai_proposal_id
                  ? `accepted AI proposal ${String(l.ai_proposal_id).slice(0, 8)}…`
                  : "",
            )
            .filter(Boolean)
            .join(" · ")}
        </div>
      )}

      {/* objective context */}
      <div className="rounded-lg border border-hairline p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Target className="h-3.5 w-3.5 text-muted-foreground" /> Objective
          </div>
          {canLink && expectedVersion !== null && (
            <div className="flex gap-1">
              <Btn onClick={() => setLinkOpen(true)}>
                <Link2 className="h-3 w-3" /> {oc.linked ? "Change link" : "Link objective"}
              </Btn>
              {oc.linked && (
                <Btn
                  tone="danger"
                  busy={busyUnlink}
                  onClick={async () => {
                    setBusyUnlink(true);
                    const r = await unlinkObjective({
                      campaign_id: data.id,
                      expected_version: expectedVersion,
                    });
                    setBusyUnlink(false);
                    if (r.ok) {
                      setNotice("Objective relationship removed — prior history is preserved.");
                      onChanged();
                    } else setNotice(r.error.message);
                  }}
                >
                  <Unlink className="h-3 w-3" /> Unlink
                </Btn>
              )}
            </div>
          )}
        </div>
        {!oc.linked ? (
          <div className="mt-1 text-xs text-muted-foreground">
            Not linked to an objective.{" "}
            {typeof oc.history_count === "number" && oc.history_count > 0
              ? `${oc.history_count} historical relationship record(s) preserved.`
              : ""}
          </div>
        ) : (
          <div className="mt-2 space-y-2 text-xs">
            <div>
              <span className="font-medium text-foreground">{oc.objective?.title}</span>{" "}
              <span className="text-muted-foreground">
                ({oc.objective?.objective_type} · {oc.link?.relation})
              </span>
            </div>
            {oc.link?.expected_contribution && (
              <div className="text-muted-foreground">
                Expected contribution (stated intent): {oc.link.expected_contribution}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Canonical health:</span>
              {oc.health ? (
                <>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase",
                      HEALTH_TONE[oc.health.status] ?? HEALTH_TONE.unknown,
                    )}
                  >
                    {oc.health.status}
                  </span>
                  <span className="text-muted-foreground">
                    evaluated {new Date(oc.health.evaluated_at).toLocaleString()}
                    {oc.health_state === "stale" && " — STALE (over 48h old)"}
                  </span>
                </>
              ) : (
                <span className="rounded-full bg-surface-alt px-2 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                  never evaluated
                </span>
              )}
            </div>
            {oc.primary_metric &&
              (oc.primary_metric.comparability === "comparable" ? (
                <div className="text-muted-foreground">
                  {oc.primary_metric.metric_name}:{" "}
                  <span className="tabular text-foreground">
                    {oc.primary_metric.current}
                    {oc.primary_metric.unit ? ` ${oc.primary_metric.unit}` : ""}
                  </span>{" "}
                  vs target{" "}
                  <span className="tabular">
                    {oc.primary_metric.target}
                    {oc.primary_metric.unit ? ` ${oc.primary_metric.unit}` : ""}
                  </span>
                </div>
              ) : (
                <div className="text-muted-foreground">
                  {oc.primary_metric.metric_name}: current value unknown (
                  {oc.primary_metric.comparability.replaceAll("_", " ")})
                </div>
              ))}
            <div
              className={cn(
                "rounded border p-2",
                oc.contribution?.state
                  ? "border-hairline bg-surface-alt"
                  : "border-dashed border-hairline",
              )}
            >
              {oc.contribution?.state ? (
                <span>
                  Contribution assessment (canonical engine):{" "}
                  <span className="font-medium">{oc.contribution.state}</span> — an assessment is
                  not proof of business outcome.
                </span>
              ) : (
                <span className="text-muted-foreground">
                  No verified contribution evidence. Sends, opens and clicks never create one — the
                  Objective engine confirms contribution only from verified before/after measurement
                  evidence.
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {linkOpen && expectedVersion !== null && (
        <LinkObjectiveDialog
          campaignId={data.id}
          campaignName={data.name}
          expectedVersion={expectedVersion}
          onClose={() => setLinkOpen(false)}
          onDone={onChanged}
        />
      )}
    </div>
  );
}

/* ── main ────────────────────────────────────────────────────────────────── */

export function MarketingReporting({ canLink }: { canLink: boolean }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [rows, setRows] = useState<OverviewRow[]>([]);
  const [totals, setTotals] = useState<{ campaigns: number; by_status: Record<string, number> }>({
    campaigns: 0,
    by_status: {},
  });
  const [filters, setFilters] = useState<OverviewFilters>({});
  const [selected, setSelected] = useState<CampaignReportData | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await getReportingOverview(filters);
    setLoading(false);
    if (!r.ok) {
      if (r.error.code === "FORBIDDEN") setForbidden(true);
      else setError(r.error.message);
      return;
    }
    setRows(r.data.campaigns ?? []);
    setTotals(r.data.totals ?? { campaigns: 0, by_status: {} });
  }, [filters]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const drill = async (id: string) => {
    setDrillLoading(true);
    const r = await getCampaignReporting(id);
    setDrillLoading(false);
    if (r.ok) setSelected(r.data);
    else setError(r.error.message);
  };

  if (forbidden) {
    return (
      <div className="rounded-xl border border-hairline bg-surface-alt p-4 text-xs text-muted-foreground">
        Reporting requires the <span className="font-medium">marketing.reporting.view</span>{" "}
        permission.
      </div>
    );
  }
  if (loading && rows.length === 0) {
    return (
      <div className="grid min-h-[30vh] place-items-center text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading reporting…
        </span>
      </div>
    );
  }
  if (error && rows.length === 0)
    return <ErrorNote message={error} onRetry={() => void reload()} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select
          className="rounded-lg border border-hairline bg-white px-2 py-1.5"
          value={filters.campaign_type ?? ""}
          aria-label="Filter by campaign type"
          onChange={(e) =>
            setFilters({
              ...filters,
              campaign_type: (e.target.value || undefined) as OverviewFilters["campaign_type"],
            })
          }
        >
          <option value="">All types</option>
          <option value="broadcast">Broadcasts</option>
          <option value="sequence">Sequences</option>
        </select>
        <select
          className="rounded-lg border border-hairline bg-white px-2 py-1.5"
          value={filters.status ?? ""}
          aria-label="Filter by campaign status"
          onChange={(e) => setFilters({ ...filters, status: e.target.value || undefined })}
        >
          <option value="">All statuses</option>
          {[
            "draft",
            "review",
            "approved",
            "scheduled",
            "active",
            "paused",
            "completed",
            "cancelled",
            "archived",
          ].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          type="date"
          className="rounded-lg border border-hairline bg-white px-2 py-1.5"
          value={filters.created_from?.slice(0, 10) ?? ""}
          onChange={(e) => setFilters({ ...filters, created_from: e.target.value || undefined })}
          aria-label="Created from"
        />
        <input
          type="date"
          className="rounded-lg border border-hairline bg-white px-2 py-1.5"
          value={filters.created_to?.slice(0, 10) ?? ""}
          onChange={(e) => setFilters({ ...filters, created_to: e.target.value || undefined })}
          aria-label="Created to"
        />
        <input
          className="w-48 rounded-lg border border-hairline bg-white px-2 py-1.5"
          placeholder="Search name…"
          aria-label="Search campaigns by name"
          value={filters.search ?? ""}
          onChange={(e) => setFilters({ ...filters, search: e.target.value || undefined })}
        />
        <span className="ml-auto text-muted-foreground">
          {totals.campaigns} campaign{totals.campaigns === 1 ? "" : "s"} in view
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-hairline bg-white p-8 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-surface-alt">
            <BarChart3 className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="mt-2 text-sm font-medium text-foreground">Nothing to report yet</div>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            Reporting shows only facts the platform truly possesses. Create a broadcast or sequence
            and its factual counts will appear here.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-hairline bg-white">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-hairline text-muted-foreground">
                <th className="px-3 py-2 font-medium">Campaign</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Objective</th>
                <th className="px-3 py-2 font-medium">Submitted</th>
                <th className="px-3 py-2 font-medium">Delivered</th>
                <th className="px-3 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const rep = r.report as Record<string, unknown>;
                // presentational sum of CANONICAL per-EMAIL-step counts from
                // the server report — internal (tag/lifecycle/owner/wait)
                // steps are never counted as submissions, and no status truth
                // is re-derived here
                const submitted =
                  r.campaign_type === "sequence"
                    ? (
                        (rep.steps ?? []) as Array<{
                          type?: string;
                          executions?: Record<string, number>;
                        }>
                      )
                        .filter((s) => s.type === "send_email")
                        .reduce((a, s) => a + (s.executions?.succeeded ?? 0), 0)
                    : ((rep.dispatch as Record<string, number> | undefined)?.submitted ?? 0);
                return (
                  <tr key={r.id} className="border-b border-hairline/60 last:border-0">
                    <td className="px-3 py-2">
                      <button
                        className="font-medium text-foreground underline-offset-2 hover:underline"
                        onClick={() => void drill(r.id)}
                      >
                        {r.name}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{r.campaign_type}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.status}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.objective_title ?? "—"}</td>
                    <td
                      className="px-3 py-2 tabular"
                      title={
                        r.campaign_type === "sequence"
                          ? "Sum of the canonical report's per-email-step submitted executions. Submitted means the provider accepted the request — never delivered."
                          : "The canonical report's dispatch.submitted. Submitted means the provider accepted the request — never delivered."
                      }
                    >
                      {submitted}
                    </td>
                    <td
                      className="px-3 py-2 text-muted-foreground"
                      title="No delivery evidence pipeline exists — never shown as zero"
                    >
                      Unavailable
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {new Date(r.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {drillLoading && (
        <div className="rounded-xl border border-hairline bg-white p-4 text-xs text-muted-foreground">
          <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> Loading campaign report…
        </div>
      )}
      {selected && (
        <ReportPanel
          data={selected}
          canLink={canLink}
          onChanged={() => {
            void drill(selected.id);
            void reload();
          }}
        />
      )}
      <p className="text-[11px] text-muted-foreground">
        Recipient and enrolment drill-downs live on each campaign’s own panel (Broadcasts /
        Sequences tabs) — the same canonical evidence this overview composes.
      </p>
    </div>
  );
}
