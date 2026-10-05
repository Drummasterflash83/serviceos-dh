/**
 * Provider connection & full telephony onboarding journey (Settings → Phone / VoIP).
 *
 * A brand-new tenant can: choose a provider → configure/connect securely → verify → discover
 * inventory → review capabilities → calibrate staff → configure pickup/shared behaviour →
 * verify a test call → review gaps → complete — and return later to manage the connection.
 * Everything is adapter-driven (no provider-specific form code) and resumable (progress is
 * persisted server-side after every step). Secrets are never rendered; only "Configured".
 */

import { useCallback, useEffect, useState } from "react";
import {
  Phone,
  Loader2,
  Check,
  X,
  AlertTriangle,
  RotateCcw,
  ArrowRight,
  ArrowLeft,
  Plug,
  ShieldCheck,
  Search,
  Sliders,
  PhoneCall,
  ClipboardCheck,
  Power,
  KeyRound,
  History,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  listProviders,
  getProviderState,
  getConnectionSpec,
  getConnectionStatus,
  configureConnection,
  testProviderConnection,
  runProviderDiscovery,
  getDiagnostics,
  saveBehaviour,
  disconnectProvider,
  getConnectionAudit,
  importExistingConnection,
  startProviderOAuth,
  reopenOnboarding,
  completeProviderOnboarding,
  runTestCall,
  validateFields,
  type ProviderGalleryEntry,
  type ConnectionSpec,
  type ConnectionField,
  type ConnectionStatus,
  type DiagnosticsResult,
  type DiscoverPerType,
  type ConnectionAuditEvent,
  type FieldError,
} from "@/lib/telephony";
import {
  CapabilitiesGrid,
  EndpointCalibration,
  type CalibrationSummary,
} from "./EndpointCalibration";

// ── small primitives ────────────────────────────────────────────────────────
function Btn({
  children,
  onClick,
  disabled,
  variant = "ghost",
  busy,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "danger";
  busy?: boolean;
  className?: string;
}) {
  const tones = {
    primary: "bg-accent text-white hover:bg-accent/90",
    ghost: "border border-hairline text-muted-foreground hover:bg-surface-alt",
    danger: "border border-destructive/30 text-destructive hover:bg-destructive/5",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium disabled:opacity-50",
        tones[variant],
        className,
      )}
    >
      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {children}
    </button>
  );
}

function CheckRow({ ok, label, detail }: { ok: boolean; label: string; detail?: string | null }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      {ok ? <Check className="h-3 w-3 text-success" /> : <X className="h-3 w-3 text-destructive" />}
      <span className="capitalize text-muted-foreground">{label.replace(/_/g, " ")}</span>
      {detail ? <span className="ml-auto text-right text-muted-foreground">{detail}</span> : null}
    </div>
  );
}

