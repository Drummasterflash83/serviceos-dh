// Marketing Ads (Phase 8) — lead capture, attribution, cost-per-lead and
// source health. Ads captures and attributes leads; it does not create or
// edit advertisements. Every number is a server fact: unknown is shown as
// unavailable with a reason, never zero. Meta / Google Ads / LinkedIn / the
// Sheet fallback are honestly Not connected until real adapters exist — the
// ONE operational mode is the provider-neutral SIGNED WEBHOOK. Hidden
// controls are NOT the security boundary — the server enforces every
// permission again.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Copy,
  Loader2,
  Pencil,
  Plug,
  Plus,
  Radio,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type AdsAdapterDescriptor,
  type AdsEventState,
  type AdsHealthRow,
  type AdsLeadRow,
  type AdsMetricsData,
  type AdSourceRow,
  createAdSource,
  getAdsCatalogue,
  getAdsHealth,
  getAdsLeadFeed,
  getAdsMetrics,
  listAdSources,
  newAdsRequestId,
  retryAdEvent,
  reviseAdSource,
  setAdSourceStatus,
  setupAdWebhook,
} from "@/lib/marketing/ads";

/* ── local atoms (file-local by repo convention) ─────────────────────────── */

// request keys per semantic scope: unchanged retry reuses its key (idempotent
// convergence); any input change is a new scope; success clears the scope
const requestKeys = new Map<string, string>();
function requestKeyFor(scope: string): string {
  let k = requestKeys.get(scope);
  if (!k) {
    k = newAdsRequestId();
    requestKeys.set(scope, k);
  }
  return k;
}
function clearRequestKey(scope: string) {
  requestKeys.delete(scope);
}

const inputCls =
  "w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm text-foreground outline-none focus:border-foreground/40";

function Btn({
  children,
  onClick,
  tone = "default",
  disabled,
  busy,
  title,
  pressed,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  tone?: "default" | "primary" | "danger";
  disabled?: boolean;
  busy?: boolean;
  title?: string;
  pressed?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      title={title}
      aria-label={title}
      aria-pressed={pressed}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        tone === "primary" && "bg-foreground text-background hover:opacity-90",
        tone === "danger" && "border border-destructive/30 bg-destructive/5 text-destructive",
        tone === "default" && "border border-hairline bg-white hover:bg-surface-alt",
      )}
    >
      {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs">
      <span className="font-medium text-foreground">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
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

function useDialogChrome(onClose: () => void) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
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
  return { dialogRef, cancelRef };
}

const STATE_TONE: Record<string, string> = {
  resolved: "bg-success/10 text-success",
  review: "bg-warning/10 text-warning",
  failed: "bg-destructive/10 text-destructive",
  pending: "bg-surface-alt text-muted-foreground",
  processing: "bg-surface-alt text-muted-foreground",
};

/* ── source create/edit dialog ───────────────────────────────────────────── */

