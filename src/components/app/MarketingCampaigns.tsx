/**
 * MarketingCampaigns — the Campaigns area (Phase 5).
 *
 * Internal navigation, in this exact order: Broadcasts (operational) ·
 * Sequences (Preview) · Templates (Preview) · Objectives & Reporting (Preview
 * except the real Broadcast summary) · AI Drafting (Preview).
 *
 * Broadcasts is the real Phase-5 surface: draft → review → approve →
 * preflight (immutable audience snapshot) → explicit confirmed launch or
 * timezone-aware schedule → factual per-recipient reporting. Every number
 * shown is a persisted server fact; "submitted" means Gmail accepted the
 * request — never "delivered" — and unknown results are surfaced loudly, not
 * hidden. Hidden controls are NOT the security boundary: the Edge Function
 * and the SQL resolver re-check every permission on every call.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  BarChart3,
  Bot,
  CheckCircle2,
  ChevronLeft,
  Copy,
  FileText,
  ListFilter,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Send,
  ShieldAlert,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  EXCLUSION_REASON_LABELS,
  createCampaign,
  duplicateCampaign,
  getCampaignDetail,
  getCampaignReport,
  getRecipientPage,
  launchCampaign,
  listCampaigns,
  newCampaignTestRequestId,
  newLaunchRequestId,
  previewAudience,
  reviseCampaign,
  runPreflight,
  scheduleCampaign,
  sendCampaignTest,
  transitionCampaign,
  type CampaignContentInput,
  type CampaignDetail,
  type CampaignListData,
  type CampaignListRow,
  type CampaignReport,
  type CampaignStatus,
  type PreflightResult,
  type RecipientRow,
} from "@/lib/marketing/campaigns";
import {
  getSendersOverview,
  listTestRecipients,
  senderCanLaunchCampaign,
  type TestRecipient,
} from "@/lib/marketing/senders";
import { listSegments } from "@/lib/marketing/segments";
import { MarketingSequences } from "@/components/app/MarketingSequences";
import { MarketingTemplates } from "@/components/app/MarketingTemplates";
import { MarketingReporting } from "@/components/app/MarketingReporting";
import { MarketingAiDrafting } from "@/components/app/MarketingAiDrafting";
import { useMarketingAccess } from "@/lib/marketing/useMarketingAccess";

/* ── shared atoms ─────────────────────────────────────────────────────────── */

const STATUS_TONE: Record<CampaignStatus, string> = {
  draft: "border-hairline bg-surface-alt text-muted-foreground",
  review: "border-warning/30 bg-warning/10 text-warning",
  approved: "border-accent/30 bg-accent/10 text-accent",
  scheduled: "border-accent/30 bg-accent/10 text-accent",
  active: "border-success/30 bg-success/10 text-success",
  paused: "border-warning/30 bg-warning/10 text-warning",
  completed: "border-success/30 bg-success/10 text-success",
  cancelled: "border-destructive/30 bg-destructive/10 text-destructive",
  archived: "border-hairline bg-surface-alt text-muted-foreground",
};

function StatusBadge({ status }: { status: CampaignStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        STATUS_TONE[status] ?? STATUS_TONE.draft,
      )}
    >
      {status}
    </span>
  );
}

function Btn({
  children,
  onClick,
  tone = "default",
  disabled,
  busy,
  title,
  ref,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  tone?: "default" | "primary" | "danger";
  disabled?: boolean;
  busy?: boolean;
  title?: string;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      onClick={onClick}
      disabled={disabled || busy}
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        tone === "primary" && "bg-foreground text-background hover:opacity-90",
        tone === "danger" &&
          "border border-destructive/30 bg-destructive/5 text-destructive hover:bg-destructive/10",
        tone === "default" &&
          "border border-hairline bg-white text-foreground hover:bg-surface-alt",
      )}
    >
      {busy && <Loader2 className="h-3 w-3 animate-spin" />}
      {children}
    </button>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-medium text-foreground">{label}</div>
      {children}
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm text-foreground outline-none transition focus:border-foreground/40";

function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <AlertTriangle className="h-4 w-4 text-destructive" /> Something went wrong
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 rounded-lg border border-hairline bg-white px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-surface-alt"
        >
          Retry
        </button>
      )}
    </div>
  );
}

/* ── personalisation help ─────────────────────────────────────────────────── */

const TOKEN_HELP: { token: string; source: string }[] = [
  { token: "{{first_name}}", source: "Person first name" },
  { token: "{{last_name}}", source: "Person last name" },
  { token: "{{display_name}}", source: "Person display name" },
  { token: "{{company_name}}", source: "Linked company name" },
];

/* ── editor ───────────────────────────────────────────────────────────────── */

interface EditorProps {
  mode: "create" | "revise";
  initial: CampaignContentInput;
  expectedVersion?: number;
  campaignId?: string;
  onDone: (campaignId: string | null) => void;
  onCancel: () => void;
}