// ── dynamic connection form (STEP 5) ────────────────────────────────────────
function ConnectionForm({
  spec,
  status,
  onConfigured,
}: {
  spec: ConnectionSpec;
  status: ConnectionStatus;
  onConfigured: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of spec.fields) {
      if (!f.secret && status.nonSecretConfig?.[f.name] != null) {
        init[f.name] = String(status.nonSecretConfig[f.name]);
      }
    }
    return init;
  });
  const configured = status.configuredFields ?? [];
  // secret fields already stored start "locked" (showing Configured); user opts to replace.
  const [replacing, setReplacing] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const errFor = (name: string) => errors.find((e) => e.field === name)?.message;
  const set = (name: string, v: string) => setValues((s) => ({ ...s, [name]: v }));

  async function submit() {
    setServerError(null);
    const localErrors = validateFields(spec, values, configured);
    setErrors(localErrors);
    if (localErrors.length) return;
    setBusy(true);
    const r = await configureConnection(spec.provider, values);
    setBusy(false);
    if (!r.ok) {
      if (r.fieldErrors) setErrors(r.fieldErrors);
      setServerError(r.error?.message ?? "Could not save connection");
      return;
    }
    onConfigured();
  }

  async function oauth() {
    setBusy(true);
    const redirect = `${window.location.origin}/#/settings`;
    const r = await startProviderOAuth(spec.provider, values, redirect);
    setBusy(false);
    if (r.ok && r.data.authorize_url) {
      window.location.href = r.data.authorize_url;
    } else {
      setServerError(!r.ok ? r.error.message : "Could not start authorization");
    }
  }

  const oauthMode = spec.oauth?.supported;

  return (
    <div className="space-y-3">
      {spec.helpText && <p className="text-xs text-muted-foreground">{spec.helpText}</p>}

      {spec.fields.map((f) => (
        <FieldInput
          key={f.name}
          field={f}
          value={values[f.name] ?? ""}
          configured={f.secret && configured.includes(f.name) && !replacing[f.name]}
          onReplace={() => setReplacing((s) => ({ ...s, [f.name]: true }))}
          onChange={(v) => set(f.name, v)}
          error={errFor(f.name)}
        />
      ))}

      {spec.webhook?.note && (
        <p className="text-[11px] text-muted-foreground">
          <span className="font-medium">Webhook:</span> {spec.webhook.note}
        </p>
      )}
      {spec.ipAllowlist?.required && (
        <p className="text-[11px] text-muted-foreground">
          <span className="font-medium">IP allowlist:</span>{" "}
          {spec.ipAllowlist.note ?? "Allowlist our egress IPs at the provider."}
          {spec.ipAllowlist.addresses?.length ? ` (${spec.ipAllowlist.addresses.join(", ")})` : ""}
        </p>
      )}
      {serverError && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" /> {serverError}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {oauthMode ? (
          <Btn variant="primary" busy={busy} onClick={oauth}>
            <Plug className="h-3.5 w-3.5" /> Connect with {spec.label}
          </Btn>
        ) : (
          <Btn variant="primary" busy={busy} onClick={submit}>
            <ShieldCheck className="h-3.5 w-3.5" /> Save &amp; secure connection
          </Btn>
        )}
        {spec.docsUrl && (
          <a
            href={spec.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-accent hover:underline"
          >
            Provider documentation ↗
          </a>
        )}
      </div>
    </div>
  );
}