function SourceDialog({
  providers,
  editing,
  onClose,
  onDone,
}: {
  providers: AdsAdapterDescriptor[];
  editing: AdSourceRow | null;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const { dialogRef, cancelRef } = useDialogChrome(onClose);
  const [provider, setProvider] = useState<string>(editing?.provider ?? "webhook");
  const [name, setName] = useState(editing?.name ?? "");
  const [campaignRef, setCampaignRef] = useState(editing?.campaign_ref ?? "");
  const [formRef, setFormRef] = useState(editing?.form_ref ?? "");
  const [relType, setRelType] = useState(editing?.default_relationship_type ?? "lead");
  const [stage, setStage] = useState(editing?.default_lifecycle_stage_key ?? "new_lead");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const descriptor = providers.find((p) => p.provider === provider);

  const run = async () => {
    setBusy(true);
    setError(null);
    const scope = editing
      ? `ads-rev:${editing.id}:${editing.version}:${JSON.stringify([name, campaignRef, formRef, relType, stage])}`
      : `ads-new:${JSON.stringify([provider, name, campaignRef, formRef, relType, stage])}`;
    const res = editing
      ? await reviseAdSource(
          editing.id,
          editing.version,
          {
            name,
            campaign_ref: campaignRef,
            form_ref: formRef,
            default_relationship_type: relType,
            default_lifecycle_stage_key: stage,
          },
          requestKeyFor(scope),
        )
      : await createAdSource(
          {
            provider: provider as AdSourceRow["provider"],
            name,
            campaign_ref: campaignRef || undefined,
            form_ref: formRef || undefined,
            default_relationship_type: relType || undefined,
            default_lifecycle_stage_key: stage || undefined,
          },
          requestKeyFor(scope),
        );
    setBusy(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    clearRequestKey(scope);
    onDone(
      editing
        ? "Source configuration revised — the change is immutable version history."
        : provider === "webhook"
          ? "Source created. Generate its signing secret to start accepting signed events."
          : "Source created. This provider stays Not connected until a real adapter and credentials exist.",
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ads-source-title"
        className="w-full max-w-lg rounded-xl border border-hairline bg-white p-4 shadow-lg max-h-[90vh] overflow-auto"
      >
        <div id="ads-source-title" className="text-sm font-semibold text-foreground">
          {editing ? `Edit "${editing.name}"` : "New ad source"}
        </div>
        <div className="mt-3 space-y-3">
          {!editing && (
            <Field label="Provider">
              <select
                className={inputCls}
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
              >
                {providers.map((p) => (
                  <option key={p.provider} value={p.provider}>
                    {p.displayName}
                    {p.implemented ? "" : " — Not connected (no adapter)"}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {descriptor && !descriptor.implemented && !editing && (
            <div
              role="status"
              className="rounded-lg border border-warning/30 bg-warning/10 p-2 text-xs"
            >
              No adapter or credentials exist for {descriptor.displayName}. You can save the
              configuration, but it stays honestly <b>Not connected</b> — no events, no metrics, no
              manual sync — until a real integration is verified. Required:{" "}
              {descriptor.requirements.join("; ")}
            </div>
          )}
          <Field label="Name">
            <input
              className={inputCls}
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Campaign reference (optional)">
              <input
                className={inputCls}
                value={campaignRef}
                maxLength={200}
                onChange={(e) => setCampaignRef(e.target.value)}
              />
            </Field>
            <Field label="Form reference (optional)">
              <input
                className={inputCls}
                value={formRef}
                maxLength={200}
                onChange={(e) => setFormRef(e.target.value)}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Default relationship type">
              <input
                className={inputCls}
                value={relType}
                maxLength={60}
                onChange={(e) => setRelType(e.target.value)}
              />
            </Field>
            <Field label="Default lifecycle stage key">
              <input
                className={inputCls}
                value={stage}
                maxLength={60}
                onChange={(e) => setStage(e.target.value)}
              />
            </Field>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Defaults are pinned per configuration version: a lead is classified with the defaults
            that were current when its event was received. A captured lead is inbound evidence —
            never a marketing subscription.
          </p>
        </div>
        {error && (
          <div
            role="alert"
            className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive"
          >
            {error}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            ref={cancelRef}
            onClick={onClose}
            className="rounded-lg border border-hairline bg-white px-3 py-1.5 text-xs font-medium hover:bg-surface-alt"
          >
            Cancel
          </button>
          <Btn tone="primary" busy={busy} disabled={!name.trim()} onClick={() => void run()}>
            {editing ? "Save revision" : "Create source"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

/* ── webhook credential dialog (secret shown exactly once) ───────────────── */

function WebhookSetupDialog({
  source,
  onClose,
  onDone,
}: {
  source: AdSourceRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const { dialogRef, cancelRef } = useDialogChrome(onClose);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [result, setResult] = useState<{
    endpoint_path: string;
    signing_secret: string;
  } | null>(null);

  const copySecret = async (secret: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(secret);
      setCopyState("copied");
    } catch {
      // insecure context / denied permission — never silently pretend it copied
      setCopyState("failed");
    }
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    const res = await setupAdWebhook(source.id, source.version, newAdsRequestId());
    setBusy(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    setResult({ endpoint_path: res.data.endpoint_path, signing_secret: res.data.signing_secret });
    onDone();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ads-webhook-title"
        className="w-full max-w-lg rounded-xl border border-hairline bg-white p-4 shadow-lg"
      >
        <div id="ads-webhook-title" className="text-sm font-semibold text-foreground">
          {source.credential_state === "configured" ? "Rotate" : "Generate"} signing secret —{" "}
          {source.name}
        </div>
        {!result ? (
          <>
            <p className="mt-2 text-xs text-muted-foreground">
              The secret is generated server-side, stored only in the tenant Vault, and shown
              exactly once. The sender signs every request:{" "}
              <code className="rounded bg-surface-alt px-1">
                HMAC-SHA256(secret, timestamp + &quot;.&quot; + raw_body)
              </code>
              {source.credential_state === "configured" &&
                " Rotating keeps the previous secret valid for a bounded overlap window (24 hours) so in-flight deliveries still verify; after that it is retired."}
            </p>
            {error && (
              <div
                role="alert"
                className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive"
              >
                {error}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                ref={cancelRef}
                onClick={onClose}
                className="rounded-lg border border-hairline bg-white px-3 py-1.5 text-xs font-medium hover:bg-surface-alt"
              >
                Cancel
              </button>
              <Btn tone="primary" busy={busy} onClick={() => void run()}>
                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                {source.credential_state === "configured" ? "Rotate secret" : "Generate secret"}
              </Btn>
            </div>
          </>
        ) : (
          <>
            <div role="status" className="mt-3 space-y-2 text-xs">
              <Field label="Webhook endpoint path">
                <code className="block break-all rounded-lg bg-surface-alt p-2">
                  {result.endpoint_path}
                </code>
              </Field>
              <Field label="Signing secret — shown ONCE, store it now">
                <div className="flex items-center gap-2">
                  <code className="block grow break-all rounded-lg bg-surface-alt p-2">
                    {result.signing_secret}
                  </code>
                  <Btn
                    title="Copy signing secret"
                    onClick={() => void copySecret(result.signing_secret)}
                  >
                    <Copy className="h-3 w-3" />
                  </Btn>
                </div>
              </Field>
              <p role="status" aria-live="polite" className="text-muted-foreground">
                {copyState === "copied"
                  ? "Copied to clipboard."
                  : copyState === "failed"
                    ? "Couldn't copy automatically — select the secret above and copy it manually."
                    : "It is kept only in the tenant Vault and can never be read again — only rotated."}
              </p>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                ref={cancelRef}
                onClick={onClose}
                className="rounded-lg border border-hairline bg-white px-3 py-1.5 text-xs font-medium hover:bg-surface-alt"
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── main surface ────────────────────────────────────────────────────────── */

export function MarketingAds({ canManage }: { canManage: boolean }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [providers, setProviders] = useState<AdsAdapterDescriptor[]>([]);
  const [sources, setSources] = useState<AdSourceRow[]>([]);
  const [health, setHealth] = useState<AdsHealthRow[]>([]);
  const [leads, setLeads] = useState<AdsLeadRow[]>([]);
  const [leadCounts, setLeadCounts] = useState<Record<string, number>>({});
  // true when the server reported more events than this page shows — so the
  // newest-N view is never silently presented as the complete set.
  const [leadsTruncated, setLeadsTruncated] = useState(false);
  const [metrics, setMetrics] = useState<AdsMetricsData | null>(null);
  // per-section load failures — a swallowed read must NEVER be rendered as a
  // truthful "no leads" / "no spend facts"; it is shown as an honest error.
  const [feedError, setFeedError] = useState<string | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [sideError, setSideError] = useState<string | null>(null);
  const [windowKey, setWindowKey] = useState<"today" | "7d" | "30d" | "all">("7d");
  const [stateFilter, setStateFilter] = useState<AdsEventState | "">("");
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    | { kind: "create" }
    | { kind: "edit"; source: AdSourceRow }
    | { kind: "webhook"; source: AdSourceRow }
    | null
  >(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [cat, src, hl, feed, met] = await Promise.all([
      getAdsCatalogue(),
      listAdSources(),
      getAdsHealth(),
      getAdsLeadFeed({ window: windowKey, ...(stateFilter ? { state: stateFilter } : {}) }),
      getAdsMetrics({}),
    ]);
    setLoading(false);
    if (!src.ok) {
      if (src.error.code === "FORBIDDEN") {
        setForbidden(true);
        return;
      }
      setError(src.error.message);
      return;
    }
    setForbidden(false);
    setSources(src.data.sources ?? []);
    // catalogue + health share one honest side-panel error; a failure never
    // silently drops the provider grid or the attention banner.
    setProviders(cat.ok ? (cat.data.providers ?? []) : []);
    setHealth(hl.ok ? (hl.data.sources ?? []) : []);
    setSideError(!cat.ok ? cat.error.message : !hl.ok ? hl.error.message : null);
    if (feed.ok) {
      setLeads(feed.data.leads ?? []);
      setLeadCounts(feed.data.counts ?? {});
      setLeadsTruncated(Boolean(feed.data.next_cursor));
      setFeedError(null);
    } else {
      // do NOT keep or fabricate a stale/empty feed — surface the failure
      setLeads([]);
      setLeadCounts({});
      setLeadsTruncated(false);
      setFeedError(feed.error.message);
    }
    if (met.ok) {
      setMetrics(met.data);
      setMetricsError(null);
    } else {
      setMetrics(null);
      setMetricsError(met.error.message);
    }
  }, [windowKey, stateFilter]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (loading && sources.length === 0 && !forbidden) {
    return (
      <div
        role="status"
        className="grid min-h-[30vh] place-items-center text-sm text-muted-foreground"
      >
        <span className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading Ads…
        </span>
      </div>
    );
  }
  if (forbidden) {
    return (
      <div role="status" className="rounded-xl border border-hairline bg-surface-alt p-4">
        <div className="text-sm font-medium text-foreground">
          You don&apos;t have access to this
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          This area needs the Marketing view permission. An owner or admin can grant it from
          Marketing access settings.
        </div>
      </div>
    );
  }
  if (error) return <ErrorNote message={error} onRetry={() => void reload()} />;

  const attention = health.filter((h) => h.attention);
  const unconnected = providers.filter((p) => !p.implemented);

  return (
    <div className="space-y-5">
      <div>
        <div className="text-display text-xl font-semibold">Ads</div>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Ads captures and attributes leads; it does not create or edit advertisements.
        </p>
      </div>

      {notice && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-hairline bg-surface-alt p-2 text-xs text-foreground"
        >
          {notice}{" "}
          <button className="underline" onClick={() => setNotice(null)}>
            dismiss
          </button>
        </div>
      )}

      {sideError && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"
        >
          Couldn&apos;t load provider catalogue or source health ({sideError}).{" "}
          <button className="underline" onClick={() => void reload()}>
            Retry
          </button>
          . Provider states and attention below may be incomplete.
        </div>
      )}

      {attention.length > 0 && (
        <div role="alert" className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs">
          <div className="font-medium text-foreground">Attention required</div>
          <ul className="mt-1 list-disc pl-4 text-muted-foreground">
            {attention.map((h) => (
              <li key={h.id}>
                <b>{h.name}</b>: {h.remediation ?? "needs review"}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── sources ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-foreground">Sources</div>
        {canManage && (
          <Btn tone="primary" onClick={() => setDialog({ kind: "create" })}>
            <Plus className="h-3 w-3" aria-hidden="true" /> New source
          </Btn>
        )}
      </div>
      {sources.length === 0 ? (
        <div className="rounded-xl border border-dashed border-hairline bg-white p-8 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-surface-alt">
            <Radio className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          </div>
          <div className="mt-2 text-sm font-medium text-foreground">No ad sources yet</div>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            {canManage
              ? "Create a signed-webhook source to start capturing leads with verified, replay-safe events."
              : "An owner or admin can configure lead-capture sources."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {sources.map((s) => {
            const h = health.find((x) => x.id === s.id);
            return (
              <div key={s.id} className="rounded-xl border border-hairline bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Plug className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> {s.name}
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                      s.connection_state === "ready" && s.status === "active"
                        ? "bg-success/10 text-success"
                        : s.status === "archived"
                          ? "bg-surface-alt text-muted-foreground"
                          : "border border-warning/30 bg-warning/10 text-warning",
                    )}
                  >
                    {s.status !== "active"
                      ? s.status
                      : s.connection_state === "ready"
                        ? "ready"
                        : s.connection_state === "configuration_required"
                          ? "configuration required"
                          : "not connected"}
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {s.provider === "webhook"
                    ? "Signed webhook (provider-neutral)"
                    : providers.find((p) => p.provider === s.provider)?.displayName}
                  {" · "}
                  last event{" "}
                  {s.last_event_at ? new Date(s.last_event_at).toLocaleString() : "never"}
                </div>
                <div className="mt-2 grid grid-cols-4 gap-2 text-center text-xs tabular">
                  <div>
                    <div className="font-semibold text-foreground">{s.events_7d}</div>
                    <div className="text-[10px] text-muted-foreground">leads 7d</div>
                  </div>
                  <div>
                    <div className="font-semibold text-foreground">{s.pending}</div>
                    <div className="text-[10px] text-muted-foreground">pending</div>
                  </div>
                  <div>
                    <div
                      className={cn(
                        "font-semibold",
                        s.review > 0 ? "text-warning" : "text-foreground",
                      )}
                    >
                      {s.review}
                    </div>
                    <div className="text-[10px] text-muted-foreground">review</div>
                  </div>
                  <div>
                    <div
                      className={cn(
                        "font-semibold",
                        s.failed > 0 ? "text-destructive" : "text-foreground",
                      )}
                    >
                      {s.failed}
                    </div>
                    <div className="text-[10px] text-muted-foreground">failed</div>
                  </div>
                </div>
                {h?.remediation && (
                  <div className="mt-2 text-[11px] text-warning">{h.remediation}</div>
                )}
                {canManage && (
                  <div className="mt-3 flex flex-wrap justify-end gap-1">
                    {s.mode === "webhook" && s.status === "active" && (
                      <Btn onClick={() => setDialog({ kind: "webhook", source: s })}>
                        <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                        {s.credential_state === "configured" ? "Rotate secret" : "Generate secret"}
                      </Btn>
                    )}
                    {s.status !== "archived" && (
                      <Btn
                        title="Edit source"
                        onClick={() => setDialog({ kind: "edit", source: s })}
                      >
                        <Pencil className="h-3 w-3" />
                      </Btn>
                    )}
                    {s.status === "active" && (
                      <Btn
                        onClick={async () => {
                          const scope = `ads-st:${s.id}:${s.version}:disabled`;
                          const r = await setAdSourceStatus(
                            s.id,
                            s.version,
                            "disabled",
                            requestKeyFor(scope),
                          );
                          if (r.ok) {
                            clearRequestKey(scope);
                            setNotice(
                              "Source disabled — existing leads, attribution and metrics are preserved.",
                            );
                            void reload();
                          } else setNotice(r.error.message);
                        }}
                      >
                        Disable
                      </Btn>
                    )}
                    {s.status === "disabled" && (
                      <>
                        <Btn
                          onClick={async () => {
                            const scope = `ads-st:${s.id}:${s.version}:active`;
                            const r = await setAdSourceStatus(
                              s.id,
                              s.version,
                              "active",
                              requestKeyFor(scope),
                            );
                            if (r.ok) {
                              clearRequestKey(scope);
                              setNotice("Source enabled.");
                              void reload();
                            } else setNotice(r.error.message);
                          }}
                        >
                          Enable
                        </Btn>
                        <Btn
                          title="Archive source"
                          onClick={async () => {
                            const scope = `ads-st:${s.id}:${s.version}:archived`;
                            const r = await setAdSourceStatus(
                              s.id,
                              s.version,
                              "archived",
                              requestKeyFor(scope),
                            );
                            if (r.ok) {
                              clearRequestKey(scope);
                              setNotice("Source archived — recoverable, history preserved.");
                              void reload();
                            } else setNotice(r.error.message);
                          }}
                        >
                          <Archive className="h-3 w-3" />
                        </Btn>
                      </>
                    )}
                    {s.status === "archived" && (
                      <Btn
                        title="Restore source"
                        onClick={async () => {
                          const scope = `ads-st:${s.id}:${s.version}:active`;
                          const r = await setAdSourceStatus(
                            s.id,
                            s.version,
                            "active",
                            requestKeyFor(scope),
                          );
                          if (r.ok) {
                            clearRequestKey(scope);
                            setNotice("Source restored.");
                            void reload();
                          } else setNotice(r.error.message);
                        }}
                      >
                        <ArchiveRestore className="h-3 w-3" />
                      </Btn>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── provider catalogue (truthful) ── */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        {unconnected.map((p) => (
          <div key={p.provider} className="rounded-xl border border-hairline bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-foreground">{p.displayName}</div>
              <span className="shrink-0 whitespace-nowrap rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warning">
                Not connected
              </span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              No adapter or credentials exist. No events, metrics or sync are fabricated.
            </p>
          </div>
        ))}
      </div>

      {/* ── cost (honest) ── */}
      <div className="rounded-xl border border-hairline bg-white p-4">
        <div className="text-sm font-semibold text-foreground">Spend & cost per lead</div>
        {metricsError ? (
          <div role="alert" className="mt-2 text-xs text-destructive">
            Couldn&apos;t load spend metrics ({metricsError}).{" "}
            <button className="underline" onClick={() => void reload()}>
              Retry
            </button>
            . Nothing is shown as a stand-in.
          </div>
        ) : metrics && metrics.totals.spend !== null ? (
          <div className="mt-2 text-xs text-muted-foreground">
            Spend {metrics.totals.currency} {metrics.totals.spend} · provider-reported leads{" "}
            {metrics.totals.provider_leads ?? "—"} · received events{" "}
            {metrics.totals.received_events} · CPL (provider){" "}
            {metrics.cpl_provider ?? "unavailable"} · CPL (received){" "}
            {metrics.cpl_received ?? "unavailable"}
          </div>
        ) : (
          <div
            className="mt-2 text-xs text-muted-foreground"
            title={metrics?.cpl_unavailable_reason ?? "no_spend_facts"}
          >
            Unavailable — no genuine provider spend facts exist ({""}
            {metrics?.cpl_unavailable_reason ?? "no_spend_facts"}). Spend and CPL appear only when a
            connected adapter reports them; nothing is fabricated and zero is never shown as a
            stand-in.
          </div>
        )}
      </div>

      {/* ── lead feed ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-semibold text-foreground">Leads</div>
        <div className="flex gap-1" role="group" aria-label="Lead window">
          {(["today", "7d", "30d", "all"] as const).map((w) => (
            <Btn
              key={w}
              pressed={windowKey === w}
              tone={windowKey === w ? "primary" : "default"}
              onClick={() => setWindowKey(w)}
            >
              {w}
            </Btn>
          ))}
        </div>
        <select
          className="rounded-lg border border-hairline bg-white px-2 py-1.5 text-xs"
          aria-label="Filter by processing state"
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value as AdsEventState | "")}
        >
          <option value="">All states</option>
          {["resolved", "review", "failed", "pending", "processing"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span className="ml-auto text-xs text-muted-foreground">
          {leadCounts.received ?? 0} received · {leadCounts.resolved ?? 0} resolved ·{" "}
          {leadCounts.review ?? 0} review · {leadCounts.failed ?? 0} failed
        </span>
      </div>
      {feedError ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center text-xs text-destructive"
        >
          Couldn&apos;t load the lead feed ({feedError}).{" "}
          <button className="underline" onClick={() => void reload()}>
            Retry
          </button>
          . This is a load error, not an empty result.
        </div>
      ) : leads.length === 0 ? (
        <div className="rounded-xl border border-dashed border-hairline bg-white p-6 text-center text-xs text-muted-foreground">
          No lead events in this window. Events arrive only through a verified signed webhook —
          nothing is simulated.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-hairline bg-white">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead>
              <tr className="border-b border-hairline text-muted-foreground">
                <th className="px-3 py-2 font-medium">Lead</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">State</th>
                <th className="px-3 py-2 font-medium">Person</th>
                <th className="px-3 py-2 font-medium">Lifecycle</th>
                <th className="px-3 py-2 font-medium">Received</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.event_id} className="border-b border-hairline/60 last:border-0">
                  <td className="px-3 py-2 font-medium text-foreground">{l.lead_name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{l.source_name ?? "—"}</td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                        STATE_TONE[l.state] ?? STATE_TONE.pending,
                      )}
                    >
                      {l.state}
                    </span>
                    {l.state === "failed" && l.error_class && (
                      <div
                        className="mt-0.5 max-w-[180px] truncate text-[10px] text-muted-foreground"
                        title={l.error_class}
                      >
                        {l.error_class}
                      </div>
                    )}
                    {l.state === "review" && (
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        Ambiguous identity — needs a person decision
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{l.person_name ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{l.lifecycle ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {new Date(l.received_at).toLocaleString()}
                    {l.replay_count > 0 && (
                      <span className="ml-1 text-[10px]">({l.replay_count} replays)</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canManage && (l.state === "failed" || l.state === "review") && (
                      <Btn
                        title="Retry processing"
                        onClick={async () => {
                          const r = await retryAdEvent(l.event_id, newAdsRequestId());
                          if (r.ok) {
                            setNotice("Event queued for reprocessing.");
                            void reload();
                          } else setNotice(r.error.message);
                        }}
                      >
                        <RefreshCw className="h-3 w-3" />
                      </Btn>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {leadsTruncated && (
            <div className="border-t border-hairline px-3 py-2 text-[11px] text-muted-foreground">
              Showing the newest {leads.length} events in this view. Narrow the window or state
              filter to see older events — this list is not the complete set.
            </div>
          )}
        </div>
      )}

      {dialog?.kind === "create" && (
        <SourceDialog
          providers={providers}
          editing={null}
          onClose={() => setDialog(null)}
          onDone={(m) => {
            setNotice(m);
            void reload();
          }}
        />
      )}
      {dialog?.kind === "edit" && (
        <SourceDialog
          providers={providers}
          editing={dialog.source}
          onClose={() => setDialog(null)}
          onDone={(m) => {
            setNotice(m);
            void reload();
          }}
        />
      )}
      {dialog?.kind === "webhook" && (
        <WebhookSetupDialog
          source={dialog.source}
          onClose={() => setDialog(null)}
          onDone={() => void reload()}
        />
      )}
    </div>
  );
}
