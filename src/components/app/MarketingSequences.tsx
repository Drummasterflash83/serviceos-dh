/**
 * Marketing → Campaigns → Sequences (Phase 6).
 *
 * The operational Sequences surface: list, guided builder, activation
 * confirmation, enrolment preflight/confirmation, detail timeline, bounded
 * enrolment drill-down and factual reporting.
 *
 * Honesty rules this file obeys:
 *  - Every control is server-authorised again; hidden controls are NOT the
 *    security boundary, so a disabled button is a courtesy, never a guarantee.
 *  - "Submitted" means the provider accepted the request. Delivered, opened,
 *    clicked and bounced have no evidence pipeline and are shown as
 *    unavailable — never as zero.
 *  - Replies are only ever counted when canonical thread evidence proved one.
 *  - Event-triggered enrolment is not installed; it is labelled Preview.
 *  - An approved sequence is immutable: existing enrolments stay pinned to the
 *    revision they entered on, and the UI says so.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  CheckCircle2,
  Clock,
  Copy,
  Loader2,
  Mail,
  Pause,
  Play,
  Plus,
  Search,
  Send,
  SlidersHorizontal,
  Tag,
  Trash2,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  ENROLMENT_EXCLUSION_LABELS,
  EXIT_REASON_LABELS,
  STEP_TYPE_LABELS,
  activateSequence,
  confirmEnrolment,
  controlEnrolment,
  createSequence,
  getEnrolmentPage,
  getSequenceDetail,
  getSequenceReport,
  listSequences,
  newSequenceRequestId,
  preflightActivation,
  preflightEnrolment,
  reviseSequence,
  sendSequenceStepTest,
  transitionSequence,
  validateSteps,
  type ActivationPreflight,
  type EnrolmentPreflight,
  type EnrolmentRow,
  type SequenceDetail,
  type SequenceInput,
  type SequenceListData,
  type SequenceListRow,
  type SequenceReport,
  type SequenceStepInput,
  type StepType,
} from "@/lib/marketing/sequences";
import {
  getSendersOverview,
  listTestRecipients,
  senderCanRunSequence,
  type SenderProfile,
  type TestRecipient,
} from "@/lib/marketing/senders";
import { listSegments, type MarketingSegment } from "@/lib/marketing/segments";
import {
  listContacts,
  listOwners,
  listTags,
  type ContactListItem,
  type MarketingTag,
  type OwnerOption,
} from "@/lib/marketing/contacts";
import { listLifecycleStagesAdmin, type LifecycleStageAdmin } from "@/lib/marketing/admin";
import { MarketingContentTools } from "@/components/app/MarketingContentTools";
import { TestSendTracker } from "@/components/app/MarketingTestStatus";
import {
  FormSection,
  JourneySteps,
  TechnicalDetails,
  marketingInputCls,
  type JourneyStep,
} from "@/components/app/MarketingFormKit";

// ONE form language across Marketing (same boundary + focus as Broadcasts)
const inputCls = marketingInputCls;

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
      <span className="mb-1 block text-xs font-medium text-foreground">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "active"
      ? "border-success/30 bg-success/10 text-success"
      : status === "paused" || status === "held"
        ? "border-warning/30 bg-warning/10 text-warning"
        : status === "cancelled" || status === "exited"
          ? "border-destructive/30 bg-destructive/5 text-destructive"
          : "border-hairline bg-surface-alt text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        tone,
      )}
    >
      {status}
    </span>
  );
}

function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
      <div className="font-medium">Sequences could not be loaded</div>
      <p className="mt-1 text-xs">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 rounded-lg border border-destructive/30 px-2.5 py-1 text-xs font-medium hover:bg-destructive/10"
        >
          Try again
        </button>
      )}
    </div>
  );
}

/** The ONE sequence journey, spoken the same way in the builder and the detail
 *  view. Activation and enrolment are DELIBERATELY separate final steps:
 *  turning the journey on never chooses who goes through it. */
const SEQUENCE_JOURNEY: JourneyStep[] = [
  { title: "Build the journey", hint: "Emails, waits and actions — in order." },
  { title: "Test each email", hint: "Send every email step to yourself first." },
  { title: "Review and approve", hint: "An owner or admin approves the exact journey." },
  { title: "Activate", hint: "Turn the journey on. Nobody is enrolled by this." },
  {
    title: "Choose and enrol the audience",
    hint: "Pick who goes through it — a separate, confirmed step.",
  },
];

function SequenceJourney({ status, enrolled }: { status: string; enrolled?: boolean }) {
  const stage =
    status === "draft" ? 1 : status === "review" ? 2 : status === "approved" ? 3 : enrolled ? 5 : 4;
  const next =
    status === "draft"
      ? "Next: test each email on yourself, then submit for review."
      : status === "review"
        ? "Next: an owner or admin approves the exact journey (or requests changes)."
        : status === "approved"
          ? "Next: activate the journey. Activation never enrols anyone."
          : !enrolled
            ? "The journey is on. Next: choose and enrol the audience — nothing happens until you do."
            : null;
  return (
    <div aria-label="Sequence launch progress">
      <JourneySteps steps={SEQUENCE_JOURNEY} current={stage} done={stage} />
      {next && <p className="mt-2 text-xs font-medium text-foreground">{next}</p>}
    </div>
  );
}

/* ── step editor ──────────────────────────────────────────────────────────── */

const STEP_ORDER: StepType[] = [
  "send_email",
  "wait_duration",
  "wait_until_window",
  "apply_tag",
  "remove_tag",
  "change_lifecycle",
  "assign_owner",
  "create_follow_up",
];

function defaultConfig(type: StepType): Record<string, unknown> {
  switch (type) {
    case "send_email":
      return { subject: "", body_authored: "", token_fallbacks: {} };
    case "wait_duration":
      return { unit: "days", amount: 3 };
    case "wait_until_window":
      return { days: [1, 2, 3, 4, 5], start_hour: 9, end_hour: 17, ambiguous_policy: "earlier" };
    case "create_follow_up":
      return { subject: "", due_in_days: 3 };
    default:
      return {};
  }
}