function FieldInput({
  field,
  value,
  configured,
  onReplace,
  onChange,
  error,
}: {
  field: ConnectionField;
  value: string;
  configured: boolean;
  onReplace: () => void;
  onChange: (v: string) => void;
  error?: string;
}) {
  const id = `field-${field.name}`;
  return (
    <div>
      <label htmlFor={id} className="text-[11px] font-medium">
        {field.label}
        {field.required ? <span className="text-destructive"> *</span> : null}
      </label>
      {configured ? (
        <div className="mt-1 flex items-center gap-2 rounded-lg border border-hairline bg-surface-alt/40 px-2.5 py-1.5 text-[11px]">
          <ShieldCheck className="h-3.5 w-3.5 text-success" />
          <span className="text-muted-foreground">Configured</span>
          <button onClick={onReplace} className="ml-auto text-accent hover:underline">
            Replace
          </button>
        </div>
      ) : field.type === "select" || field.type === "region" ? (
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full rounded-lg border border-hairline bg-white px-2.5 py-1.5 text-[11px] outline-none focus:border-accent"
        >
          <option value="">Select…</option>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : field.type === "textarea" ? (
        <textarea
          id={id}
          value={value}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full rounded-lg border border-hairline bg-white px-2.5 py-1.5 text-[11px] outline-none focus:border-accent"
        />
      ) : (
        <input
          id={id}
          type={field.secret ? "password" : field.type === "url" ? "url" : "text"}
          value={value}
          placeholder={field.placeholder}
          autoComplete={field.secret ? "off" : field.autocomplete}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full rounded-lg border border-hairline bg-white px-2.5 py-1.5 text-[11px] outline-none focus:border-accent"
        />
      )}
      {field.help && <p className="mt-0.5 text-[10px] text-muted-foreground">{field.help}</p>}
      {error && <p className="mt-0.5 text-[10px] text-destructive">{error}</p>}
    </div>
  );
}

// ── diagnostics panel (STEP 8) ──────────────────────────────────────────────
function DiagnosticsPanel({ provider }: { provider: string }) {
  const [diag, setDiag] = useState<DiagnosticsResult | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async () => {
    setBusy(true);
    const r = await getDiagnostics(provider);
    setBusy(false);
    if (r.ok) setDiag(r.data);
  }, [provider]);
  useEffect(() => {
    void run();
  }, [run]);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="text-sm font-semibold">Connection diagnostics</div>
        <Btn className="ml-auto" busy={busy} onClick={run}>
          <RotateCcw className="h-3.5 w-3.5" /> Re-run
        </Btn>
      </div>
      {diag && (
        <div className="space-y-2">
          <div
            className={cn(
              "rounded-lg px-3 py-2 text-xs font-medium",
              diag.ok ? "bg-success/10 text-success" : "bg-warning/10 text-warning",
            )}
          >
            {diag.ok ? "All checks passed" : "Some checks need attention"} · status{" "}
            {diag.connection_status}
            {diag.account_ref ? ` · ${diag.account_ref}` : ""}
          </div>
          {diag.checks.map((c) => (
            <div key={c.name} className="rounded-lg border border-hairline bg-white p-2">
              <CheckRow ok={c.ok} label={c.name} detail={c.detail} />
              {!c.ok && (c.likely_cause || c.recommended_action) && (
                <div className="mt-1 pl-5 text-[10px] text-muted-foreground">
                  {c.likely_cause && <div>Likely cause: {c.likely_cause}</div>}
                  {c.recommended_action && <div>Recommended: {c.recommended_action}</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── discovery review (STEP 9) ───────────────────────────────────────────────
function DiscoveryReview({ provider, onDone }: { provider: string; onDone: () => void }) {
  const [result, setResult] = useState<{
    discovered: number;
    imported: number;
    per_type: DiscoverPerType[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async () => {
    setBusy(true);
    const r = await runProviderDiscovery(provider);
    setBusy(false);
    if (r.ok) {
      setResult(r.data);
      onDone();
    }
  }, [provider, onDone]);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="text-sm font-semibold">Discover inventory</div>
        <Btn className="ml-auto" variant="primary" busy={busy} onClick={run}>
          <Search className="h-3.5 w-3.5" /> {result ? "Rescan" : "Start discovery"}
        </Btn>
      </div>
      <p className="text-xs text-muted-foreground">
        Discovery is idempotent — rescanning updates existing objects and preserves confirmed
        mappings. Unsupported inventory types are shown honestly.
      </p>
      {result && (
        <>
          <div className="text-xs">
            Discovered <span className="font-semibold">{result.discovered}</span> · imported{" "}
            <span className="font-semibold">{result.imported}</span>
          </div>
          <div className="space-y-1">
            {result.per_type.map((t) => (
              <div key={t.type} className="flex items-center gap-2 text-[11px]">
                {t.supported ? (
                  <Check className="h-3 w-3 text-success" />
                ) : (
                  <X className="h-3 w-3 text-muted-foreground" />
                )}
                <span className="capitalize">{t.type.replace(/_/g, " ")}</span>
                <span className="ml-auto text-muted-foreground">
                  {t.supported ? `${t.count ?? 0} found` : (t.reason ?? "unsupported")}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── behaviour editor (STEP 11) ──────────────────────────────────────────────
const BEHAVIOUR_TYPES = [
  { value: "shared_endpoint", label: "Shared endpoint" },
  { value: "pickup_group", label: "Pickup group" },
  { value: "ring_group", label: "Ring group" },
  { value: "queue", label: "Queue" },
  { value: "device", label: "Receptionist / roaming handset" },
];

function BehaviourEditor({ provider, onSaved }: { provider: string; onSaved: () => void }) {
  const [rows, setRows] = useState<Array<{ canonical_type: string; label: string; note: string }>>(
    [],
  );
  const [pickupCode, setPickupCode] = useState("");
  const [blfNote, setBlfNote] = useState("");
  const [busy, setBusy] = useState(false);
  const add = () =>
    setRows((r) => [...r, { canonical_type: "shared_endpoint", label: "", note: "" }]);
  const upd = (i: number, k: string, v: string) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [k]: v } : row)));
  const del = (i: number) => setRows((r) => r.filter((_, idx) => idx !== i));

  async function save() {
    setBusy(true);
    const entries = rows
      .filter((r) => r.label.trim())
      .map((r) => ({
        canonical_type: r.canonical_type,
        label: r.label.trim(),
        note: r.note.trim() || null,
      }));
    const config: Record<string, unknown> = {};
    if (pickupCode.trim()) config.pickup_code = pickupCode.trim();
    if (blfNote.trim()) config.blf_note = blfNote.trim();
    config.attribution_uncertain = !!pickupCode.trim();
    await saveBehaviour(provider, entries, config);
    setBusy(false);
    onSaved();
  }

  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold">Pickup &amp; shared-device behaviour</div>
      <p className="text-xs text-muted-foreground">
        Where the provider does not expose pickup/BLF metadata, record it manually. A manual pickup
        code (e.g. <code>*21#</code>) can make call attribution uncertain — configured BLF/pickup
        keys are recommended for cleaner metadata.
      </p>

      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="rounded-xl border border-hairline bg-surface-alt/40 p-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <select
                value={r.canonical_type}
                aria-label="Behaviour type"
                onChange={(e) => upd(i, "canonical_type", e.target.value)}
                className="rounded-lg border border-hairline bg-white px-2 py-1 text-[11px]"
              >
                {BEHAVIOUR_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <input
                value={r.label}
                placeholder="Label (e.g. Reception)"
                aria-label="Behaviour label"
                onChange={(e) => upd(i, "label", e.target.value)}
                className="flex-1 rounded-lg border border-hairline bg-white px-2 py-1 text-[11px]"
              />
              <button
                onClick={() => del(i)}
                aria-label="Remove"
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <input
              value={r.note}
              placeholder="Note (optional)"
              aria-label="Behaviour note"
              onChange={(e) => upd(i, "note", e.target.value)}
              className="mt-1 w-full rounded-lg border border-hairline bg-white px-2 py-1 text-[11px]"
            />
          </div>
        ))}
        <Btn onClick={add}>+ Add device / group</Btn>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="text-[11px] font-medium">Manual pickup code</label>
          <input
            value={pickupCode}
            placeholder="e.g. *21#"
            onChange={(e) => setPickupCode(e.target.value)}
            className="mt-1 w-full rounded-lg border border-hairline bg-white px-2.5 py-1.5 text-[11px]"
          />
        </div>
        <div>
          <label className="text-[11px] font-medium">BLF / pickup recommendation</label>
          <input
            value={blfNote}
            placeholder="e.g. configure BLF keys on handsets"
            onChange={(e) => setBlfNote(e.target.value)}
            className="mt-1 w-full rounded-lg border border-hairline bg-white px-2.5 py-1.5 text-[11px]"
          />
        </div>
      </div>

      <Btn variant="primary" busy={busy} onClick={save}>
        <Sliders className="h-3.5 w-3.5" /> Save behaviour
      </Btn>
    </div>
  );
}

// ── test-call stage (STEP 12) ───────────────────────────────────────────────
function TestCallStage({ provider }: { provider: string }) {
  const [steps, setSteps] = useState<Record<string, boolean> | null>(null);
  const [call, setCall] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    const r = await runTestCall(provider);
    setBusy(false);
    if (r.ok) {
      setSteps(r.data.steps);
      setCall(r.data.call);
    }
  }
  const LABELS: Record<string, string> = {
    call_found: "Call received",
    direction_resolved: "Direction resolved",
    participant_resolved: "Provider endpoint found",
    staff_identity_resolved: "Mapping applied to a team member",
    visible_in_communications: "Visible in Communications",
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="text-sm font-semibold">Verify a test call</div>
        <Btn className="ml-auto" variant="primary" busy={busy} onClick={run}>
          <PhoneCall className="h-3.5 w-3.5" /> Check latest call
        </Btn>
      </div>
      <p className="text-xs text-muted-foreground">
        Place a real inbound or outbound call, then check that it flowed through the pipeline.
        Unknown / unsupported results stay honest.
      </p>
      {steps && (
        <div className="rounded-lg border border-hairline bg-white p-2">
          {!steps.call_found ? (
            <div className="text-[11px] text-muted-foreground">
              No call found yet — place a test call and re-check.
            </div>
          ) : (
            <>
              {Object.entries(LABELS).map(([k, label]) => (
                <CheckRow key={k} ok={!!steps[k]} label={label} />
              ))}
              {call && <div className="mt-1 text-[10px] text-muted-foreground">Call {call}</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── provider gallery (STEP 3) ───────────────────────────────────────────────
function ProviderGallery({ onSelect }: { onSelect: (p: ProviderGalleryEntry) => void }) {
  const [providers, setProviders] = useState<ProviderGalleryEntry[] | null>(null);
  const [showDev, setShowDev] = useState(false);
  const load = useCallback(async () => {
    const r = await listProviders(showDev);
    if (r.ok) setProviders(r.data.providers);
  }, [showDev]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="text-sm font-semibold">Connect a telephony provider</div>
        <label className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <input type="checkbox" checked={showDev} onChange={(e) => setShowDev(e.target.checked)} />
          Show development providers
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        Choose a provider to begin. Support status is shown honestly — some providers are
        self-service, others are provider-assisted.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {(providers ?? []).map((p) => {
          const supported = Object.values(p.capabilities.capabilities).filter(
            (v) => v === "supported",
          ).length;
          return (
            <button
              key={p.provider}
              onClick={() => onSelect(p)}
              className="rounded-2xl border border-hairline bg-white p-4 text-left transition hover:border-accent/40 hover:shadow-sm"
            >
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-surface-alt">
                  <Phone className="h-4 w-4 text-accent" />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{p.label}</div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {p.authMode.replace(/_/g, " ")}
                    {p.oauthSupported ? " · OAuth" : ""}
                    {p.devOnly ? " · dev" : ""}
                  </div>
                </div>
                <ArrowRight className="ml-auto h-4 w-4 text-muted-foreground" />
              </div>
              <p className="mt-2 line-clamp-2 text-[11px] text-muted-foreground">{p.description}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-medium",
                    p.manual ? "bg-warning/10 text-warning" : "bg-success/10 text-success",
                  )}
                >
                  {p.manual ? "Provider-assisted" : "Self-service"}
                </span>
                <span className="rounded-full bg-surface-alt px-2 py-0.5 text-[10px] text-muted-foreground">
                  {supported} capabilities
                </span>
                {p.regions.map((r) => (
                  <span
                    key={r}
                    className="rounded-full bg-surface-alt px-2 py-0.5 text-[10px] uppercase text-muted-foreground"
                  >
                    {r}
                  </span>
                ))}
              </div>
            </button>
          );
        })}
        {providers && providers.length === 0 && (
          <div className="text-xs text-muted-foreground">No providers available.</div>
        )}
      </div>
    </div>
  );
}

// ── completion review (STEP 13) ─────────────────────────────────────────────
function CompletionReview({
  provider,
  summary,
  onCompleted,
}: {
  provider: string;
  summary: CalibrationSummary | null;
  onCompleted: () => void;
}) {
  const [diag, setDiag] = useState<DiagnosticsResult | null>(null);
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      const r = await getDiagnostics(provider);
      if (r.ok) setDiag(r.data);
    })();
  }, [provider]);

  const unresolved = summary?.unresolved ?? 0;
  const needAccept = unresolved > 0 || (summary?.conflicts ?? 0) > 0;

  async function complete() {
    setErr(null);
    if (needAccept && !accept) {
      setErr("Please acknowledge the outstanding gaps before completing.");
      return;
    }
    setBusy(true);
    const r = await completeProviderOnboarding(provider, needAccept && accept);
    setBusy(false);
    if (!r.ok) {
      setErr(r.error.message);
      return;
    }
    onCompleted();
  }

  const rows: Array<[string, string | number]> = [
    ["Connection", diag?.connection_status ?? "—"],
    ["Diagnostics", diag ? (diag.ok ? "all passed" : "attention needed") : "—"],
    ["Active inventory", diag?.active_inventory ?? "—"],
    ["Confirmed mappings", summary?.confirmed ?? "—"],
    ["Unresolved endpoints", unresolved],
    ["Conflicts", summary?.conflicts ?? 0],
  ];

  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold">Review &amp; complete</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {rows.map(([k, v]) => (
          <div
            key={k}
            className="rounded-lg border border-hairline bg-surface-alt/40 p-2 text-center"
          >
            <div className="text-sm font-semibold tabular">{v}</div>
            <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{k}</div>
          </div>
        ))}
      </div>
      {diag && diag.manual && (
        <p className="text-[11px] text-warning">
          This is a provider-assisted connection — some capabilities are limited (see diagnostics).
        </p>
      )}
      {needAccept && (
        <label className="flex items-start gap-2 rounded-lg border border-warning/20 bg-warning/5 p-2 text-[11px]">
          <input
            type="checkbox"
            checked={accept}
            onChange={(e) => setAccept(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            I acknowledge {unresolved} unresolved endpoint(s)
            {summary?.conflicts ? ` and ${summary.conflicts} conflict(s)` : ""} and want to complete
            onboarding anyway. These stay honestly unresolved and can be revisited later.
          </span>
        </label>
      )}
      {err && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" /> {err}
        </div>
      )}
      <Btn variant="primary" busy={busy} onClick={complete}>
        <ClipboardCheck className="h-3.5 w-3.5" /> Complete onboarding
      </Btn>
    </div>
  );
}

// ── connected-state management (STEP 14) ────────────────────────────────────
function ConnectedManagement({
  provider,
  onReopen,
  onDisconnected,
}: {
  provider: string;
  onReopen: () => void;
  onDisconnected: () => void;
}) {
  const [diag, setDiag] = useState<DiagnosticsResult | null>(null);
  const [audit, setAudit] = useState<ConnectionAuditEvent[] | null>(null);
  const [showAudit, setShowAudit] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [replace, setReplace] = useState(false);
  const [spec, setSpec] = useState<ConnectionSpec | null>(null);
  const [status, setStatus] = useState<ConnectionStatus | null>(null);

  const load = useCallback(async () => {
    const [d, s] = await Promise.all([getDiagnostics(provider), getConnectionStatus(provider)]);
    if (d.ok) setDiag(d.data);
    if (s.ok) {
      setSpec(s.data.connection_spec);
      setStatus(s.data.connection);
    }
  }, [provider]);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    await fn();
    setBusy(null);
    await load();
  }

  async function loadAudit() {
    const r = await getConnectionAudit(provider);
    if (r.ok) setAudit(r.data.events);
    setShowAudit(true);
  }

  function exportReport() {
    const report = {
      generated: new Date().toISOString(),
      provider,
      connection_status: status?.status,
      account_ref: status?.accountRef, // already masked
      diagnostics: diag,
      note: "Redacted diagnostic report — contains no secrets or full phone numbers.",
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `telephony-${provider}-diagnostic.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-hairline bg-white p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-surface-alt">
            <Phone className="h-4 w-4 text-accent" />
          </span>
          <div>
            <div className="text-sm font-semibold">{spec?.label ?? provider}</div>
            <div className="text-[11px] text-muted-foreground">
              {status?.status ?? "—"}
              {status?.accountRef ? ` · ${status.accountRef}` : ""}
              {status?.verifiedAt
                ? ` · verified ${new Date(status.verifiedAt).toLocaleDateString()}`
                : ""}
            </div>
          </div>
          <span
            className={cn(
              "ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium",
              status?.status === "configured"
                ? "bg-success/10 text-success"
                : status?.status === "manual"
                  ? "bg-warning/10 text-warning"
                  : "bg-surface-alt text-muted-foreground",
            )}
          >
            {status?.status === "manual" ? "Provider-assisted" : (status?.status ?? "—")}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <Btn
            busy={busy === "test"}
            onClick={() => run("test", () => testProviderConnection(provider))}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Retest
          </Btn>
          <Btn
            busy={busy === "scan"}
            onClick={() => run("scan", () => runProviderDiscovery(provider))}
          >
            <Search className="h-3.5 w-3.5" /> Rescan inventory
          </Btn>
          <Btn onClick={onReopen}>
            <Sliders className="h-3.5 w-3.5" /> Reopen onboarding
          </Btn>
          {spec && !spec.manual && (
            <Btn onClick={() => setReplace((v) => !v)}>
              <KeyRound className="h-3.5 w-3.5" /> {replace ? "Cancel" : "Replace credentials"}
            </Btn>
          )}
          <Btn onClick={loadAudit}>
            <History className="h-3.5 w-3.5" /> Audit history
          </Btn>
          <Btn onClick={exportReport}>
            <Download className="h-3.5 w-3.5" /> Export report
          </Btn>
          {!confirmDisconnect ? (
            <Btn variant="danger" onClick={() => setConfirmDisconnect(true)}>
              <Power className="h-3.5 w-3.5" /> Disconnect
            </Btn>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">
                Disconnect &amp; revoke credentials?
              </span>
              <Btn
                variant="danger"
                busy={busy === "disc"}
                onClick={() =>
                  run("disc", async () => {
                    await disconnectProvider(provider);
                    onDisconnected();
                  })
                }
              >
                Confirm
              </Btn>
              <Btn onClick={() => setConfirmDisconnect(false)}>Cancel</Btn>
            </span>
          )}
        </div>

        {replace && spec && status && (
          <div className="mt-3 rounded-xl border border-hairline bg-surface-alt/40 p-3">
            <ConnectionForm
              spec={spec}
              status={status}
              onConfigured={() => {
                setReplace(false);
                void load();
              }}
            />
          </div>
        )}

        {diag && (
          <div className="mt-3 space-y-1">
            {diag.checks.map((c) => (
              <CheckRow key={c.name} ok={c.ok} label={c.name} detail={c.detail} />
            ))}
          </div>
        )}

        {showAudit && (
          <div className="mt-3 rounded-xl border border-hairline bg-surface-alt/40 p-3">
            <div className="mb-1 text-[11px] font-semibold">Connection audit</div>
            <div className="max-h-48 space-y-1 overflow-auto">
              {(audit ?? []).map((e, i) => (
                <div key={i} className="flex items-center gap-2 text-[10px]">
                  <span className="font-medium capitalize">{e.event.replace(/_/g, " ")}</span>
                  <span className="ml-auto text-muted-foreground">
                    {new Date(e.created_at).toLocaleString()}
                  </span>
                </div>
              ))}
              {audit && audit.length === 0 && (
                <div className="text-[10px] text-muted-foreground">No events yet.</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* calibration dashboard */}
      <EndpointCalibration />
    </div>
  );
}

// ── the resumable wizard (STEP 4) ───────────────────────────────────────────
const WIZARD_STEPS = [
  { key: "connection", label: "Connection", icon: Plug },
  { key: "verify", label: "Verify", icon: ShieldCheck },
  { key: "discover", label: "Discover", icon: Search },
  { key: "capabilities", label: "Capabilities", icon: ClipboardCheck },
  { key: "map", label: "Map staff", icon: Phone },
  { key: "behaviour", label: "Behaviour", icon: Sliders },
  { key: "test_call", label: "Test call", icon: PhoneCall },
  { key: "complete", label: "Complete", icon: Check },
] as const;

// backend stage → first wizard step to resume at
const STAGE_TO_STEP: Record<string, number> = {
  provider_selected: 0,
  connection_configured: 1,
  connection_verified: 2,
  inventory_discovered: 2,
  inventory_imported: 3,
  mappings_reviewed: 4,
  behaviour_configured: 6,
  test_call_verified: 7,
  complete: 7,
};

function Wizard({
  provider,
  spec,
  capabilities,
  status,
  startAt,
  onExit,
  onComplete,
}: {
  provider: string;
  spec: ConnectionSpec;
  capabilities: Record<string, import("@/lib/telephony").CapabilityState>;
  status: ConnectionStatus;
  startAt: number;
  onExit: () => void;
  onComplete: () => void;
}) {
  const [step, setStep] = useState(startAt);
  const [connStatus, setConnStatus] = useState<ConnectionStatus>(status);
  const [summary, setSummary] = useState<CalibrationSummary | null>(null);
  const current = WIZARD_STEPS[step];

  const refreshStatus = useCallback(async () => {
    const r = await getConnectionStatus(provider);
    if (r.ok) setConnStatus(r.data.connection);
  }, [provider]);

  const connected = connStatus.status === "configured" || connStatus.status === "manual";

  return (
    <div className="space-y-4">
      {/* stepper */}
      <div className="flex items-center gap-2">
        <button onClick={onExit} className="text-[11px] text-accent hover:underline">
          ← All providers
        </button>
        <div className="ml-auto text-[11px] text-muted-foreground">
          Step {step + 1} of {WIZARD_STEPS.length}
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {WIZARD_STEPS.map((s, i) => {
          const Icon = s.icon;
          const done = i < step;
          const active = i === step;
          return (
            <button
              key={s.key}
              onClick={() => setStep(i)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium",
                active
                  ? "bg-accent text-white"
                  : done
                    ? "bg-success/10 text-success"
                    : "border border-hairline text-muted-foreground",
              )}
            >
              <Icon className="h-3 w-3" /> {s.label}
            </button>
          );
        })}
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-alt">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${((step + 1) / WIZARD_STEPS.length) * 100}%` }}
        />
      </div>

      {/* step body */}
      <div className="rounded-2xl border border-hairline bg-white p-5">
        {current.key === "connection" && (
          <div className="space-y-3">
            {spec.manual && (
              <div className="rounded-lg border border-warning/20 bg-warning/5 p-2 text-[11px] text-warning">
                {spec.manualNote ?? "This connection is provider-assisted."}
              </div>
            )}
            {spec.manual && (
              <Btn
                variant="primary"
                onClick={async () => {
                  await importExistingConnection(provider);
                  await refreshStatus();
                  setStep(1);
                }}
              >
                <Plug className="h-3.5 w-3.5" /> Use existing operator connection
              </Btn>
            )}
            <ConnectionForm
              spec={spec}
              status={connStatus}
              onConfigured={async () => {
                await refreshStatus();
                setStep(1);
              }}
            />
          </div>
        )}
        {current.key === "verify" && <DiagnosticsPanel provider={provider} />}
        {current.key === "discover" && <DiscoveryReview provider={provider} onDone={() => {}} />}
        {current.key === "capabilities" && (
          <div className="space-y-2">
            <div className="text-sm font-semibold">Review capabilities</div>
            <p className="text-xs text-muted-foreground">
              What this provider can and cannot surface. Unsupported items are honest — the product
              will not pretend they exist.
            </p>
            <CapabilitiesGrid capabilities={capabilities} />
          </div>
        )}
        {current.key === "map" && (
          <EndpointCalibration onSummary={setSummary} showCapabilities={false} />
        )}
        {current.key === "behaviour" && (
          <BehaviourEditor provider={provider} onSaved={() => setStep(6)} />
        )}
        {current.key === "test_call" && <TestCallStage provider={provider} />}
        {current.key === "complete" && (
          <CompletionReview provider={provider} summary={summary} onCompleted={onComplete} />
        )}
      </div>

      {/* nav */}
      <div className="flex items-center justify-between">
        <Btn onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Btn>
        {step === 0 && !connected && (
          <span className="text-[11px] text-muted-foreground">
            Configure the connection to continue
          </span>
        )}
        {step < WIZARD_STEPS.length - 1 && (
          <Btn
            variant="primary"
            disabled={step === 0 && !connected}
            onClick={() => setStep((s) => Math.min(WIZARD_STEPS.length - 1, s + 1))}
          >
            Next <ArrowRight className="h-3.5 w-3.5" />
          </Btn>
        )}
      </div>
    </div>
  );
}

// ── top-level orchestrator ──────────────────────────────────────────────────
type View =
  | { kind: "loading" }
  | { kind: "gallery" }
  | {
      kind: "wizard";
      provider: string;
      spec: ConnectionSpec;
      capabilities: Record<string, import("@/lib/telephony").CapabilityState>;
      status: ConnectionStatus;
      startAt: number;
    }
  | { kind: "connected"; provider: string };

export function ProviderOnboarding() {
  const [view, setView] = useState<View>({ kind: "loading" });

  const boot = useCallback(async () => {
    // Default to the real provider; if it (or any) is already connected, show connected view.
    const r = await getProviderState("sipcentric", true);
    if (
      r.ok &&
      (r.data.connection.status === "configured" || r.data.connection.status === "manual")
    ) {
      setView({ kind: "connected", provider: "sipcentric" });
      return;
    }
    setView({ kind: "gallery" });
  }, []);
  useEffect(() => {
    void boot();
  }, [boot]);

  async function openWizard(provider: string, resume = false) {
    const [specR, stateR] = await Promise.all([
      getConnectionSpec(provider),
      getProviderState(provider, true),
    ]);
    if (!specR.ok || !specR.data.connection_spec) return;
    const spec = specR.data.connection_spec;
    const capabilities = specR.data.capabilities?.capabilities ?? {};
    const status = specR.data.connection;
    const stage = stateR.ok ? stateR.data.state?.stage : undefined;
    const startAt = resume && stage ? (STAGE_TO_STEP[stage] ?? 0) : 0;
    setView({ kind: "wizard", provider, spec, capabilities, status, startAt });
  }

  if (view.kind === "loading") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading provider connection…
      </div>
    );
  }
  if (view.kind === "gallery") {
    return <ProviderGallery onSelect={(p) => openWizard(p.provider)} />;
  }
  if (view.kind === "wizard") {
    return (
      <Wizard
        provider={view.provider}
        spec={view.spec}
        capabilities={view.capabilities}
        status={view.status}
        startAt={view.startAt}
        onExit={() => setView({ kind: "gallery" })}
        onComplete={() => setView({ kind: "connected", provider: view.provider })}
      />
    );
  }
  // connected
  return (
    <ConnectedManagement
      provider={view.provider}
      onReopen={async () => {
        await reopenOnboarding(view.provider);
        await openWizard(view.provider, true);
      }}
      onDisconnected={() => setView({ kind: "gallery" })}
    />
  );
}
