/**
 * Marketing Settings — owner/admin administration surface (opened from the
 * settings control in /marketing, never a fourth primary section).
 *
 * Areas: Access & permissions · Contact inclusion & lifecycle · Delivery
 * guardrails & unsubscribe identity · Tags & segment governance · Notifications
 * · Audit/change history. Everything reads/writes through marketing-admin
 * (owner/admin role + canonical resolver); stale writes surface as
 * VERSION_CONFLICT with a reload; footer text renders as plain text only.
 * Senders & Workspace (Phase 4) is a REAL section over marketing-senders —
 * authorised sender profiles + governed test sends through the Automation
 * Engine. Ads connectors remain honest Not connected.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Clock,
  History,
  Loader2,
  Shield,
  SlidersHorizontal,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useMarketingAccess } from "@/lib/marketing/useMarketingAccess";
import {
  getMarketingSettings,
  updateMarketingSettings,
  listSettingsHistory,
  listLifecycleStagesAdmin,
  lifecycleAdmin,
  getAccessOverview,
  setAccessGrant,
  listMarketingAudit,
  type MarketingSettingsFull,
  type LifecycleStageAdmin,
  type AccessOverview,
  type MarketingAuditRow,
} from "@/lib/marketing/admin";
import { SendersSection } from "@/components/app/MarketingSenders";

const inputCls =
  "rounded-lg border border-hairline bg-white px-2 py-2 text-sm outline-none focus:border-accent";
const cardCls = "rounded-xl border border-hairline bg-white p-4";

function Note({ tone, children }: { tone: "error" | "warn" | "ok"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 text-xs",
        tone === "error"
          ? "border-destructive/30 bg-destructive/5 text-foreground"
          : tone === "warn"
            ? "border-warning/30 bg-warning/5 text-foreground"
            : "border-success/30 bg-success/5 text-foreground",
      )}
    >
      {children}
    </div>
  );
}

export function MarketingSettings({
  onBack,
  focus,
}: {
  onBack: () => void;
  focus?: "test-activity";
}) {
  const { access } = useMarketingAccess();
  const canAdmin = access?.permissions?.includes("marketing.access.manage") ?? false;

  // Deep link from "View test activity": scroll to the Recent test sends block
  // once it exists. The sections load asynchronously and the router resets the
  // scroll position on navigation, so retry until the anchor holds still.
  useEffect(() => {
    if (focus !== "test-activity") return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      const el = document.getElementById("test-activity");
      if (el) {
        el.scrollIntoView({ behavior: attempts === 1 ? "smooth" : "auto", block: "start" });
        const top = el.getBoundingClientRect().top;
        if (attempts > 1 && top > -60 && top < 240) {
          clearInterval(timer);
          return;
        }
      }
      if (attempts >= 12) clearInterval(timer);
    }, 500);
    return () => clearInterval(timer);
  }, [focus]);

  const [settings, setSettings] = useState<MarketingSettingsFull | null>(null);
  const [stages, setStages] = useState<LifecycleStageAdmin[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [s, st] = await Promise.all([getMarketingSettings(), listLifecycleStagesAdmin()]);
    if (!s.ok) {
      if (s.error.status === 403) setDenied(true);
      else setError(s.error.message);
    } else setSettings(s.data.settings);
    if (st.ok) setStages(st.data.stages);
    setLoading(false);
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  async function save(changes: Record<string, unknown>) {
    if (!settings) return;
    setNotice(null);
    const r = await updateMarketingSettings(changes, settings.version);
    if (r.ok) {
      setSettings(r.data.settings);
      setNotice("Saved.");
    } else if (r.error.code === "VERSION_CONFLICT") {
      setNotice("Settings were changed elsewhere — the latest values have been reloaded.");
      await reload();
    } else {
      setNotice(`Save failed: ${r.error.message}`);
    }
  }

  if (loading)
    return (
      <div className="grid min-h-[30vh] place-items-center text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading Marketing settings…
        </span>
      </div>
    );
  if (denied)
    return (
      <div className={cardCls}>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Shield className="h-4 w-4 text-muted-foreground" /> Marketing settings
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Settings administration requires an owner or admin account.
        </p>
        <button onClick={onBack} className="mt-3 text-xs underline">
          Back to Marketing
        </button>
      </div>
    );
  if (error)
    return (
      <div className={cardCls}>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <AlertTriangle className="h-4 w-4 text-destructive" /> Settings unavailable
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{error}</p>
        <button
          onClick={() => void reload()}
          className="mt-3 rounded-lg border border-hairline bg-white px-3 py-1.5 text-xs"
        >
          Try again
        </button>
      </div>
    );

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-lg border border-hairline bg-white px-2.5 py-1.5 text-xs font-medium hover:bg-surface-alt"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Marketing
        </button>
        <div>
          <div className="text-display text-xl font-semibold">Marketing settings</div>
          <p className="text-xs text-muted-foreground">
            Tenant configuration — versioned, audited, owner/admin only.
          </p>
        </div>
      </div>
      {notice && <Note tone={notice.startsWith("Saved") ? "ok" : "warn"}>{notice}</Note>}

      {settings ? (
        <>
          <InclusionSection settings={settings} stages={stages} onSave={save} />
          <LifecycleSection stages={stages} onChanged={reload} />
          <GuardrailsSection settings={settings} onSave={save} />
          <SendersSection />
          {canAdmin && <AccessSection />}
          <NotificationsSection settings={settings} onSave={save} />
          <GovernanceNote />
          <AuditSection />
          <HistorySection />
        </>
      ) : (
        <Note tone="warn">
          Marketing defaults are not initialised yet — open Marketing once as an owner/admin to
          initialise them.
        </Note>
      )}
    </div>
  );
}

/* ── Contact inclusion & lifecycle defaults ── */
function InclusionSection({
  settings,
  stages,
  onSave,
}: {
  settings: MarketingSettingsFull;
  stages: LifecycleStageAdmin[];
  onSave: (c: Record<string, unknown>) => Promise<void>;
}) {
  const [tz, setTz] = useState(settings.timezone);
  useEffect(() => setTz(settings.timezone), [settings.timezone]);
  return (
    <section className={cardCls}>
      <div className="flex items-center gap-2 text-sm font-semibold">
        <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
        Contact inclusion &amp; lifecycle
        <span className="ml-auto text-[10px] text-muted-foreground">v{settings.version}</span>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex items-center justify-between gap-2 text-sm">
          Marketing enabled
          <input
            type="checkbox"
            checked={settings.marketing_enabled}
            onChange={(e) => void onSave({ marketing_enabled: e.target.checked })}
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-sm">
          Include all discovered People
          <input
            type="checkbox"
            checked={settings.include_all_discovered}
            onChange={(e) => void onSave({ include_all_discovered: e.target.checked })}
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-sm">
          Default relationship
          <select
            value={settings.default_relationship_type}
            onChange={(e) => void onSave({ default_relationship_type: e.target.value })}
            className={inputCls}
          >
            {[
              "lead",
              "prospect",
              "customer",
              "former_customer",
              "supplier",
              "partner",
              "commercial",
              "other",
            ].map((t) => (
              <option key={t} value={t}>
                {t.replace("_", " ")}
              </option>
            ))}
          </select>
        </label>
        {/* ONE control for the default stage: “make default” in the stage list
            below (atomic server-side — settings key + stage flag together).
            Shown read-only here so there are no two competing controls. */}
        <label className="flex items-center justify-between gap-2 text-sm">
          Default lifecycle stage
          <span className="text-sm text-muted-foreground">
            {stages.find((s) => s.stage_key === settings.default_lifecycle_stage_key)?.label ??
              settings.default_lifecycle_stage_key}{" "}
            <span className="text-[10px]">(change via “make default” below)</span>
          </span>
        </label>
        <label className="flex items-center justify-between gap-2 text-sm">
          Tenant timezone
          <span className="flex items-center gap-1">
            <input
              value={tz}
              onChange={(e) => setTz(e.target.value)}
              placeholder="Europe/London"
              className={cn(inputCls, "w-44")}
            />
            <button
              onClick={() => void onSave({ timezone: tz })}
              disabled={tz === settings.timezone}
              className="rounded-lg border border-hairline bg-white px-2 py-1.5 text-xs disabled:opacity-40"
            >
              Set
            </button>
          </span>
        </label>
      </div>
    </section>
  );
}