function StepEditor({
  step,
  index,
  total,
  tags,
  stages,
  owners,
  followUpAvailable,
  onChange,
  onMove,
  onRemove,
}: {
  step: SequenceStepInput;
  index: number;
  total: number;
  tags: MarketingTag[];
  stages: LifecycleStageAdmin[];
  owners: OwnerOption[];
  onChange: (next: SequenceStepInput) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  followUpAvailable: boolean;
}) {
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const cfg = step.config ?? {};
  const set = (patch: Record<string, unknown>) =>
    onChange({ ...step, config: { ...cfg, ...patch } });
  const usedTokens = [
    ...new Set(
      Array.from(
        `${String(cfg.subject ?? "")}\n${String(cfg.body_authored ?? "")}`.matchAll(
          /\{\{\s*([a-z_]+)\s*\}\}/g,
        ),
        (match) => match[1],
      ),
    ),
  ];

  return (
    <div className="rounded-xl border border-hairline bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-[11px] font-semibold text-background">
          {index + 1}
        </span>
        <select
          aria-label={`Step ${index + 1} type`}
          className="rounded-lg border border-hairline bg-white px-2 py-1 text-xs"
          value={step.type}
          onChange={(e) => {
            const type = e.target.value as StepType;
            onChange({ ...step, type, config: defaultConfig(type) });
          }}
        >
          {STEP_ORDER.filter((t) => t !== "create_follow_up" || followUpAvailable).map((t) => (
            <option key={t} value={t}>
              {STEP_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-1">
          <Btn onClick={() => onMove(-1)} disabled={index === 0} title="Move step up">
            ↑<span className="sr-only">Move step {index + 1} up</span>
          </Btn>
          <Btn onClick={() => onMove(1)} disabled={index === total - 1} title="Move step down">
            ↓<span className="sr-only">Move step {index + 1} down</span>
          </Btn>
          <Btn tone="danger" onClick={onRemove} title="Remove step">
            <Trash2 className="h-3.5 w-3.5" />
            <span className="sr-only">Remove step {index + 1}</span>
          </Btn>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        {step.type === "send_email" && (
          <>
            <div className="md:col-span-2">
              <Field
                label="Subject"
                hint="Use “Insert a name or field…” below to personalise — friendly names, no codes to remember."
              >
                <input
                  className={inputCls}
                  value={String(cfg.subject ?? "")}
                  onChange={(e) => set({ subject: e.target.value })}
                />
              </Field>
            </div>
            <div className="md:col-span-2">
              <MarketingContentTools
                className="mb-2"
                targetRef={bodyRef}
                value={String(cfg.body_authored ?? "")}
                onChange={(body_authored) => set({ body_authored })}
              />
              <Field
                label="Body"
                hint="Write the message in plain language. ServiceOS safely creates the email version."
              >
                <textarea
                  ref={bodyRef}
                  className={cn(inputCls, "min-h-[120px] font-mono text-xs")}
                  value={String(cfg.body_authored ?? "")}
                  onChange={(e) => set({ body_authored: e.target.value })}
                />
              </Field>
            </div>
            {usedTokens.length > 0 && (
              <div className="md:col-span-2 rounded-lg border border-hairline bg-surface-alt/40 p-3">
                <div className="text-xs font-medium text-foreground">
                  If a contact is missing a personalisation value
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Add a safe replacement, or leave it blank to exclude that contact.
                </p>
                <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                  {usedTokens.map((token) => {
                    const fallbacks = (cfg.token_fallbacks ?? {}) as Record<string, string>;
                    const label =
                      token === "first_name"
                        ? "Missing first name"
                        : token === "last_name"
                          ? "Missing last name"
                          : token === "display_name"
                            ? "Missing full name"
                            : "Missing company name";
                    return (
                      <Field key={token} label={label}>
                        <input
                          className={inputCls}
                          value={fallbacks[token] ?? ""}
                          placeholder={
                            token === "first_name" ? "e.g. there" : "Optional replacement"
                          }
                          onChange={(event) =>
                            set({
                              token_fallbacks: {
                                ...fallbacks,
                                [token]: event.target.value,
                              },
                            })
                          }
                        />
                      </Field>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {step.type === "wait_duration" && (
          <>
            <Field label="Wait for">
              <input
                type="number"
                min={1}
                className={inputCls}
                value={Number(cfg.amount ?? 1)}
                onChange={(e) => set({ amount: Number(e.target.value) })}
              />
            </Field>
            <Field label="Unit">
              <select
                className={inputCls}
                value={String(cfg.unit ?? "days")}
                onChange={(e) => set({ unit: e.target.value })}
              >
                <option value="minutes">Minutes</option>
                <option value="hours">Hours</option>
                <option value="days">Days</option>
              </select>
            </Field>
            <p className="text-[11px] text-muted-foreground md:col-span-2">
              The contact simply waits here: ServiceOS pauses{" "}
              <span className="font-medium text-foreground">
                {Number(cfg.amount ?? 1)} {String(cfg.unit ?? "days")}
              </span>{" "}
              after the previous step finishes, then continues to the next one.
            </p>
          </>
        )}

        {step.type === "wait_until_window" && (
          <>
            <div className="md:col-span-2">
              <Field label="Days" hint="Tenant-local weekdays this step may continue on.">
                <div className="flex flex-wrap gap-1">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => {
                    const days = (cfg.days as number[]) ?? [];
                    const on = days.includes(i);
                    return (
                      <button
                        key={d}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          set({
                            days: on ? days.filter((x) => x !== i) : [...days, i].sort(),
                          })
                        }
                        className={cn(
                          "rounded-lg border px-2 py-1 text-xs",
                          on
                            ? "border-foreground bg-foreground text-background"
                            : "border-hairline bg-white text-muted-foreground",
                        )}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
              </Field>
            </div>
            <Field label="From hour (local)">
              <input
                type="number"
                min={0}
                max={23}
                className={inputCls}
                value={Number(cfg.start_hour ?? 9)}
                onChange={(e) => set({ start_hour: Number(e.target.value) })}
              />
            </Field>
            <Field
              label="To hour (local)"
              hint="Daylight-saving is handled: a local time that does not exist moves forward, and one that occurs twice resolves by the policy below."
            >
              <input
                type="number"
                min={1}
                max={24}
                className={inputCls}
                value={Number(cfg.end_hour ?? 17)}
                onChange={(e) => set({ end_hour: Number(e.target.value) })}
              />
            </Field>
            <Field label="If the local time occurs twice (clocks go back)">
              <select
                className={inputCls}
                value={String(cfg.ambiguous_policy ?? "earlier")}
                onChange={(e) => set({ ambiguous_policy: e.target.value })}
              >
                <option value="earlier">Use the earlier occurrence</option>
                <option value="later">Use the later occurrence</option>
              </select>
            </Field>
          </>
        )}

        {(step.type === "apply_tag" || step.type === "remove_tag") && (
          <Field label="Tag">
            <select
              className={inputCls}
              value={String(cfg.tag_id ?? "")}
              onChange={(e) => set({ tag_id: e.target.value })}
            >
              <option value="">Select a tag…</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
        )}

        {step.type === "change_lifecycle" && (
          <Field label="Lifecycle stage">
            <select
              className={inputCls}
              value={String(cfg.stage_key ?? "")}
              onChange={(e) => set({ stage_key: e.target.value })}
            >
              <option value="">Select a stage…</option>
              {stages.map((s) => (
                <option key={s.stage_key} value={s.stage_key}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
        )}

        {step.type === "assign_owner" && (
          <Field label="Owner">
            <select
              className={inputCls}
              value={String(cfg.owner_profile_id ?? "")}
              onChange={(e) => set({ owner_profile_id: e.target.value })}
            >
              <option value="">Select an owner…</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.email ?? o.id}
                </option>
              ))}
            </select>
          </Field>
        )}

        {step.type === "create_follow_up" && (
          <>
            <div className="md:col-span-2">
              <Field
                label="Follow-up subject"
                hint="Creates a real work item on the ServiceOS work list — the same one the Command Centre shows."
              >
                <input
                  className={inputCls}
                  value={String(cfg.subject ?? "")}
                  onChange={(e) => set({ subject: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Due in (days)">
              <input
                type="number"
                min={0}
                max={365}
                className={inputCls}
                value={Number(cfg.due_in_days ?? 3)}
                onChange={(e) => set({ due_in_days: Number(e.target.value) })}
              />
            </Field>
          </>
        )}
      </div>
    </div>
  );
}

/* ── activation dialog ────────────────────────────────────────────────────── */

function ActivationDialog({
  detail,
  preflight,
  onClose,
  onActivated,
}: {
  detail: SequenceDetail;
  preflight: ActivationPreflight;
  onClose: () => void;
  onActivated: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId] = useState(newSequenceRequestId());
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

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
    const res = await activateSequence({
      campaign_id: detail.id,
      confirmation_id: preflight.confirmation_id,
      challenge: preflight.challenge,
      request_id: requestId,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    onActivated();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="activate-dialog-title"
        className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-xl border border-hairline bg-white p-5"
      >
        <div id="activate-dialog-title" className="text-sm font-semibold text-foreground">
          Activate this sequence
        </div>
        <div className="mt-3 space-y-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-foreground">
          <p className="font-medium">
            Activating turns the journey on — it does NOT enrol anyone. Nobody receives anything
            until you choose and enrol the audience afterwards. Once someone is enrolled, they move
            through {preflight.step_count} step{preflight.step_count === 1 ? "" : "s"} automatically
            — including {preflight.email_steps} real email step
            {preflight.email_steps === 1 ? "" : "s"}.
          </p>
          <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
            <li>
              You are authorising revision {preflight.revision_number} exactly as it stands. Editing
              it later creates a new revision and requires approval again.
            </li>
            <li>
              Existing enrolments stay pinned to the revision they entered on — they are never
              silently migrated to a newer one.
            </li>
            <li>Sender: the approved sequence sender. Timezone: {preflight.timezone}.</li>
            <li>
              {preflight.quiet_hours_start !== null && preflight.quiet_hours_end !== null
                ? `Quiet hours ${preflight.quiet_hours_start}:00–${preflight.quiet_hours_end}:00 local defer email steps.`
                : "No quiet hours are configured, so email steps may run at any hour."}
            </li>
            <li>
              Suppression, unsubscribes and preference are re-checked immediately before every send;
              ineligible People are skipped or exited, never overridden.
            </li>
            <li>
              Pausing stops steps that have not started. An email already accepted by the provider
              cannot be recalled.
            </li>
            <li>“Submitted” means the provider accepted the request — it is not delivery proof.</li>
          </ul>
        </div>
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
            Activate revision {preflight.revision_number}
          </Btn>
        </div>
        <div className="mt-2 text-right text-[10px] text-muted-foreground">
          Server confirmation {preflight.confirmation_id.slice(0, 8)}… expires{" "}
          {new Date(preflight.expires_at).toLocaleTimeString()} — any edit requires a new
          confirmation.
        </div>
      </div>
    </div>
  );
}

/* ── enrolment dialog ─────────────────────────────────────────────────────── */

function EnrolmentDialog({
  detail,
  preflight,
  onClose,
  onEnrolled,
}: {
  detail: SequenceDetail;
  preflight: EnrolmentPreflight;
  onClose: () => void;
  onEnrolled: (n: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId] = useState(newSequenceRequestId());
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const go = async () => {
    setBusy(true);
    setError(null);
    const res = await confirmEnrolment({
      campaign_id: detail.id,
      confirmation_id: preflight.confirmation_id,
      challenge: preflight.challenge,
      request_id: requestId,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    onEnrolled(res.data.enrolled);
  };

  const excluded = Object.entries(preflight.exclusion_breakdown);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="enrol-dialog-title"
        className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-xl border border-hairline bg-white p-5"
      >
        <div id="enrol-dialog-title" className="text-sm font-semibold text-foreground">
          Confirm enrolment
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          {[
            ["Candidates", preflight.candidate_count],
            ["Will enrol", preflight.eligible_count],
            ["Excluded", preflight.excluded_count],
          ].map(([label, n]) => (
            <div
              key={String(label)}
              className="rounded-lg border border-hairline bg-surface-alt p-2"
            >
              <div className="text-lg font-semibold tabular text-foreground">{n as number}</div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {label as string}
              </div>
            </div>
          ))}
        </div>
        {excluded.length > 0 && (
          <div className="mt-3 rounded-lg border border-hairline bg-white p-3">
            <div className="text-xs font-medium text-foreground">Why People were excluded</div>
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {excluded.map(([reason, n]) => (
                <li key={reason} className="flex justify-between gap-2">
                  <span>{ENROLMENT_EXCLUSION_LABELS[reason] ?? reason}</span>
                  <span className="tabular">{n}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {preflight.included_samples.length > 0 && (
          <div className="mt-2 text-[11px] text-muted-foreground">
            Sample of who will enrol:{" "}
            {preflight.included_samples.map((s) => s.destination_masked).join(", ")}
          </div>
        )}
        <div className="mt-3 space-y-1 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">
            These {preflight.eligible_count} People begin revision {preflight.revision_number} now.
          </p>
          <p>
            Each enrolment pins the Person&apos;s current email endpoint. Eligibility is re-checked
            before every send; unsubscribes and suppressions exit the enrolment.
          </p>
          <p>Refreshing this preflight invalidates this confirmation.</p>
        </div>
        {error && (
          <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
        <div className="mt-4 flex items-center justify-end gap-2">
          <Btn ref={cancelRef} onClick={onClose}>
            Cancel
          </Btn>
          <Btn
            tone="primary"
            onClick={go}
            busy={busy}
            disabled={preflight.eligible_count === 0}
            title={preflight.eligible_count === 0 ? "Nobody is eligible to enrol" : undefined}
          >
            Enrol {preflight.eligible_count} {preflight.eligible_count === 1 ? "Person" : "People"}
          </Btn>
        </div>
        <div className="mt-2 text-right text-[10px] text-muted-foreground">
          Expires {new Date(preflight.expires_at).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}

/* ── detail ───────────────────────────────────────────────────────────────── */

function SequenceDetailView({
  campaignId,
  caps,
  onBack,
  onChanged,
  onRevise,
  initialNotice,
}: {
  campaignId: string;
  caps: Pick<SequenceListData, "can_draft" | "can_test" | "can_launch" | "can_report">;
  onBack: () => void;
  onChanged: () => void;
  onRevise: (detail: SequenceDetail) => void;
  initialNotice?: string | null;
}) {
  const [detail, setDetail] = useState<SequenceDetail | null>(null);
  const [report, setReport] = useState<SequenceReport | null>(null);
  const [enrolments, setEnrolments] = useState<EnrolmentRow[]>([]);
  const [nextCursor, setNextCursor] = useState<{ at: string; id: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(initialNotice ?? null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [activation, setActivation] = useState<ActivationPreflight | null>(null);
  const [enrolPreflight, setEnrolPreflight] = useState<EnrolmentPreflight | null>(null);
  const [testRecipients, setTestRecipients] = useState<TestRecipient[]>([]);
  const [testRecipient, setTestRecipient] = useState("");
  const [testStepOrder, setTestStepOrder] = useState<number | null>(null);
  const [viewerProfileId, setViewerProfileId] = useState<string | null>(null);
  const [operationalMode, setOperationalMode] = useState<string | null>(null);
  const [modePermitsSend, setModePermitsSend] = useState(false);
  const [lastTestDeliveryId, setLastTestDeliveryId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const [d, r] = await Promise.all([
      getSequenceDetail(campaignId),
      caps.can_report ? getSequenceReport(campaignId) : Promise.resolve(null),
    ]);
    if (!d.ok) {
      setError(d.error.message);
      setLoading(false);
      return;
    }
    setDetail(d.data);
    setError(null);
    if (r && r.ok) setReport(r.data);
    const page = await getEnrolmentPage(campaignId);
    if (page.ok) {
      setEnrolments(page.data.enrolments);
      setNextCursor(page.data.next_cursor);
    }
    setLoading(false);
  }, [campaignId, caps.can_report]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!caps.can_test) return;
    void Promise.all([listTestRecipients(), getSendersOverview()]).then(
      ([recipients, overview]) => {
        if (recipients.ok) setTestRecipients(recipients.data.recipients);
        if (!overview.ok) return;
        setViewerProfileId(overview.data.viewer_profile_id);
        setOperationalMode(overview.data.operational_mode);
        setModePermitsSend(overview.data.mode_permits_send === true);
        if (
          overview.data.viewer_profile_id &&
          recipients.ok &&
          recipients.data.recipients.some(
            (recipient) => recipient.id === overview.data.viewer_profile_id,
          )
        ) {
          setTestRecipient(overview.data.viewer_profile_id);
        }
      },
    );
  }, [caps.can_test]);

  useEffect(() => {
    if (testStepOrder !== null) return;
    const firstEmail = detail?.steps.find((step) => step.type === "send_email");
    if (firstEmail) setTestStepOrder(firstEmail.order);
  }, [detail, testStepOrder]);

  const doTransition = async (
    action:
      | "submit_review"
      | "request_changes"
      | "approve"
      | "pause"
      | "resume"
      | "cancel"
      | "close"
      | "archive",
  ) => {
    if (!detail) return;
    setBusyAction(action);
    const res = await transitionSequence(action, detail.id, detail.version);
    setBusyAction(null);
    if (res.ok) {
      setNotice(null);
      onChanged();
      void reload();
    } else setNotice(res.error.message);
  };

  const doActivationPreflight = async () => {
    if (!detail) return;
    setBusyAction("activate");
    const res = await preflightActivation(detail.id, detail.version);
    setBusyAction(null);
    if (res.ok) setActivation(res.data);
    else
      setNotice(
        res.error.code === "CONFIG_REQUIRED"
          ? "This sequence sends email, so MARKETING_PUBLIC_BASE_URL must be configured before it can be activated. No unsubscribe link is ever fabricated."
          : res.error.message,
      );
  };

  const doEnrolPreflight = async (source: "manual" | "segment", ids?: string[], segId?: string) => {
    if (!detail) return;
    setBusyAction("enrol");
    const res = await preflightEnrolment({
      campaign_id: detail.id,
      source,
      ...(source === "manual" ? { person_ids: ids ?? [] } : { segment_id: segId }),
    });
    setBusyAction(null);
    if (res.ok) setEnrolPreflight(res.data);
    else setNotice(res.error.message);
  };

  const doTest = async () => {
    if (!detail || !testRecipient || !testStepOrder) return;
    setBusyAction("test");
    setNotice(null);
    const result = await sendSequenceStepTest({
      campaign_id: detail.id,
      step_order: testStepOrder,
      recipient_profile_id: testRecipient,
      request_id: newSequenceRequestId(),
    });
    setBusyAction(null);
    if (result.ok) {
      setLastTestDeliveryId(result.data.delivery_id);
      setNotice(null);
    } else {
      setNotice(result.error.message);
    }
  };

  if (loading) {
    return (
      <div className="grid min-h-[30vh] place-items-center text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading sequence…
        </span>
      </div>
    );
  }
  if (error || !detail) return <ErrorNote message={error ?? "Not found"} onRetry={reload} />;

  const heldCount = report?.enrolments?.held ?? 0;
  const unknownCount = detail.steps.reduce(
    (n, s) => n + (report?.steps.find((r) => r.order === s.order)?.executions?.unknown ?? 0),
    0,
  );
  const emailSteps = detail.steps.filter((step) => step.type === "send_email");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-lg border border-hairline bg-white px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-alt"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> All sequences
        </button>
        <div className="text-display text-lg font-semibold">{detail.name}</div>
        <StatusBadge status={detail.status} />
        {detail.closed_at && (
          <span className="rounded-full border border-hairline bg-surface-alt px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            Closed to enrolment
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {caps.can_draft && ["draft", "review", "approved"].includes(detail.status) && (
            <Btn onClick={() => onRevise(detail)}>
              <SlidersHorizontal className="h-3.5 w-3.5" /> Revise
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
            <Btn tone="primary" onClick={doActivationPreflight} busy={busyAction === "activate"}>
              <Play className="h-3.5 w-3.5" /> Activate
            </Btn>
          )}
          {caps.can_launch && detail.status === "active" && !detail.closed_at && (
            <Btn onClick={() => doTransition("close")} busy={busyAction === "close"}>
              Close to enrolment
            </Btn>
          )}
          {caps.can_launch && ["active", "scheduled"].includes(detail.status) && (
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
          {caps.can_launch && ["active", "paused", "scheduled"].includes(detail.status) && (
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
              Archive
            </Btn>
          )}
        </div>
      </div>

      {notice && (
        <div
          role="status"
          className={cn(
            "rounded-lg border px-3 py-2 text-xs text-foreground",
            notice.startsWith("Sequence saved")
              ? "border-success/40 bg-success/10"
              : "border-hairline bg-surface-alt",
          )}
        >
          {notice}
        </div>
      )}
      <SequenceJourney status={detail.status} enrolled={enrolments.length > 0} />
      {heldCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs font-medium text-foreground">
          <AlertTriangle className="h-4 w-4 text-warning" />
          {heldCount} enrolment{heldCount === 1 ? "" : "s"} held for review — a step failed and will
          not retry until someone resumes it.
        </div>
      )}
      {unknownCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs font-medium text-foreground">
          <AlertTriangle className="h-4 w-4 text-warning" />
          {unknownCount} step execution{unknownCount === 1 ? "" : "s"} with an UNKNOWN provider
          result — frozen for review, never auto-retried.
        </div>
      )}

      {caps.can_test && emailSteps.length > 0 && (
        <div className="rounded-xl border border-accent/30 bg-accent-soft p-4">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 grow">
              <div className="text-sm font-semibold text-foreground">Test an email step</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Choose an email from this sequence and send it only to yourself. This never enrols a
                contact or advances the journey.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Email step to test"
                className={cn(inputCls, "max-w-[280px] bg-white py-1.5 text-xs")}
                value={testStepOrder ?? ""}
                onChange={(event) => setTestStepOrder(Number(event.target.value))}
              >
                {emailSteps.map((step) => (
                  <option key={step.id} value={step.order}>
                    Step {step.order}: {step.summary}
                  </option>
                ))}
              </select>
              <select
                aria-label="Test recipient"
                className={cn(inputCls, "max-w-[240px] bg-white py-1.5 text-xs")}
                value={testRecipient}
                onChange={(event) => setTestRecipient(event.target.value)}
              >
                <option value="">Choose recipient…</option>
                {testRecipients.map((recipient) => (
                  <option key={recipient.id} value={recipient.id}>
                    {recipient.email}
                    {recipient.id === viewerProfileId ? " — you" : ""}
                  </option>
                ))}
              </select>
              <Btn
                tone="primary"
                onClick={doTest}
                busy={busyAction === "test"}
                disabled={!testRecipient || !testStepOrder}
              >
                <Send className="h-3.5 w-3.5" /> Send test to myself
              </Btn>
            </div>
          </div>
          {operationalMode === "discovery" && !lastTestDeliveryId && (
            <div className="mt-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-xs text-foreground">
              Sending is currently paused: this workspace is in Discovery mode, so ServiceOS saves
              tests safely but no email leaves the platform until an operator raises the mode.
            </div>
          )}
          {lastTestDeliveryId && (
            <div className="mt-2">
              <TestSendTracker deliveryId={lastTestDeliveryId} modePermitsSend={modePermitsSend} />
            </div>
          )}
        </div>
      )}

      {/* steps */}
      <div className="rounded-xl border border-hairline bg-white p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-foreground">
            Approved journey
            {detail.revision && ` · revision ${detail.revision.revision_number}`}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {detail.revision?.timezone} · {detail.steps.length} steps
          </div>
        </div>
        <ol className="mt-3 space-y-2">
          {detail.steps.map((s) => (
            <li
              key={s.id}
              className="flex items-start gap-3 rounded-lg border border-hairline p-2.5"
            >
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-alt text-[10px] font-semibold">
                {s.order}
              </span>
              <div className="min-w-0">
                <div className="text-xs font-medium text-foreground">{s.summary}</div>
                <div className="text-[11px] text-muted-foreground">{STEP_TYPE_LABELS[s.type]}</div>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                {report?.steps.find((r) => r.order === s.order)?.executions &&
                  Object.entries(report.steps.find((r) => r.order === s.order)!.executions).map(
                    ([k, n]) => (
                      <span key={k} className={cn(k === "unknown" && "font-semibold text-warning")}>
                        {k} {n}
                      </span>
                    ),
                  )}
              </div>
            </li>
          ))}
        </ol>
        {detail.revisions.some((r) => r.live_enrolments > 0 && r.id !== detail.revision?.id) && (
          <p className="mt-3 rounded-lg bg-surface-alt px-3 py-2 text-[11px] text-muted-foreground">
            Some enrolments are still running an earlier revision. They stay pinned to the revision
            they entered on and are never migrated automatically.
          </p>
        )}
      </div>

      {/* enrolment */}
      {caps.can_launch && detail.status === "active" && !detail.closed_at && (
        <EnrolPanel detail={detail} onPreflight={doEnrolPreflight} busy={busyAction === "enrol"} />
      )}

      {/* report */}
      {caps.can_report && report && (
        <div className="rounded-xl border border-hairline bg-white p-4">
          <div className="text-sm font-medium text-foreground">Reporting</div>
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            {[
              ["Candidates", report.candidates],
              ["Enrolled active", report.enrolments.active ?? 0],
              ["Completed", report.enrolments.completed ?? 0],
              ["Exited", report.enrolments.exited ?? 0],
            ].map(([l, n]) => (
              <div
                key={String(l)}
                className="rounded-lg border border-hairline bg-surface-alt p-2.5"
              >
                <div className="text-lg font-semibold tabular text-foreground">{n as number}</div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {l as string}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            {[
              ["Delivered", report.delivered],
              ["Opened", report.opened],
              ["Clicked", report.clicked],
              ["Bounced", report.bounced],
            ].map(([l, v]) => (
              <div
                key={String(l)}
                className="rounded-lg border border-dashed border-hairline bg-white p-2.5"
              >
                <div className="text-sm font-semibold uppercase tracking-wide text-warning">
                  {v === null ? "Unavailable" : String(v)}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {l as string}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Submitted means the selected provider accepted the request — not delivered.{" "}
            {report.tracking.note}. Replies are counted only from canonical thread evidence (
            {report.replied_proven} proven). Bounces: {report.bounce_evidence}.
          </p>
          {Object.keys(report.exits).length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-medium text-foreground">Exits by exact reason</div>
              <ul className="mt-1 grid grid-cols-1 gap-0.5 text-xs text-muted-foreground md:grid-cols-2">
                {Object.entries(report.exits).map(([reason, n]) => (
                  <li key={reason} className="flex justify-between gap-2">
                    <span>{EXIT_REASON_LABELS[reason] ?? reason}</span>
                    <span className="tabular">{n}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* enrolment drill-down */}
      <div className="rounded-xl border border-hairline bg-white p-4">
        <div className="text-sm font-medium text-foreground">Enrolments</div>
        {enrolments.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Nobody is enrolled yet. Enrolment is a governed, confirmed action.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-1.5 pr-3">Person</th>
                  <th className="py-1.5 pr-3">Status</th>
                  <th className="py-1.5 pr-3">Step</th>
                  <th className="py-1.5 pr-3">Next due</th>
                  <th className="py-1.5 pr-3">Reason</th>
                  <th className="py-1.5">Actions</th>
                </tr>
              </thead>
              <tbody>
                {enrolments.map((e) => (
                  <tr key={e.enrolment_id} className="border-t border-hairline">
                    <td className="py-1.5 pr-3">
                      <div className="font-medium text-foreground">{e.display_name ?? "—"}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {e.destination_masked}
                      </div>
                    </td>
                    <td className="py-1.5 pr-3">
                      <StatusBadge status={e.status} />
                    </td>
                    <td className="py-1.5 pr-3 tabular">
                      {e.current_step_order} / {detail.steps.length}
                      <div className="text-[10px] text-muted-foreground">
                        rev {e.revision_number}
                      </div>
                    </td>
                    <td className="py-1.5 pr-3 text-muted-foreground">
                      {e.next_eligible_at ? new Date(e.next_eligible_at).toLocaleString() : "—"}
                    </td>
                    <td className="py-1.5 pr-3 text-muted-foreground">
                      {e.exit_reason
                        ? (EXIT_REASON_LABELS[e.exit_reason] ?? e.exit_reason)
                        : (e.hold_reason ?? "—")}
                    </td>
                    <td className="py-1.5">
                      {caps.can_launch && ["active", "paused", "held"].includes(e.status) && (
                        <div className="flex gap-1">
                          {e.status === "active" ? (
                            <Btn
                              onClick={async () => {
                                await controlEnrolment("enrolment_pause", e.enrolment_id);
                                void reload();
                              }}
                            >
                              Pause
                            </Btn>
                          ) : (
                            <Btn
                              onClick={async () => {
                                await controlEnrolment("enrolment_resume", e.enrolment_id);
                                void reload();
                              }}
                            >
                              Resume
                            </Btn>
                          )}
                          <Btn
                            tone="danger"
                            onClick={async () => {
                              await controlEnrolment("enrolment_exit", e.enrolment_id);
                              void reload();
                            }}
                          >
                            Remove
                          </Btn>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {nextCursor && (
              <div className="mt-2">
                <Btn
                  onClick={async () => {
                    const page = await getEnrolmentPage(campaignId, nextCursor);
                    if (page.ok) {
                      setEnrolments((prev) => [...prev, ...page.data.enrolments]);
                      setNextCursor(page.data.next_cursor);
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

      {activation && (
        <ActivationDialog
          detail={detail}
          preflight={activation}
          onClose={() => setActivation(null)}
          onActivated={() => {
            setActivation(null);
            onChanged();
            void reload();
          }}
        />
      )}
      {enrolPreflight && (
        <EnrolmentDialog
          detail={detail}
          preflight={enrolPreflight}
          onClose={() => setEnrolPreflight(null)}
          onEnrolled={(n) => {
            setEnrolPreflight(null);
            setNotice(`${n} ${n === 1 ? "Person" : "People"} enrolled.`);
            void reload();
          }}
        />
      )}
    </div>
  );
}

function EnrolPanel({
  detail,
  onPreflight,
  busy,
}: {
  detail: SequenceDetail;
  onPreflight: (source: "manual" | "segment", ids?: string[], segId?: string) => void;
  busy: boolean;
}) {
  const [segments, setSegments] = useState<MarketingSegment[]>([]);
  const [segmentId, setSegmentId] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [contactResults, setContactResults] = useState<ContactListItem[]>([]);
  const [selectedPeople, setSelectedPeople] = useState<Set<string>>(new Set());
  const [searchingContacts, setSearchingContacts] = useState(false);
  const entry = detail.revision?.entry_policy ?? "manual_or_segment";

  useEffect(() => {
    void listSegments().then((r) => {
      if (r.ok) setSegments((r.data.segments ?? []).filter((sg) => sg.status === "active"));
    });
  }, []);

  const searchContacts = async () => {
    setSearchingContacts(true);
    const result = await listContacts({
      ...(contactSearch.trim() ? { search: contactSearch.trim() } : {}),
      sort: "name",
      dir: "asc",
      limit: 20,
    });
    setSearchingContacts(false);
    if (result.ok) setContactResults(result.data.items);
  };

  return (
    <div className="rounded-xl border border-hairline bg-white p-4">
      <div className="flex items-center gap-2">
        <UserPlus className="h-4 w-4 text-muted-foreground" />
        <div className="text-sm font-semibold text-foreground">Choose and enrol the audience</div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        The journey is on, but nobody goes through it until you enrol them here. You&apos;ll see
        exactly who will be enrolled — and who is excluded, with the reason — before confirming.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        {entry !== "manual_only" && (
          <div className="rounded-lg border border-hairline p-3">
            <Field
              label="From a segment"
              hint="Uses the segment as it stands right now — you confirm the exact list next."
            >
              <select
                className={inputCls}
                value={segmentId}
                onChange={(e) => setSegmentId(e.target.value)}
              >
                <option value="">Select a segment…</option>
                {segments.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="mt-2">
              <Btn
                tone="primary"
                busy={busy}
                disabled={!segmentId}
                onClick={() => onPreflight("segment", undefined, segmentId)}
              >
                <Users className="h-3.5 w-3.5" /> Check who will be enrolled
              </Btn>
            </div>
          </div>
        )}
        {entry !== "segment_only" && (
          <div className="rounded-lg border border-hairline p-3">
            <Field label="Specific contacts" hint="Search by name, company or email.">
              <div className="flex gap-2">
                <input
                  className={inputCls}
                  value={contactSearch}
                  onChange={(event) => setContactSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void searchContacts();
                    }
                  }}
                  placeholder="Search contacts…"
                />
                <Btn onClick={() => void searchContacts()} busy={searchingContacts}>
                  <Search className="h-3.5 w-3.5" /> Search
                </Btn>
              </div>
            </Field>
            {contactResults.length > 0 && (
              <div className="mt-2 max-h-44 space-y-1 overflow-auto rounded-lg border border-hairline p-2">
                {contactResults.map((contact) => (
                  <label
                    key={contact.person_id}
                    className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-surface-alt"
                  >
                    <input
                      type="checkbox"
                      checked={selectedPeople.has(contact.person_id)}
                      onChange={(event) =>
                        setSelectedPeople((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(contact.person_id);
                          else next.delete(contact.person_id);
                          return next;
                        })
                      }
                    />
                    <span className="min-w-0 text-xs">
                      <span className="block font-medium text-foreground">
                        {contact.display_name || contact.primary_email || "Unnamed contact"}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {[contact.primary_email, contact.company_name, contact.eligibility]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
            <div className="mt-2">
              <Btn
                tone="primary"
                busy={busy}
                disabled={selectedPeople.size === 0}
                onClick={() => onPreflight("manual", [...selectedPeople])}
              >
                <UserPlus className="h-3.5 w-3.5" /> Check {selectedPeople.size} selected
              </Btn>
            </div>
          </div>
        )}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Event-triggered enrolment is not installed in this phase and is not simulated — enrolment is
        manual or segment-based only.
      </p>
    </div>
  );
}

/* ── builder ──────────────────────────────────────────────────────────────── */

function SequenceBuilder({
  mode,
  existing,
  followUpAvailable,
  onCancel,
  onSaved,
}: {
  mode: "create" | "revise";
  existing?: SequenceDetail;
  followUpAvailable: boolean;
  onCancel: () => void;
  onSaved: (campaignId: string) => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [senderId, setSenderId] = useState(existing?.revision?.sender_profile_id ?? "");
  const [timezone, setTimezone] = useState(existing?.revision?.timezone ?? "Europe/London");
  const [quietStart, setQuietStart] = useState<string>(
    existing?.revision?.quiet_hours_start != null
      ? String(existing.revision.quiet_hours_start)
      : "",
  );
  const [quietEnd, setQuietEnd] = useState<string>(
    existing?.revision?.quiet_hours_end != null ? String(existing.revision.quiet_hours_end) : "",
  );
  const [exitOnReply, setExitOnReply] = useState(
    Boolean(existing?.revision?.exit_rules?.on_reply ?? true),
  );
  const [policyBlock, setPolicyBlock] = useState(
    String(existing?.revision?.policy_block_action ?? "exit"),
  );
  const [reenrol, setReenrol] = useState(String(existing?.revision?.reenrolment_policy ?? "never"));
  const [steps, setSteps] = useState<SequenceStepInput[]>(
    existing?.steps.map((s) => ({ key: s.key, type: s.type, config: s.config })) ?? [
      { type: "send_email", config: defaultConfig("send_email") },
    ],
  );
  const [senders, setSenders] = useState<SenderProfile[]>([]);
  const [tags, setTags] = useState<MarketingTag[]>([]);
  const [stages, setStages] = useState<LifecycleStageAdmin[]>([]);
  const [owners, setOwners] = useState<OwnerOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<
    { order: number; ok: boolean; summary?: string; error?: string }[] | null
  >(null);

  useEffect(() => {
    void getSendersOverview().then((r) => {
      if (!r.ok) return;
      const available = (r.data.senders ?? []).filter(senderCanRunSequence);
      setSenders(available);
      if (r.data.default_sender_profile_id) {
        const defaultAvailable = available.some(
          (sender) => sender.id === r.data.default_sender_profile_id,
        );
        if (defaultAvailable) {
          setSenderId((current) => current || r.data.default_sender_profile_id || "");
        }
      }
    });
    void listTags().then((r) => {
      if (r.ok) setTags(r.data.tags ?? []);
    });
    void listLifecycleStagesAdmin().then((r) => {
      if (r.ok) setStages((r.data.stages ?? []).filter((st) => st.active));
    });
    void listOwners().then((r) => {
      if (r.ok) setOwners(r.data.owners ?? []);
    });
  }, []);

  const doValidate = async () => {
    const res = await validateSteps(steps);
    if (res.ok) setValidation(res.data.steps);
  };

  const save = async () => {
    setError(null);
    if (!name.trim() || !senderId || steps.length === 0) {
      setError("Add a sequence name, choose the sender and include at least one step.");
      return;
    }
    setBusy(true);
    const checked = await validateSteps(steps);
    if (!checked.ok) {
      setBusy(false);
      setError(checked.error.message);
      return;
    }
    setValidation(checked.data.steps);
    if (!checked.data.valid) {
      setBusy(false);
      setError("Fix the highlighted sequence steps before saving.");
      return;
    }
    const payload: SequenceInput = {
      name,
      ...(description ? { description } : {}),
      sender_id: senderId,
      timezone,
      ...(quietStart !== "" ? { quiet_hours_start: Number(quietStart) } : {}),
      ...(quietEnd !== "" ? { quiet_hours_end: Number(quietEnd) } : {}),
      reenrolment_policy: reenrol,
      policy_block_action: policyBlock,
      exit_rules: { on_reply: exitOnReply },
      steps,
    };
    const res =
      mode === "create"
        ? await createSequence(payload)
        : await reviseSequence(existing!.id, existing!.version, payload);
    setBusy(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    onSaved(res.data.id);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-foreground/15 bg-white p-4">
        <div className="text-sm font-semibold text-foreground">
          {mode === "create" ? "New sequence" : `Revise “${existing?.name}”`}
        </div>
        {mode === "create" && (
          <p className="mt-1 text-xs text-muted-foreground">
            Build a series of emails and waits that runs by itself once you approve and activate it.
            Nothing sends while you build — and nobody is enrolled until you choose them at the end.
          </p>
        )}
        {mode === "revise" && (
          <p className="mt-1 text-xs text-muted-foreground">
            Change the journey, then save. It returns to draft so it can be tested and approved
            again; people already enrolled simply finish the version they started on.
          </p>
        )}
        <JourneySteps className="mt-3" steps={SEQUENCE_JOURNEY} current={0} done={0} />
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Name (required)">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field
            label="Sender (required)"
            hint="The verified default sender is selected automatically."
          >
            <select
              className={inputCls}
              value={senderId}
              onChange={(e) => setSenderId(e.target.value)}
            >
              <option value="">Select a sender…</option>
              {senders.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.mailbox_address}
                </option>
              ))}
            </select>
          </Field>
          <div className="md:col-span-2">
            <Field label="Description (optional)">
              <input
                className={inputCls}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
          </div>
          <details className="md:col-span-2 rounded-lg border border-hairline bg-surface-alt/40 p-3">
            <summary className="cursor-pointer text-xs font-semibold text-foreground">
              Delivery and safety settings
              <span className="ml-2 font-normal text-muted-foreground">
                Europe/London · safe defaults applied
              </span>
            </summary>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Timezone" hint="All waits and quiet hours use this zone.">
                <select
                  className={inputCls}
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                >
                  <option value="Europe/London">United Kingdom — Europe/London</option>
                  <option value="Europe/Dublin">Ireland — Europe/Dublin</option>
                  <option value="UTC">UTC</option>
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Do not send from" hint="Optional, local hour">
                  <input
                    type="number"
                    min={0}
                    max={23}
                    className={inputCls}
                    value={quietStart}
                    onChange={(e) => setQuietStart(e.target.value)}
                  />
                </Field>
                <Field label="until" hint="Optional, local hour">
                  <input
                    type="number"
                    min={0}
                    max={23}
                    className={inputCls}
                    value={quietEnd}
                    onChange={(e) => setQuietEnd(e.target.value)}
                  />
                </Field>
              </div>
              <Field label="Re-enrolment" hint="May somebody who already left enter again?">
                <select
                  className={inputCls}
                  value={reenrol}
                  onChange={(e) => setReenrol(e.target.value)}
                >
                  <option value="never">Never</option>
                  <option value="after_exit">Only after they exited</option>
                  <option value="always">Always</option>
                </select>
              </Field>
              <Field
                label="If policy blocks a step"
                hint="Unsubscribes and suppression always stop email."
              >
                <select
                  className={inputCls}
                  value={policyBlock}
                  onChange={(e) => setPolicyBlock(e.target.value)}
                >
                  <option value="exit">Exit the contact from the sequence</option>
                  <option value="skip_step">Skip the step and continue</option>
                </select>
              </Field>
              <label className="flex items-center gap-2 text-xs text-foreground md:col-span-2">
                <input
                  type="checkbox"
                  checked={exitOnReply}
                  onChange={(e) => setExitOnReply(e.target.checked)}
                />
                Stop this sequence when the contact replies
              </label>
            </div>
          </details>
        </div>
        <p className="mt-3 rounded-lg bg-surface-alt px-3 py-2 text-[11px] text-muted-foreground">
          Unsubscribes and hard suppressions always stop future sends. That is not configurable.
        </p>
      </div>

      <div className="space-y-2">
        {steps.map((s, i) => (
          <StepEditor
            key={i}
            step={s}
            index={i}
            total={steps.length}
            tags={tags}
            stages={stages}
            owners={owners}
            followUpAvailable={followUpAvailable}
            onChange={(next) => setSteps((prev) => prev.map((p, j) => (j === i ? next : p)))}
            onMove={(dir) =>
              setSteps((prev) => {
                const to = i + dir;
                if (to < 0 || to >= prev.length) return prev;
                const copy = [...prev];
                [copy[i], copy[to]] = [copy[to], copy[i]];
                return copy;
              })
            }
            onRemove={() => setSteps((prev) => prev.filter((_, j) => j !== i))}
          />
        ))}
        <Btn
          onClick={() =>
            setSteps((prev) => [
              ...prev,
              { type: "wait_duration", config: defaultConfig("wait_duration") },
            ])
          }
        >
          <Plus className="h-3.5 w-3.5" /> Add step
        </Btn>
      </div>

      {validation && (
        <div className="rounded-xl border border-hairline bg-white p-3 text-xs">
          <div className="font-medium text-foreground">Validation</div>
          <ul className="mt-1 space-y-0.5">
            {validation.map((v) => (
              <li
                key={v.order}
                className={cn(v.ok ? "text-muted-foreground" : "font-medium text-destructive")}
              >
                Step {v.order}: {v.ok ? v.summary : v.error}
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Btn onClick={onCancel}>Cancel</Btn>
        <Btn onClick={doValidate}>Check journey</Btn>
        <Btn tone="primary" onClick={save} busy={busy} disabled={!name || !senderId}>
          {mode === "create" ? "Create sequence" : "Save as new revision"}
        </Btn>
      </div>
    </div>
  );
}

/* ── main ─────────────────────────────────────────────────────────────────── */

export function MarketingSequences({
  initialSelected = null,
  onSelectedChange,
}: {
  initialSelected?: string | null;
  onSelectedChange?: (campaignId: string | null) => void;
}) {
  const [data, setData] = useState<SequenceListData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(initialSelected);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [building, setBuilding] = useState<{
    mode: "create" | "revise";
    existing?: SequenceDetail;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await listSequences();
    if (res.ok) {
      setData(res.data);
      setError(null);
    } else setError(res.error.message);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    setSelected(initialSelected);
  }, [initialSelected]);

  if (loading) {
    return (
      <div className="grid min-h-[30vh] place-items-center text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading sequences…
        </span>
      </div>
    );
  }
  if (error || !data) return <ErrorNote message={error ?? "Unavailable"} onRetry={load} />;

  if (building) {
    return (
      <SequenceBuilder
        mode={building.mode}
        existing={building.existing}
        followUpAvailable={data.follow_up_available}
        onCancel={() => setBuilding(null)}
        onSaved={(campaignId) => {
          setBuilding(null);
          setSavedNotice(
            "Sequence saved as a draft — you're viewing it now. It stays under Campaigns → Sequences whenever you come back. Next: test each email on yourself.",
          );
          setSelected(campaignId);
          onSelectedChange?.(campaignId);
          void load();
        }}
      />
    );
  }
  if (selected) {
    return (
      <SequenceDetailView
        campaignId={selected}
        caps={data}
        onBack={() => {
          setSavedNotice(null);
          setSelected(null);
          onSelectedChange?.(null);
        }}
        onChanged={load}
        onRevise={(detail) => setBuilding({ mode: "revise", existing: detail })}
        initialNotice={savedNotice}
      />
    );
  }

  return (
    <div className="space-y-4">
      {!data.unsubscribe_configured && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
          You can build, test and approve sequences now — activating one with an email step is
          unlocked once an administrator finishes the server setup (unsubscribe links need it).
          <TechnicalDetails className="mt-2" summary="What an administrator needs to do">
            Set the public Marketing base URL (MARKETING_PUBLIC_BASE_URL) so unsubscribe links can
            be built — the full steps are in BROADCAST_SETUP.md.
          </TechnicalDetails>
        </div>
      )}
      {!data.scheduler_configured && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
          Sequences will not advance on their own yet — an administrator still needs to switch on
          the schedule that moves contacts to their next step.
          <TechnicalDetails className="mt-2" summary="What an administrator needs to do">
            Configure MARKETING_SEQUENCE_SECRET (Edge secret + Vault) and install the sequence cron
            — the full steps are in SEQUENCE_SETUP.md.
          </TechnicalDetails>
        </div>
      )}
      {!data.follow_up_available && (
        <div className="rounded-lg border border-hairline bg-surface-alt px-3 py-2 text-xs text-muted-foreground">
          Follow-up task steps aren&apos;t available on this platform yet, so the builder
          doesn&apos;t offer them — everything else works.
          <TechnicalDetails className="mt-2" summary="Why">
            The platform has no state machine registered for core Actions, so a follow-up created
            here could never be started, completed or dismissed. The step unlocks the moment those
            transitions are registered — no Marketing change is needed.
          </TechnicalDetails>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-foreground">Sequences</div>
          <p className="text-xs text-muted-foreground">
            A series of emails and waits that runs by itself — welcome journeys, service reminders,
            follow-ups. Build it once, test it on yourself, approve it, then choose who goes through
            it.
          </p>
        </div>
        {data.can_draft && (
          <Btn tone="primary" onClick={() => setBuilding({ mode: "create" })}>
            <Plus className="h-3.5 w-3.5" /> New sequence
          </Btn>
        )}
      </div>

      {data.sequences.length === 0 ? (
        <div className="rounded-xl border border-dashed border-hairline bg-white p-8 text-center">
          <Mail className="mx-auto h-6 w-6 text-muted-foreground" />
          <div className="mt-2 text-sm font-medium text-foreground">No sequences yet</div>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            Build your first journey — for example a welcome series or a service reminder. Nothing
            sends until it is approved, activated, and you choose who goes through it.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-hairline bg-white">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-hairline">
                <th className="p-3">Sequence</th>
                <th className="p-3">Status</th>
                <th className="p-3">Revision</th>
                <th className="p-3">Enrolments</th>
                <th className="p-3">Next due</th>
              </tr>
            </thead>
            <tbody>
              {data.sequences.map((s: SequenceListRow) => (
                <tr
                  key={s.id}
                  className="cursor-pointer border-b border-hairline last:border-0 hover:bg-surface-alt"
                  onClick={() => {
                    setSelected(s.id);
                    onSelectedChange?.(s.id);
                  }}
                >
                  <td className="p-3">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelected(s.id);
                        onSelectedChange?.(s.id);
                      }}
                      className="text-left font-medium text-foreground underline decoration-hairline underline-offset-2 transition hover:decoration-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
                    >
                      {s.name}
                    </button>
                    <div className="text-[11px] text-muted-foreground">
                      {s.sender_mailbox ?? "no sender"} · {s.timezone ?? "—"}
                    </div>
                  </td>
                  <td className="p-3">
                    <StatusBadge status={s.status} />
                    {s.closed_at && (
                      <div className="mt-1 text-[10px] uppercase text-muted-foreground">closed</div>
                    )}
                  </td>
                  <td className="p-3 tabular text-muted-foreground">
                    {s.revision_number ? `r${s.revision_number}` : "—"} · {s.step_count ?? 0} steps
                  </td>
                  <td className="p-3 text-muted-foreground">
                    <span className="tabular">{s.enrolment_counts.active ?? 0}</span> active ·{" "}
                    <span className="tabular">{s.enrolment_counts.completed ?? 0}</span> done ·{" "}
                    <span
                      className={cn(
                        "tabular",
                        (s.enrolment_counts.held ?? 0) > 0 && "font-semibold text-warning",
                      )}
                    >
                      {s.enrolment_counts.held ?? 0}
                    </span>{" "}
                    held
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {s.next_due_at ? (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(s.next_due_at).toLocaleString()}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