function CampaignEditor({
  mode,
  initial,
  expectedVersion,
  campaignId,
  onDone,
  onCancel,
}: EditorProps) {
  const [form, setForm] = useState<CampaignContentInput>(initial);
  const [senders, setSenders] = useState<{ id: string; label: string; ready: boolean }[]>([]);
  const [segments, setSegments] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fallbackDraft, setFallbackDraft] = useState<Record<string, string>>(
    initial.token_fallbacks ?? {},
  );

  useEffect(() => {
    (async () => {
      const [sv, sg] = await Promise.all([getSendersOverview(), listSegments()]);
      if (sv.ok) {
        setSenders(
          (sv.data.senders ?? []).filter(senderCanLaunchCampaign).map((s) => ({
            id: s.id,
            label: `${s.label || s.mailbox_address} (${s.mailbox_address})`,
            ready: true,
          })),
        );
      }
      if (sg.ok) setSegments((sg.data.segments ?? []).map((s) => ({ id: s.id, name: s.name })));
    })();
  }, []);

  const usedTokens = useMemo(() => {
    const text = `${form.subject ?? ""}\n${form.body_authored ?? ""}`;
    const found = new Set<string>();
    for (const m of text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)) found.add(m[1]);
    return [...found];
  }, [form.subject, form.body_authored]);

  const textPreview = useMemo(() => {
    const render = (v: string) =>
      v
        .replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_m, t: string) => fallbackDraft[t] || `[${t}]`)
        .replace(
          /\[([^\][]{1,200})\]\((https?:\/\/[^\s()<>]+)\)/g,
          (_m, label: string, url: string) => `${label} (${url})`,
        );
    return render(form.body_authored ?? "");
  }, [form.body_authored, fallbackDraft]);

  const save = async () => {
    setSaving(true);
    setError(null);
    const payload: CampaignContentInput = {
      ...form,
      token_fallbacks: Object.fromEntries(
        Object.entries(fallbackDraft).filter(([, v]) => v.trim().length > 0),
      ),
    };
    const res =
      mode === "create"
        ? await createCampaign(payload)
        : await reviseCampaign(campaignId!, expectedVersion!, payload);
    setSaving(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    onDone(mode === "create" ? (res.data as { id: string }).id : (campaignId ?? null));
  };

  return (
    <div className="rounded-xl border border-hairline bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold text-foreground">
          {mode === "create" ? "New broadcast" : "Revise broadcast"}
        </div>
        {mode === "revise" && (
          <div className="text-[11px] text-muted-foreground">
            Saving creates revision {`>`} — the campaign returns to draft and any approval,
            preflight snapshot and launch confirmation are invalidated (history is kept).
          </div>
        )}
      </div>
      {error && (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Name">
          <input
            className={inputCls}
            value={form.name ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            maxLength={120}
          />
        </Field>
        <Field label="Description (optional)">
          <input
            className={inputCls}
            value={form.description ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            maxLength={500}
          />
        </Field>
        <Field label="Sender" hint="Only enabled, ready senders can launch.">
          <select
            className={inputCls}
            value={form.sender_id ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, sender_id: e.target.value }))}
          >
            <option value="">Select a sender…</option>
            {senders.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
                {s.ready ? "" : " — not ready"}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Saved segment"
          hint="The audience is a saved query; launch uses an immutable snapshot."
        >
          <select
            className={inputCls}
            value={form.segment_id ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, segment_id: e.target.value }))}
          >
            <option value="">Select a segment…</option>
            {segments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Subject">
          <input
            className={inputCls}
            value={form.subject ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
            maxLength={300}
          />
        </Field>
        <Field label="Preview text (optional)" hint="Shown by inbox clients next to the subject.">
          <input
            className={inputCls}
            value={form.preview_text ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, preview_text: e.target.value }))}
            maxLength={150}
          />
        </Field>
      </div>
      <div className="mt-3">
        <Field
          label="Body"
          hint="Plain text. Personalisation: {{first_name}} {{last_name}} {{display_name}} {{company_name}}. Links: [label](https://destination). No HTML — the HTML version is derived safely."
        >
          <textarea
            className={cn(inputCls, "min-h-[180px] font-mono text-[13px]")}
            value={form.body_authored ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, body_authored: e.target.value }))}
            maxLength={20000}
          />
        </Field>
      </div>
      {usedTokens.length > 0 && (
        <div className="mt-3 rounded-lg border border-hairline bg-surface-alt/50 p-3">
          <div className="text-xs font-medium text-foreground">
            Personalisation fallbacks (used when a recipient has no value)
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
            {usedTokens.map((t) => (
              <Field key={t} label={`{{${t}}} fallback`}>
                <input
                  className={inputCls}
                  value={fallbackDraft[t] ?? ""}
                  placeholder="Leave empty to EXCLUDE recipients missing this value"
                  onChange={(e) => setFallbackDraft((d) => ({ ...d, [t]: e.target.value }))}
                  maxLength={200}
                />
              </Field>
            ))}
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">
            Without a fallback, recipients missing a used token are excluded at preflight with the
            exact reason recorded.
          </div>
        </div>
      )}
      <div className="mt-3 rounded-lg border border-hairline bg-surface-alt/50 p-3">
        <div className="text-xs font-medium text-foreground">
          Plain-text preview (fallback values)
        </div>
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-[12px] text-muted-foreground">
          {textPreview || "—"}
        </pre>
        <div className="mt-1 text-[11px] text-muted-foreground">
          Recipients receive text + a safely derived HTML version, both ending with the visible
          unsubscribe footer.
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <Btn tone="primary" onClick={save} busy={saving}>
          {mode === "create" ? "Create draft" : "Save as new revision"}
        </Btn>
        <Btn onClick={onCancel}>Cancel</Btn>
        <div className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
          {TOKEN_HELP.map((t) => (
            <code key={t.token} className="rounded bg-surface-alt px-1.5 py-0.5" title={t.source}>
              {t.token}
            </code>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── launch dialog ────────────────────────────────────────────────────────── */

function LaunchDialog({
  campaign,
  preflight,
  onClose,
  onLaunched,
}: {
  campaign: CampaignDetail;
  preflight: PreflightResult;
  onClose: () => void;
  onLaunched: () => void;
}) {
  const [mode, setMode] = useState<"immediate" | "scheduled">("immediate");
  const [scheduleLocal, setScheduleLocal] = useState("");
  const [timezone, setTimezone] = useState("Europe/London");
  const [fold, setFold] = useState<"earlier" | "later" | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId] = useState(newLaunchRequestId());
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // launching sends real external email: the dialog takes focus, traps Tab and
  // closes on Escape, so it can never be confirmed by a stray keypress behind it
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const go = async () => {
    setBusy(true);
    setError(null);
    const common = {
      campaign_id: campaign.id,
      confirmation_id: preflight.confirmation_id,
      challenge: preflight.challenge,
      request_id: requestId,
    };
    const res =
      mode === "immediate"
        ? await launchCampaign(common)
        : await scheduleCampaign({
            ...common,
            schedule_local: scheduleLocal,
            timezone,
            ...(fold ? { fold } : {}),
          });
    setBusy(false);
    if (!res.ok) {
      setError(
        res.error.code === "DST_AMBIGUOUS"
          ? "That local time occurs twice (clocks go back). Choose “earlier” or “later” below and confirm again."
          : res.error.message,
      );
      return;
    }
    onLaunched();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="launch-dialog-title"
        className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-xl border border-hairline bg-white p-5"
      >
        <div id="launch-dialog-title" className="text-sm font-semibold text-foreground">
          Confirm launch
        </div>
        <div className="mt-3 space-y-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-foreground">
          <p className="font-medium">
            This sends real external email to {preflight.included_count} recipient
            {preflight.included_count === 1 ? "" : "s"} when deployed.
          </p>
          <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
            <li>
              Sender:{" "}
              <span className="text-foreground">
                {campaign.revision?.sender_profile_id && preflight
                  ? "the approved campaign sender"
                  : "—"}
              </span>{" "}
              · audience snapshot taken {new Date(preflight.created_at).toLocaleString()}.
            </li>
            <li>“Submitted” means Gmail accepted the request — it is not delivery proof.</li>
            <li>
              Suppression, unsubscribes and preference are re-checked for every recipient at
              execution time; ineligible recipients are skipped, never overridden.
            </li>
            <li>
              Pause stops recipients that have not been prepared; an already executing provider call
              may still finish.
            </li>
            <li>
              Gmail offers no exactly-once guarantee: an unknown outcome freezes that recipient for
              review and is never silently retried.
            </li>
          </ul>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Btn
            tone={mode === "immediate" ? "primary" : "default"}
            onClick={() => setMode("immediate")}
          >
            Send now
          </Btn>
          <Btn
            tone={mode === "scheduled" ? "primary" : "default"}
            onClick={() => setMode("scheduled")}
          >
            Schedule
          </Btn>
        </div>
        {mode === "scheduled" && (
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Local date & time" hint="YYYY-MM-DD HH:MM in the chosen timezone">
              <input
                className={inputCls}
                placeholder="2026-08-01 09:00"
                value={scheduleLocal}
                onChange={(e) => setScheduleLocal(e.target.value)}
              />
            </Field>
            <Field label="IANA timezone">
              <input
                className={inputCls}
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              />
            </Field>
            <Field
              label="DST fold (only if prompted)"
              hint="Needed only when the local time occurs twice"
            >
              <select
                className={inputCls}
                value={fold}
                onChange={(e) => setFold(e.target.value as typeof fold)}
              >
                <option value="">Not needed</option>
                <option value="earlier">Earlier occurrence</option>
                <option value="later">Later occurrence</option>
              </select>
            </Field>
          </div>
        )}
        {error && (
          <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
        <div className="mt-4 flex items-center justify-end gap-2">
          <Btn ref={cancelRef} onClick={onClose}>
            Cancel
          </Btn>
          <Btn tone="primary" onClick={go} busy={busy}>
            {mode === "immediate"
              ? `Launch to ${preflight.included_count} recipients`
              : "Confirm schedule"}
          </Btn>
        </div>
        <div className="mt-2 text-right text-[10px] text-muted-foreground">
          Server confirmation {preflight.confirmation_id.slice(0, 8)}… expires{" "}
          {new Date(preflight.expires_at).toLocaleTimeString()} — a refreshed preflight requires a
          new confirmation.
        </div>
      </div>
    </div>
  );
}

/* ── campaign detail ──────────────────────────────────────────────────────── */

function CampaignDetailView({
  campaignId,
  caps,
  onBack,
  onChanged,
}: {
  campaignId: string;
  caps: Pick<
    CampaignListData,
    "can_draft" | "can_test" | "can_launch" | "can_report" | "unsubscribe_configured"
  >;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [report, setReport] = useState<CampaignReport | null>(null);
  const [recipients, setRecipients] = useState<RecipientRow[]>([]);
  const [nextCursor, setNextCursor] = useState<{ at: string; id: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [showLaunch, setShowLaunch] = useState(false);
  const [testRecipients, setTestRecipients] = useState<TestRecipient[]>([]);
  const [testRecipient, setTestRecipient] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const d = await getCampaignDetail(campaignId);
    if (!d.ok) {
      setError(d.error.message);
      setLoading(false);
      return;
    }
    setDetail(d.data);
    if (caps.can_report) {
      const r = await getCampaignReport(campaignId);
      if (r.ok) setReport(r.data);
      const p = await getRecipientPage(campaignId, null);
      if (p.ok) {
        setRecipients(p.data.recipients);
        setNextCursor(p.data.next_cursor);
      }
    }
    setLoading(false);
  }, [campaignId, caps.can_report]);

  useEffect(() => {
    reload();
  }, [reload]);
  useEffect(() => {
    if (caps.can_test) {
      listTestRecipients().then((r) => {
        if (r.ok) setTestRecipients(r.data.recipients);
      });
    }
  }, [caps.can_test]);

  const doTransition = async (
    action:
      "submit_review" | "request_changes" | "approve" | "pause" | "resume" | "cancel" | "archive",
  ) => {
    if (!detail) return;
    if (
      action === "cancel" &&
      !window.confirm(
        "Cancel this campaign? Unsent recipients are cancelled; anything already executing may still finish.",
      )
    )
      return;
    setBusyAction(action);
    setNotice(null);
    const res = await transitionCampaign(action, detail.id, detail.version);
    setBusyAction(null);
    if (!res.ok) {
      setNotice(res.error.message);
      return;
    }
    setPreflight(null);
    await reload();
    onChanged();
  };

  const doPreflight = async () => {
    if (!detail) return;
    setBusyAction("preflight");
    setNotice(null);
    const res = await runPreflight(detail.id, detail.version);
    setBusyAction(null);
    if (!res.ok) {
      setNotice(
        res.error.code === "CONFIG_REQUIRED"
          ? "The Marketing public base URL is not configured on the server — unsubscribe links cannot be built, so launch is unavailable."
          : res.error.message,
      );
      return;
    }
    setPreflight(res.data);
    await reload();
  };

  const doTest = async () => {
    if (!detail || !testRecipient) return;
    setBusyAction("test");
    setNotice(null);
    const res = await sendCampaignTest({
      campaign_id: detail.id,
      recipient_profile_id: testRecipient,
      request_id: newCampaignTestRequestId(),
    });
    setBusyAction(null);
    setNotice(
      res.ok
        ? "Test queued through the governed pipeline (visible under Senders → recent test sends)."
        : res.error.message,
    );
  };

  const doDuplicate = async () => {
    if (!detail) return;
    setBusyAction("duplicate");
    const res = await duplicateCampaign(detail.id);
    setBusyAction(null);
    if (res.ok) {
      onChanged();
      onBack();
    } else setNotice(res.error.message);
  };

  if (loading) {
    return (
      <div className="grid min-h-[30vh] place-items-center text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading campaign…
        </span>
      </div>
    );
  }
  if (error || !detail) return <ErrorNote message={error ?? "Not found"} onRetry={reload} />;

  const rev = detail.revision;
  const dispatch = report?.dispatch ?? {};
  const unknownCount = dispatch.unknown ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-lg border border-hairline bg-white px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-alt"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> All broadcasts
        </button>
        <div className="text-display text-lg font-semibold">{detail.name}</div>
        <StatusBadge status={detail.status} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {caps.can_draft && ["draft", "review", "approved"].includes(detail.status) && (
            <Btn onClick={() => setEditing(true)}>
              <SlidersHorizontal className="h-3.5 w-3.5" /> Revise
            </Btn>
          )}
          {caps.can_draft && (
            <Btn onClick={doDuplicate} busy={busyAction === "duplicate"}>
              <Copy className="h-3.5 w-3.5" /> Duplicate
            </Btn>
          )}
          {caps.can_draft && detail.status === "draft" && (
            <Btn
              tone="primary"
              onClick={() => doTransition("submit_review")}
              busy={busyAction === "submit_review"}
            >
              Submit for review
            </Btn>
          )}
          {caps.can_launch && detail.status === "review" && (
            <>
              <Btn
                onClick={() => doTransition("request_changes")}
                busy={busyAction === "request_changes"}
              >
                Request changes
              </Btn>
              <Btn
                tone="primary"
                onClick={() => doTransition("approve")}
                busy={busyAction === "approve"}
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Approve
              </Btn>
            </>
          )}
          {caps.can_launch && detail.status === "approved" && (
            <Btn tone="primary" onClick={doPreflight} busy={busyAction === "preflight"}>
              Run preflight
            </Btn>
          )}
          {caps.can_launch && ["scheduled", "active"].includes(detail.status) && (
            <Btn onClick={() => doTransition("pause")} busy={busyAction === "pause"}>
              <Pause className="h-3.5 w-3.5" /> Pause
            </Btn>
          )}
          {caps.can_launch && detail.status === "paused" && (
            <Btn
              tone="primary"
              onClick={() => doTransition("resume")}
              busy={busyAction === "resume"}
            >
              <Play className="h-3.5 w-3.5" /> Resume
            </Btn>
          )}
          {caps.can_launch && ["scheduled", "active", "paused"].includes(detail.status) && (
            <Btn
              tone="danger"
              onClick={() => doTransition("cancel")}
              busy={busyAction === "cancel"}
            >
              <XCircle className="h-3.5 w-3.5" /> Cancel
            </Btn>
          )}
          {caps.can_launch && ["completed", "cancelled"].includes(detail.status) && (
            <Btn onClick={() => doTransition("archive")} busy={busyAction === "archive"}>
              <Archive className="h-3.5 w-3.5" /> Archive
            </Btn>
          )}
        </div>
      </div>

      {notice && (
        <div className="rounded-lg border border-hairline bg-surface-alt px-3 py-2 text-xs text-foreground">
          {notice}
        </div>
      )}
      {unknownCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs font-medium text-foreground">
          <AlertTriangle className="h-4 w-4 text-warning" />
          {unknownCount} recipient{unknownCount === 1 ? "" : "s"} with an UNKNOWN provider result —
          frozen for review, never auto-retried, and completion is blocked until resolved.
        </div>
      )}

      {editing && rev && (
        <CampaignEditor
          mode="revise"
          campaignId={detail.id}
          expectedVersion={detail.version}
          initial={{
            name: detail.name,
            description: detail.description ?? undefined,
            sender_id: rev.sender_profile_id,
            segment_id: rev.segment_id,
            subject: rev.subject,
            preview_text: rev.preview_text ?? undefined,
            body_authored: rev.body_authored,
            token_fallbacks: rev.token_fallbacks,
          }}
          onDone={() => {
            setEditing(false);
            setPreflight(null);
            reload();
            onChanged();
          }}
          onCancel={() => setEditing(false)}
        />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* content */}
        <div className="rounded-xl border border-hairline bg-white p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Approved content · revision {rev?.revision_number ?? "—"}
          </div>
          <div className="mt-2 text-sm font-medium text-foreground">{rev?.subject ?? "—"}</div>
          {rev?.preview_text && (
            <div className="mt-0.5 text-xs text-muted-foreground">{rev.preview_text}</div>
          )}
          <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-alt/50 p-3 text-[12px] text-muted-foreground">
            {rev?.body_authored ?? "—"}
          </pre>
          {caps.can_test && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
              <select
                className={cn(inputCls, "max-w-[240px] py-1.5 text-xs")}
                value={testRecipient}
                onChange={(e) => setTestRecipient(e.target.value)}
              >
                <option value="">Test recipient (workspace user)…</option>
                {testRecipients.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.email}
                  </option>
                ))}
              </select>
              <Btn onClick={doTest} disabled={!testRecipient} busy={busyAction === "test"}>
                <Send className="h-3.5 w-3.5" /> Send test
              </Btn>
              <span className="text-[11px] text-muted-foreground">
                Governed Phase-4 test send — tokens show fallbacks or [token].
              </span>
            </div>
          )}
        </div>

        {/* preflight / snapshot */}
        <div className="rounded-xl border border-hairline bg-white p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Audience preflight
          </div>
          {preflight ? (
            <div className="mt-2 space-y-2 text-xs">
              <div className="flex flex-wrap gap-3">
                <div>
                  <span className="text-display text-xl font-semibold">
                    {preflight.included_count}
                  </span>{" "}
                  <span className="text-muted-foreground">included</span>
                </div>
                <div>
                  <span className="text-display text-xl font-semibold">
                    {preflight.excluded_count}
                  </span>{" "}
                  <span className="text-muted-foreground">excluded</span>
                </div>
                <div>
                  <span className="text-display text-xl font-semibold">
                    {preflight.candidate_count}
                  </span>{" "}
                  <span className="text-muted-foreground">candidates</span>
                </div>
              </div>
              <ExclusionBreakdown breakdown={preflight.exclusion_breakdown} />
              <div className="text-[11px] text-muted-foreground">
                Snapshot {preflight.snapshot_hash.slice(0, 12)}… taken{" "}
                {new Date(preflight.created_at).toLocaleString()} · samples:{" "}
                {preflight.included_samples.map((s) => s.destination_masked).join(", ") || "—"}
              </div>
              <div className="flex items-center gap-2 pt-1">
                {caps.can_launch && (
                  <Btn tone="primary" onClick={() => setShowLaunch(true)}>
                    <Send className="h-3.5 w-3.5" /> Launch / schedule…
                  </Btn>
                )}
                <Btn onClick={doPreflight} busy={busyAction === "preflight"}>
                  <RefreshCw className="h-3.5 w-3.5" /> Refresh preflight
                </Btn>
              </div>
              <div className="text-[11px] text-muted-foreground">
                Refreshing creates a NEW immutable snapshot and requires a new confirmation — the
                old one can no longer launch.
              </div>
            </div>
          ) : detail.snapshot ? (
            <div className="mt-2 space-y-2 text-xs">
              <div className="flex flex-wrap gap-3">
                <div>
                  <span className="text-display text-xl font-semibold">
                    {detail.snapshot.included_count}
                  </span>{" "}
                  <span className="text-muted-foreground">included</span>
                </div>
                <div>
                  <span className="text-display text-xl font-semibold">
                    {detail.snapshot.excluded_count}
                  </span>{" "}
                  <span className="text-muted-foreground">excluded</span>
                </div>
              </div>
              <ExclusionBreakdown breakdown={detail.snapshot.exclusion_breakdown} />
              <div className="text-[11px] text-muted-foreground">
                Launch snapshot {detail.snapshot.snapshot_hash.slice(0, 12)}… taken{" "}
                {new Date(detail.snapshot.created_at).toLocaleString()} (immutable).
              </div>
            </div>
          ) : (
            <div className="mt-2 text-xs text-muted-foreground">
              {detail.status === "approved"
                ? caps.unsubscribe_configured
                  ? "Run preflight to build the immutable audience snapshot and launch confirmation."
                  : "Launch requires the server-configured Marketing public base URL (unsubscribe links). Ask an administrator to configure MARKETING_PUBLIC_BASE_URL."
                : "Preflight becomes available once the campaign is approved."}
            </div>
          )}
        </div>
      </div>

      {/* report */}
      {caps.can_report && report && (
        <div className="rounded-xl border border-hairline bg-white p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Delivery report — factual counts only
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            {(
              [
                ["pending", "Pending"],
                ["preparing", "Preparing"],
                ["queued", "Queued"],
                ["executing", "Executing"],
                ["submitted", "Submitted"],
                ["skipped", "Skipped"],
                ["failed", "Failed"],
                ["unknown", "Unknown"],
              ] as const
            ).map(([k, label]) => (
              <div
                key={k}
                className={cn(
                  "rounded-lg border border-hairline bg-surface-alt/40 p-2 text-center",
                  k === "unknown" &&
                    (dispatch.unknown ?? 0) > 0 &&
                    "border-warning/50 bg-warning/10",
                )}
              >
                <div className="tabular text-lg font-semibold text-foreground">
                  {dispatch[k] ?? 0}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {label}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span>Cancelled: {dispatch.cancelled ?? 0}</span>
            <span>Unsubscribed via this campaign: {report.unsubscribed}</span>
            <span>Delivered / opened / replied / bounced: not reported by provider</span>
            <span>Clicks: unavailable — click tracking is not implemented (never fabricated)</span>
            <span className="font-medium text-foreground">{report.submitted_meaning}</span>
          </div>

          {recipients.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-hairline text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-1.5 pr-3">Recipient</th>
                    <th className="py-1.5 pr-3">Destination</th>
                    <th className="py-1.5 pr-3">State</th>
                    <th className="py-1.5 pr-3">Reason / evidence</th>
                    <th className="py-1.5">Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {recipients.map((r) => (
                    <tr key={r.dispatch_id} className="border-b border-hairline/60">
                      <td className="py-1.5 pr-3 text-foreground">
                        {r.display_name ?? r.person_id.slice(0, 8)}
                      </td>
                      <td className="py-1.5 pr-3 text-muted-foreground">{r.destination ?? "—"}</td>
                      <td className="py-1.5 pr-3">
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase",
                            r.status === "submitted" && "bg-success/10 text-success",
                            r.status === "unknown" && "bg-warning/20 text-warning",
                            r.status === "failed" && "bg-destructive/10 text-destructive",
                            !["submitted", "unknown", "failed"].includes(r.status) &&
                              "bg-surface-alt text-muted-foreground",
                          )}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3 text-muted-foreground">
                        {r.skip_reason ?? r.failure_class ?? "—"}
                      </td>
                      <td className="py-1.5 text-muted-foreground">
                        {r.submitted_at ? new Date(r.submitted_at).toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {nextCursor && (
                <div className="mt-2">
                  <Btn
                    onClick={async () => {
                      const p = await getRecipientPage(campaignId, nextCursor);
                      if (p.ok) {
                        setRecipients((prev) => [...prev, ...p.data.recipients]);
                        setNextCursor(p.data.next_cursor);
                      }
                    }}
                  >
                    Load more
                  </Btn>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* history */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-hairline bg-white p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Approval history (append-only)
          </div>
          <div className="mt-2 space-y-1.5 text-xs">
            {detail.approvals.length === 0 && (
              <div className="text-muted-foreground">No approvals yet.</div>
            )}
            {detail.approvals.map((a) => (
              <div key={a.id} className="flex items-center gap-2">
                {a.decision === "approved" ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 text-warning" />
                )}
                <span className="text-foreground">{a.decision.replace("_", " ")}</span>
                <span className="text-muted-foreground">
                  by {a.approver ?? "—"} · {new Date(a.created_at).toLocaleString()}
                  {a.note ? ` · “${a.note}”` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-hairline bg-white p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            State history (factual transitions)
          </div>
          <div className="mt-2 max-h-44 space-y-1 overflow-auto text-xs">
            {detail.events.map((e) => (
              <div key={e.seq} className="text-muted-foreground">
                <span className="tabular">{new Date(e.at).toLocaleString()}</span>{" "}
                <span className="text-foreground">
                  {e.from ?? "∅"} → {e.to}
                </span>{" "}
                · {e.actor ?? "system"}
                {e.detail ? ` · ${e.detail}` : ""}
              </div>
            ))}
          </div>
        </div>
      </div>

      {showLaunch && preflight && (
        <LaunchDialog
          campaign={detail}
          preflight={preflight}
          onClose={() => setShowLaunch(false)}
          onLaunched={() => {
            setShowLaunch(false);
            setPreflight(null);
            reload();
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function ExclusionBreakdown({ breakdown }: { breakdown: Record<string, number> }) {
  const entries = Object.entries(breakdown ?? {});
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([reason, n]) => (
        <span
          key={reason}
          className="rounded-full border border-hairline bg-surface-alt px-2 py-0.5 text-[10px] text-muted-foreground"
          title={reason}
        >
          {EXCLUSION_REASON_LABELS[reason] ?? reason}: {n}
        </span>
      ))}
    </div>
  );
}

/* ── broadcasts tab ───────────────────────────────────────────────────────── */

function BroadcastsTab() {
  const [data, setData] = useState<CampaignListData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await listCampaigns();
    if (!r.ok) setError(r.error.message);
    else setData(r.data);
    setLoading(false);
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);

  if (loading) {
    return (
      <div className="grid min-h-[30vh] place-items-center text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading broadcasts…
        </span>
      </div>
    );
  }
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return null;

  if (selected) {
    return (
      <CampaignDetailView
        campaignId={selected}
        caps={data}
        onBack={() => setSelected(null)}
        onChanged={reload}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="max-w-2xl text-sm text-muted-foreground">
          One-off governed sends: immutable audience snapshots, per-recipient evidence, suppression
          re-checked at execution.
        </p>
        <div className="ml-auto">
          {data.can_draft && (
            <Btn tone="primary" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" /> New broadcast
            </Btn>
          )}
        </div>
      </div>

      {!data.unsubscribe_configured && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
          <ShieldAlert className="h-4 w-4 text-warning" />
          Configuration required: the server has no MARKETING_PUBLIC_BASE_URL, so unsubscribe links
          cannot be built. Drafting and review work; preflight and launch are unavailable until an
          administrator configures it.
        </div>
      )}
      {!data.can_draft && (
        <div className="rounded-lg border border-hairline bg-surface-alt px-3 py-2 text-xs text-muted-foreground">
          Your role can view broadcasts. Drafting requires the campaigns.draft permission; approving
          and launching require an owner/admin with the launch permission.
        </div>
      )}

      {creating && (
        <CampaignEditor
          mode="create"
          initial={{}}
          onDone={(id) => {
            setCreating(false);
            reload();
            if (id) setSelected(id);
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {data.campaigns.length === 0 && !creating ? (
        <div className="grid min-h-[30vh] place-items-center rounded-xl border border-hairline bg-white">
          <div className="max-w-sm p-6 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-surface-alt">
              <Send className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="text-display mt-3 text-lg font-semibold">No broadcasts yet</div>
            <p className="mt-1 text-sm text-muted-foreground">
              {data.can_draft
                ? "Create your first broadcast: pick an authorised sender and a saved segment, author the content once, and every send stays governed."
                : "Broadcasts appear here once a drafter creates one."}
            </p>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-hairline bg-white">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-hairline text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Campaign</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Owner</th>
                <th className="px-3 py-2">Sender</th>
                <th className="px-3 py-2">Segment</th>
                <th className="px-3 py-2">Rev</th>
                <th className="px-3 py-2">Schedule</th>
                <th className="px-3 py-2">Audience</th>
                <th className="px-3 py-2">Sub / Skip / Fail / Unk</th>
                <th className="px-3 py-2">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {data.campaigns.map((c) => (
                <CampaignRowView key={c.id} row={c} onOpen={() => setSelected(c.id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CampaignRowView({ row, onOpen }: { row: CampaignListRow; onOpen: () => void }) {
  const d = row.dispatch_counts ?? {};
  return (
    <tr
      onClick={onOpen}
      className="cursor-pointer border-b border-hairline/60 transition hover:bg-surface-alt/50"
    >
      <td className="px-3 py-2">
        <div className="font-medium text-foreground">{row.name}</div>
        {row.description && (
          <div className="max-w-[220px] truncate text-[11px] text-muted-foreground">
            {row.description}
          </div>
        )}
      </td>
      <td className="px-3 py-2">
        <StatusBadge status={row.status} />
      </td>
      <td className="px-3 py-2 text-muted-foreground">{row.owner_email ?? "—"}</td>
      <td className="px-3 py-2 text-muted-foreground">{row.sender_mailbox ?? "—"}</td>
      <td className="px-3 py-2 text-muted-foreground">{row.segment_name ?? "—"}</td>
      <td className="tabular px-3 py-2 text-muted-foreground">{row.revision_number ?? "—"}</td>
      <td className="px-3 py-2 text-muted-foreground">
        {row.status === "scheduled" && row.schedule_local
          ? `${row.schedule_local} ${row.timezone ?? ""}`
          : "—"}
      </td>
      <td className="tabular px-3 py-2 text-muted-foreground">
        {row.snapshot ? `${row.snapshot.included} / ${row.snapshot.excluded} excl.` : "—"}
      </td>
      <td className="tabular px-3 py-2">
        <span className="text-success">{d.submitted ?? 0}</span>
        <span className="text-muted-foreground"> / {d.skipped ?? 0} / </span>
        <span className="text-destructive">{d.failed ?? 0}</span>
        <span
          className={cn(
            (d.unknown ?? 0) > 0 ? "font-semibold text-warning" : "text-muted-foreground",
          )}
        >
          {" "}
          / {d.unknown ?? 0}
        </span>
      </td>
      <td className="px-3 py-2 text-muted-foreground">
        {new Date(row.updated_at).toLocaleString()}
      </td>
    </tr>
  );
}

/* ── preview tabs (honest) ────────────────────────────────────────────────── */

/* ── main ─────────────────────────────────────────────────────────────────── */

type CampaignsTabKey = "broadcasts" | "sequences" | "templates" | "reporting" | "ai";

const TABS: { key: CampaignsTabKey; label: string; icon: typeof Send }[] = [
  { key: "broadcasts", label: "Broadcasts", icon: Send },
  { key: "sequences", label: "Sequences", icon: ListFilter },
  { key: "templates", label: "Templates", icon: FileText },
  { key: "reporting", label: "Objectives & Reporting", icon: BarChart3 },
  { key: "ai", label: "AI Drafting", icon: Bot },
];

export function MarketingCampaigns() {
  const [tab, setTab] = useState<CampaignsTabKey>("broadcasts");
  // affordance gating only — the server enforces every permission again
  const { can } = useMarketingAccess();
  // complete tab semantics: roving tabIndex + Left/Right/Home/End with
  // automatic activation; focus follows selection
  const tabRefs = useRef(new Map<CampaignsTabKey, HTMLButtonElement>());
  const onTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    if (next === null) return;
    e.preventDefault();
    const key = TABS[next].key;
    setTab(key);
    tabRefs.current.get(key)?.focus();
  };
  return (
    <div className="space-y-5">
      <div>
        <div className="text-display text-xl font-semibold">Campaigns</div>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Broadcasts, sequences, templates, reporting and AI drafting — every send governed,
          suppression-safe and evidence-reported.
        </p>
      </div>
      <div
        role="tablist"
        aria-label="Campaign sections"
        className="flex flex-wrap items-center gap-1 border-b border-hairline pb-2"
      >
        {TABS.map((t, i) => (
          <button
            key={t.key}
            ref={(el) => {
              if (el) tabRefs.current.set(t.key, el);
              else tabRefs.current.delete(t.key);
            }}
            role="tab"
            id={`mkt-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`mkt-panel-${t.key}`}
            tabIndex={tab === t.key ? 0 : -1}
            onKeyDown={(e) => onTabKeyDown(e, i)}
            onClick={() => setTab(t.key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition",
              tab === t.key
                ? "bg-foreground font-medium text-background"
                : "font-medium text-muted-foreground hover:bg-surface-alt hover:text-foreground",
            )}
          >
            <t.icon className="h-3.5 w-3.5" aria-hidden="true" /> {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`mkt-panel-${tab}`} aria-labelledby={`mkt-tab-${tab}`}>
        {tab === "broadcasts" && <BroadcastsTab />}
        {tab === "sequences" && <MarketingSequences />}
        {tab === "templates" && <MarketingTemplates canDraft={can("marketing.campaigns.draft")} />}
        {tab === "reporting" && <MarketingReporting canLink={can("marketing.campaigns.launch")} />}
        {tab === "ai" && (
          <MarketingAiDrafting
            canDraft={can("marketing.campaigns.draft")}
            canManageProvider={can("marketing.ai.manage")}
          />
        )}
      </div>
    </div>
  );
}