/* ── Lifecycle stage administration ── */
function LifecycleSection({
  stages,
  onChanged,
}: {
  stages: LifecycleStageAdmin[];
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [retiring, setRetiring] = useState<{
    stage: LifecycleStageAdmin;
    inUse: number;
    historical: number;
    replacement: string;
  } | null>(null);

  async function run(op: string, args: Record<string, unknown>, okMsg: string) {
    setBusy(true);
    setMsg(null);
    const r = await lifecycleAdmin(op, args);
    setBusy(false);
    if (r.ok) {
      setMsg(okMsg);
      await onChanged();
    } else if (r.error.code === "VERSION_CONFLICT") {
      setMsg("Stage changed elsewhere — reloaded.");
      await onChanged();
    } else setMsg(r.error.message);
  }

  async function startRetire(stage: LifecycleStageAdmin) {
    setMsg(null);
    const r = await lifecycleAdmin("retire_preview", { stage_id: stage.id });
    if (!r.ok) {
      setMsg(r.error.message);
      return;
    }
    setRetiring({
      stage,
      inUse: r.data.active_in_use ?? 0,
      historical: r.data.historical_relationships ?? 0,
      replacement: "",
    });
  }

  const ordered = useMemo(() => [...stages].sort((a, b) => a.sort_order - b.sort_order), [stages]);

  return (
    <section className={cardCls}>
      <div className="text-sm font-semibold">Lifecycle stages</div>
      <p className="mt-1 text-xs text-muted-foreground">
        Stage keys are immutable; stages are retired (never deleted) so historical meaning is
        preserved. Retiring an in-use stage requires an explicit replacement.
      </p>
      {msg && <div className="mt-2 text-xs text-muted-foreground">{msg}</div>}
      <div className="mt-3 space-y-1.5">
        {ordered.map((s, i) => (
          <div key={s.id} className="flex flex-wrap items-center gap-2 text-xs">
            <span className="flex w-10 gap-0.5">
              <button
                disabled={busy || i === 0}
                onClick={() => {
                  // reorder carries per-stage concurrency evidence: the ids AND
                  // each stage's updated_at as loaded (stale → conflict+reload)
                  const rows = [...ordered];
                  [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]];
                  void run(
                    "reorder",
                    {
                      stage_ids: rows.map((x) => x.id),
                      expected_updated_ats: rows.map((x) => x.updated_at),
                    },
                    "Reordered.",
                  );
                }}
                className="disabled:opacity-30"
                aria-label={`Move ${s.label} up`}
              >
                ↑
              </button>
              <button
                disabled={busy || i === ordered.length - 1}
                onClick={() => {
                  const rows = [...ordered];
                  [rows[i], rows[i + 1]] = [rows[i + 1], rows[i]];
                  void run(
                    "reorder",
                    {
                      stage_ids: rows.map((x) => x.id),
                      expected_updated_ats: rows.map((x) => x.updated_at),
                    },
                    "Reordered.",
                  );
                }}
                className="disabled:opacity-30"
                aria-label={`Move ${s.label} down`}
              >
                ↓
              </button>
            </span>
            <input
              defaultValue={s.label}
              onBlur={(e) => {
                if (e.target.value.trim() && e.target.value.trim() !== s.label)
                  void run(
                    "rename",
                    {
                      stage_id: s.id,
                      expected_updated_at: s.updated_at,
                      label: e.target.value.trim(),
                    },
                    "Renamed.",
                  );
              }}
              disabled={busy}
              className={cn(inputCls, "w-40 py-1")}
            />
            <select
              value={s.tone}
              disabled={busy}
              onChange={(e) =>
                void run(
                  "set_tone",
                  { stage_id: s.id, expected_updated_at: s.updated_at, tone: e.target.value },
                  "Tone updated.",
                )
              }
              className={cn(inputCls, "py-1")}
            >
              {["neutral", "info", "positive", "attention", "negative"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <select
              value={s.terminal_outcome ?? ""}
              disabled={busy}
              onChange={(e) =>
                void run(
                  "set_terminal",
                  {
                    stage_id: s.id,
                    expected_updated_at: s.updated_at,
                    terminal_outcome: e.target.value || null,
                  },
                  "Outcome updated.",
                )
              }
              className={cn(inputCls, "py-1")}
            >
              <option value="">no outcome</option>
              {["won", "lost", "nurture"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            {s.is_default ? (
              <span className="rounded-full bg-surface-alt px-2 py-0.5 text-[10px]">default</span>
            ) : s.active ? (
              <button
                disabled={busy}
                onClick={() =>
                  void run(
                    "set_default",
                    { stage_id: s.id, expected_updated_at: s.updated_at },
                    "Default updated.",
                  )
                }
                className="text-[10px] underline"
              >
                make default
              </button>
            ) : null}
            {s.active ? (
              <button
                disabled={busy || s.is_default}
                onClick={() => void startRetire(s)}
                className="text-[10px] text-destructive underline disabled:opacity-30"
                title={s.is_default ? "Set another default first" : "Retire (never deletes)"}
              >
                retire
              </button>
            ) : (
              <>
                <span className="text-[10px] text-muted-foreground">retired</span>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(
                      "reactivate",
                      { stage_id: s.id, expected_updated_at: s.updated_at },
                      "Reactivated.",
                    )
                  }
                  className="text-[10px] underline"
                >
                  reactivate
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs">
        <input
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="stage_key (immutable)"
          className={cn(inputCls, "w-40 py-1")}
        />
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Label"
          className={cn(inputCls, "w-40 py-1")}
        />
        <button
          disabled={busy || !newKey.trim() || !newLabel.trim()}
          onClick={() =>
            void run(
              "add",
              { stage_key: newKey.trim(), label: newLabel.trim() },
              "Stage added.",
            ).then(() => {
              setNewKey("");
              setNewLabel("");
            })
          }
          className="rounded-lg border border-hairline bg-white px-2 py-1 disabled:opacity-40"
        >
          Add stage
        </button>
      </div>

      {retiring && (
        <div className="mt-3 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs">
          <div className="font-medium">
            Retire “{retiring.stage.label}”? This never deletes history.
          </div>
          <p className="mt-1 text-muted-foreground">
            {retiring.inUse > 0
              ? `${retiring.inUse} current ACTIVE relationship(s) use this stage and will be remapped to the replacement you choose.`
              : "No current active relationships use this stage."}
            {retiring.historical > 0 &&
              ` ${retiring.historical} historical (inactive/archived) relationship(s) keep the retired stage for their history — they are never remapped.`}
          </p>
          {retiring.inUse > 0 && (
            <select
              value={retiring.replacement}
              onChange={(e) => setRetiring({ ...retiring, replacement: e.target.value })}
              className={cn(inputCls, "mt-2 py-1")}
            >
              <option value="">Choose replacement stage…</option>
              {ordered
                .filter((x) => x.active && x.id !== retiring.stage.id)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
            </select>
          )}
          <div className="mt-2 flex gap-2">
            <button
              disabled={busy || (retiring.inUse > 0 && !retiring.replacement)}
              onClick={() =>
                void run(
                  "retire",
                  {
                    stage_id: retiring.stage.id,
                    expected_updated_at: retiring.stage.updated_at,
                    ...(retiring.replacement ? { replacement_stage_id: retiring.replacement } : {}),
                  },
                  "Stage retired.",
                ).then(() => setRetiring(null))
              }
              className="rounded-lg border border-hairline bg-white px-3 py-1 font-medium disabled:opacity-40"
            >
              Confirm retire
            </button>
            <button onClick={() => setRetiring(null)} className="px-2 underline">
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/* ── Delivery guardrails & unsubscribe identity ── */
function GuardrailsSection({
  settings,
  onSave,
}: {
  settings: MarketingSettingsFull;
  onSave: (c: Record<string, unknown>) => Promise<void>;
}) {
  const footer = settings.unsubscribe_footer ?? {};
  const guard = settings.settings?.guardrails ?? {};
  const [f, setF] = useState({
    company_name: footer.company_name ?? "",
    address_text: footer.address_text ?? "",
    contact_email: footer.contact_email ?? "",
    footer_text: footer.footer_text ?? "",
  });
  const [maxBulk, setMaxBulk] = useState(String(guard.max_bulk_recipients ?? ""));
  const [qs, setQs] = useState(settings.quiet_hours_start?.toString() ?? "");
  const [qe, setQe] = useState(settings.quiet_hours_end?.toString() ?? "");
  // SYNC after any reload/version-conflict refresh: stale local footer,
  // guardrail or quiet-hour fields must never later overwrite newly loaded
  // server values.
  useEffect(() => {
    setF({
      company_name: settings.unsubscribe_footer?.company_name ?? "",
      address_text: settings.unsubscribe_footer?.address_text ?? "",
      contact_email: settings.unsubscribe_footer?.contact_email ?? "",
      footer_text: settings.unsubscribe_footer?.footer_text ?? "",
    });
    setMaxBulk(String(settings.settings?.guardrails?.max_bulk_recipients ?? ""));
    setQs(settings.quiet_hours_start?.toString() ?? "");
    setQe(settings.quiet_hours_end?.toString() ?? "");
  }, [settings]);
  return (
    <section className={cardCls}>
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Clock className="h-4 w-4 text-muted-foreground" /> Delivery guardrails &amp; unsubscribe
        identity
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Configuration that applies before any sender exists. Sending itself (senders, Workspace
        scopes, delivery) is Phase 4 — honestly <span className="font-medium">Preview</span>.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex items-center justify-between gap-2 text-sm">
          Quiet hours (start–end, tenant time)
          <span className="flex items-center gap-1">
            <input
              value={qs}
              onChange={(e) => setQs(e.target.value)}
              placeholder="21"
              className={cn(inputCls, "w-14 py-1")}
            />
            –
            <input
              value={qe}
              onChange={(e) => setQe(e.target.value)}
              placeholder="8"
              className={cn(inputCls, "w-14 py-1")}
            />
            <button
              onClick={() => {
                if (qs === "" && qe === "") return void onSave({ quiet_hours: null });
                void onSave({ quiet_hours: { start: Number(qs), end: Number(qe) } });
              }}
              className="rounded-lg border border-hairline bg-white px-2 py-1 text-xs"
            >
              Set
            </button>
          </span>
        </label>
        <label className="flex items-center justify-between gap-2 text-sm">
          Open/click tracking
          <input
            type="checkbox"
            checked={settings.tracking_enabled}
            onChange={(e) => void onSave({ tracking_enabled: e.target.checked })}
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-sm">
          Reply handling
          <select
            value={settings.reply_handling}
            onChange={(e) => void onSave({ reply_handling: e.target.value })}
            className={inputCls}
          >
            <option value="workspace">Workspace conversation</option>
            <option value="none">No automatic handling</option>
          </select>
        </label>
        <label className="flex items-center justify-between gap-2 text-sm">
          Max bulk recipients
          <span className="flex items-center gap-1">
            <input
              value={maxBulk}
              onChange={(e) => setMaxBulk(e.target.value)}
              placeholder="500"
              className={cn(inputCls, "w-20 py-1")}
            />
            <button
              onClick={() =>
                void onSave({ guardrails: { ...guard, max_bulk_recipients: Number(maxBulk) } })
              }
              disabled={!maxBulk}
              className="rounded-lg border border-hairline bg-white px-2 py-1 text-xs disabled:opacity-40"
            >
              Set
            </button>
          </span>
        </label>
      </div>
      <div className="mt-3 space-y-2">
        <div className="text-xs font-medium">
          Unsubscribe footer / company identity (plain text)
        </div>
        {(
          [
            ["company_name", "Company name"],
            ["address_text", "Postal address"],
            ["contact_email", "Contact email"],
            ["footer_text", "Footer text"],
          ] as const
        ).map(([k, label]) => (
          <input
            key={k}
            value={f[k]}
            onChange={(e) => setF({ ...f, [k]: e.target.value })}
            placeholder={label}
            className={cn(inputCls, "w-full py-1 text-xs")}
          />
        ))}
        <button
          onClick={() =>
            void onSave({
              unsubscribe_footer: {
                company_name: f.company_name || null,
                address_text: f.address_text || null,
                contact_email: f.contact_email || null,
                footer_text: f.footer_text || null,
              },
            })
          }
          className="rounded-lg border border-hairline bg-white px-3 py-1 text-xs"
        >
          Save footer
        </button>
        {(f.footer_text || f.company_name) && (
          <div className="rounded-lg border border-hairline bg-surface-alt/50 p-2 text-[11px] text-muted-foreground">
            {/* rendered strictly as text — never HTML */}
            <div>{f.footer_text}</div>
            <div>
              {f.company_name}
              {f.address_text ? ` · ${f.address_text}` : ""}
              {f.contact_email ? ` · ${f.contact_email}` : ""}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/* ── Access & permissions ── */
function AccessSection() {
  const [data, setData] = useState<AccessOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const r = await getAccessOverview();
    if (r.ok) {
      setData(r.data);
      setError(null);
    } else setError(r.error.message);
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  async function toggle(
    profileId: string,
    permission: string,
    effective: boolean,
    grants: { permission: string; granted: boolean }[],
  ) {
    setBusy(true);
    setMsg(null);
    const existing = grants.find((g) => g.permission === permission);
    const expected = existing ? (existing.granted ? "granted" : "denied") : "none";
    // effective → introduce/clear a deny; not effective → grant (or clear a deny)
    const mode = effective
      ? existing && !existing.granted
        ? "clear"
        : "deny"
      : existing && !existing.granted
        ? "clear"
        : "grant";
    const r = await setAccessGrant(profileId, permission, mode as never, expected as never);
    setBusy(false);
    if (r.ok) await reload();
    else if (r.error.code === "VERSION_CONFLICT") {
      setMsg("Access changed elsewhere — reloaded.");
      await reload();
    } else if (r.error.code === "LOCKOUT") {
      setMsg("Blocked: that change would remove the last Marketing access manager.");
    } else setMsg(r.error.message);
  }

  if (error)
    return (
      <section className={cardCls}>
        <div className="text-sm font-semibold">Access &amp; permissions</div>
        <Note tone="error">{error}</Note>
      </section>
    );
  if (!data)
    return (
      <section className={cardCls}>
        <div className="text-sm font-semibold">Access &amp; permissions</div>
        <div className="mt-2 text-xs text-muted-foreground">Loading…</div>
      </section>
    );
  return (
    <section className={cardCls}>
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Shield className="h-4 w-4 text-muted-foreground" /> Access &amp; permissions
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Effective access = role defaults + explicit grants − explicit denies. Restricted permissions
        (launch, senders, access management) are owner/admin-only structurally — a grant to another
        role is rejected by the server.
      </p>
      {msg && (
        <div className="mt-2">
          <Note tone="warn">{msg}</Note>
        </div>
      )}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[720px] text-xs">
          <thead>
            <tr className="border-b border-hairline text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="py-1.5 pr-2">User</th>
              {data.permissions.map((p) => (
                <th key={p.permission} className="px-1 py-1.5 text-center" title={p.description}>
                  {p.permission.replace("marketing.", "").replace(".", " ")}
                  {p.restricted ? " •" : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.users.map((u) => (
              <tr key={u.id} className="border-b border-hairline/60 last:border-0">
                <td className="py-1.5 pr-2">
                  <div className="font-medium text-foreground">{u.full_name ?? u.email}</div>
                  <div className="text-[10px] text-muted-foreground">{u.role}</div>
                </td>
                {data.permissions.map((p) => {
                  const effective = u.effective.includes(p.permission);
                  const grant = u.grants.find((g) => g.permission === p.permission);
                  const fromDefault = (data.role_defaults[u.role] ?? []).includes(p.permission);
                  const blocked = p.restricted && !["owner", "admin"].includes(u.role);
                  return (
                    <td key={p.permission} className="px-1 py-1.5 text-center">
                      <button
                        disabled={busy || (blocked && !effective)}
                        onClick={() => void toggle(u.id, p.permission, effective, u.grants)}
                        title={
                          blocked
                            ? "Owner/admin-only permission"
                            : grant
                              ? grant.granted
                                ? "Explicit grant"
                                : "Explicit deny"
                              : fromDefault
                                ? "Role default"
                                : "Not held"
                        }
                        className={cn(
                          "h-5 w-5 rounded border text-[10px] leading-none",
                          effective
                            ? grant && grant.granted
                              ? "border-accent bg-accent/20"
                              : "border-success/40 bg-success/10"
                            : grant && !grant.granted
                              ? "border-destructive/40 bg-destructive/10"
                              : "border-hairline bg-white",
                          blocked && !effective ? "opacity-30" : "",
                        )}
                      >
                        {effective ? "✓" : grant && !grant.granted ? "✕" : ""}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">
        ✓ green = role default · ✓ blue = explicit grant · ✕ = explicit deny · • = owner/admin-only.
      </p>
    </section>
  );
}

/* ── Notifications ── */
function NotificationsSection({
  settings,
  onSave,
}: {
  settings: MarketingSettingsFull;
  onSave: (c: Record<string, unknown>) => Promise<void>;
}) {
  const routing = settings.notification_routing ?? {};
  return (
    <section className={cardCls}>
      <div className="text-sm font-semibold">Notifications</div>
      <p className="mt-1 text-xs text-muted-foreground">
        Only destinations that genuinely exist are offered; richer routing arrives with later phases
        (Preview).
      </p>
      <label className="mt-3 flex items-center justify-between gap-2 text-sm">
        Import failures
        <select
          value={routing.import_failures ?? "none"}
          onChange={(e) =>
            void onSave({ notification_routing: { ...routing, import_failures: e.target.value } })
          }
          className={inputCls}
        >
          <option value="none">Do not notify</option>
          <option value="admins">Notify tenant owners/admins</option>
        </select>
      </label>
    </section>
  );
}

/* ── Governance summary + honest pointers ── */
function GovernanceNote() {
  return (
    <section className={cardCls}>
      <div className="text-sm font-semibold">Tags, segments &amp; later phases</div>
      <p className="mt-1 text-xs text-muted-foreground">
        Tag governance and segment administration live inside{" "}
        <span className="font-medium">Contacts → Tags / Segments</span> (permission:
        marketing.tags.manage). Senders &amp; Workspace connection (Phase 4) and Ads connectors
        (Phase 8) are <span className="font-medium">Preview / Not connected</span> — nothing here
        pretends to send.
      </p>
    </section>
  );
}

/* ── Audit history ── */
function AuditSection() {
  const [rows, setRows] = useState<MarketingAuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prefix, setPrefix] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  // TRUE keyset cursor: the server returns the exact (created_at, id) tuple —
  // rows sharing a boundary timestamp are never skipped.
  const [nextCursor, setNextCursor] = useState<{ t: string; id: string } | null>(null);

  const load = useCallback(
    async (cursor?: { t: string; id: string } | null, append = false) => {
      const r = await listMarketingAudit({
        limit: 25,
        ...(prefix ? { action_prefix: prefix } : {}),
        ...(cursor ? { cursor } : {}),
      });
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      setNextCursor(r.data.next_cursor ?? null);
      setRows((prev) => (append && prev ? [...prev, ...r.data.items] : r.data.items));
    },
    [prefix],
  );
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className={cardCls}>
      <div className="flex items-center gap-2 text-sm font-semibold">
        <History className="h-4 w-4 text-muted-foreground" /> Audit / change history
        <select
          value={prefix}
          onChange={(e) => setPrefix(e.target.value)}
          className={cn(inputCls, "ml-auto py-1 text-xs")}
        >
          <option value="">All Marketing changes</option>
          <option value="marketing.settings">Settings</option>
          <option value="marketing.lifecycle">Lifecycle</option>
          <option value="marketing.access">Access</option>
          <option value="marketing.tag">Tags</option>
          <option value="marketing.segment">Segments</option>
          <option value="marketing.import">Imports</option>
          <option value="marketing.contact">Contacts</option>
        </select>
      </div>
      {error && <Note tone="error">{error}</Note>}
      {!rows && !error && <div className="mt-2 text-xs text-muted-foreground">Loading…</div>}
      {rows && rows.length === 0 && (
        <div className="mt-2 text-xs text-muted-foreground">No Marketing changes recorded yet.</div>
      )}
      {rows && rows.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {rows.map((r) => (
            <div key={r.id} className="flex items-start gap-2 text-xs">
              <span className="mt-0.5 inline-flex rounded-full border border-hairline bg-surface-alt px-1.5 text-[10px]">
                {r.action.replace("marketing.", "")}
              </span>
              <div className="min-w-0">
                <span className="text-foreground">{r.actor}</span>{" "}
                <span className="text-muted-foreground">
                  · {new Date(r.created_at).toLocaleString()} · {r.status}
                </span>
              </div>
            </div>
          ))}
          {nextCursor && (
            <button
              disabled={loadingMore}
              onClick={() => {
                setLoadingMore(true);
                void load(nextCursor, true).then(() => setLoadingMore(false));
              }}
              className="rounded-lg border border-hairline bg-white px-3 py-1 text-xs disabled:opacity-40"
            >
              {loadingMore ? "Loading…" : "Load older"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/* ── Settings snapshots ── */
function HistorySection() {
  const [rows, setRows] = useState<
    { id: string; version: number; changed: string[]; created_at: string }[] | null
  >(null);
  useEffect(() => {
    void listSettingsHistory().then((r) => r.ok && setRows(r.data.history));
  }, []);
  if (!rows || rows.length === 0) return null;
  return (
    <section className={cardCls}>
      <div className="text-sm font-semibold">Settings snapshots</div>
      <p className="mt-1 text-xs text-muted-foreground">
        Every settings change preserves the full previous configuration (append-only).
      </p>
      <div className="mt-2 space-y-1 text-xs">
        {rows.slice(0, 10).map((h) => (
          <div key={h.id} className="text-muted-foreground">
            v{h.version} superseded {new Date(h.created_at).toLocaleString()} — changed:{" "}
            {h.changed.join(", ")}
          </div>
        ))}
      </div>
    </section>
  );
}
