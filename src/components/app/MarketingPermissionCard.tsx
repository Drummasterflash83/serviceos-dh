/**
 * Email marketing permission — the customer-facing capture surface.
 *
 * The one governed place Drummonds records genuine marketing permission:
 * a titled card on the contact (current state in plain language, which email
 * address it applies to, when it took effect, the evidence, append-only
 * history) plus two guided dialogs — "Record permission" and "Record
 * unsubscribe" — and the controlled bulk variant used from the Contacts list.
 *
 * Honesty rules carried throughout: ServiceOS records the ORGANISATION'S
 * decision and evidence — it never assumes permission; a subscribed decision
 * demands basis + method + reference/note + attestation; unsubscribe is
 * one click; suppression is shown separately and is never bypassed.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, MailCheck, MailX, ShieldAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { marketingInputCls } from "@/components/app/MarketingFormKit";
import { eligibilityLanguage } from "@/lib/marketing/eligibility-language";
import {
  PERMISSION_BASIS_HINTS,
  PERMISSION_BASIS_LABELS,
  PERMISSION_DISCLAIMER,
  newPermissionRequestId,
  validatePermissionForm,
  type PermissionBasis,
  type PermissionDecision,
  type PermissionFormErrors,
  type PermissionFormInput,
} from "@/lib/marketing/permission";
import {
  getPermissionHistory,
  permissionBulkApply,
  permissionBulkPreflight,
  recordPermission,
  type PermissionBulkPreflight,
  type PermissionBulkResult,
  type PermissionHistory,
} from "@/lib/marketing/contacts";

const BASIS_KEYS = Object.keys(PERMISSION_BASIS_LABELS) as PermissionBasis[];

function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Human sentence for a history row's evidence envelope. */
function evidenceSummary(row: {
  lawful_basis: string | null;
  source: string;
  evidence: Record<string, unknown>;
}): string {
  const parts: string[] = [];
  const basis = row.lawful_basis as PermissionBasis | null;
  if (basis && PERMISSION_BASIS_LABELS[basis]) parts.push(PERMISSION_BASIS_LABELS[basis]);
  if (typeof row.evidence?.method === "string") parts.push(row.evidence.method as string);
  if (typeof row.evidence?.reference === "string") parts.push(row.evidence.reference as string);
  if (typeof row.evidence?.note === "string") parts.push(row.evidence.note as string);
  if (parts.length === 0) {
    if (row.source === "unsubscribe_link") return "They used the unsubscribe link in an email";
    return "No evidence details recorded";
  }
  return parts.join(" · ");
}

/* ── the shared guided evidence form ─────────────────────────────────────── */

function EvidenceFields({
  form,
  errors,
  onChange,
  showEffectiveDate = true,
}: {
  form: PermissionFormInput;
  errors: PermissionFormErrors;
  onChange: (next: Partial<PermissionFormInput>) => void;
  showEffectiveDate?: boolean;
}) {
  if (form.decision === "unsubscribed") {
    return (
      <div className="space-y-3">
        <label className="block">
          <div className="mb-1 text-xs font-medium text-foreground">Note (optional)</div>
          <input
            className={marketingInputCls}
            value={form.note ?? ""}
            placeholder="e.g. Asked us to stop by phone today"
            maxLength={500}
            onChange={(e) => onChange({ note: e.target.value })}
          />
          {errors.note && (
            <div className="mt-1 text-[11px] font-medium text-destructive">{errors.note}</div>
          )}
        </label>
        {showEffectiveDate && (
          <label className="block">
            <div className="mb-1 text-xs font-medium text-foreground">
              When did they ask? (optional — today if left empty)
            </div>
            <input
              type="date"
              className={marketingInputCls}
              value={form.effective_at ?? ""}
              onChange={(e) => onChange({ effective_at: e.target.value })}
            />
            {errors.effective_at && (
              <div className="mt-1 text-[11px] font-medium text-destructive">
                {errors.effective_at}
              </div>
            )}
          </label>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <fieldset>
        <legend className="mb-1 text-xs font-medium text-foreground">
          What genuinely happened?
        </legend>
        <div className="space-y-1.5">
          {BASIS_KEYS.map((b) => (
            <label
              key={b}
              className={cn(
                "flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-xs transition",
                form.basis === b
                  ? "border-accent bg-accent/5"
                  : "border-foreground/20 bg-white hover:bg-surface-alt",
              )}
            >
              <input
                type="radio"
                name="permission-basis"
                className="mt-0.5"
                checked={form.basis === b}
                onChange={() => onChange({ basis: b })}
              />
              <span>
                <span className="font-medium text-foreground">{PERMISSION_BASIS_LABELS[b]}</span>
                <span className="mt-0.5 block text-muted-foreground">
                  {PERMISSION_BASIS_HINTS[b]}
                </span>
              </span>
            </label>
          ))}
        </div>
        {errors.basis && (
          <div className="mt-1 text-[11px] font-medium text-destructive">{errors.basis}</div>
        )}
      </fieldset>
      <label className="block">
        <div className="mb-1 text-xs font-medium text-foreground">How was it given?</div>
        <input
          className={marketingInputCls}
          value={form.evidence_method ?? ""}
          placeholder='e.g. "Signup form on our website" or "Service contract on file"'
          maxLength={200}
          onChange={(e) => onChange({ evidence_method: e.target.value })}
        />
        {errors.evidence_method && (
          <div className="mt-1 text-[11px] font-medium text-destructive">
            {errors.evidence_method}
          </div>
        )}
      </label>
      <label className="block">
        <div className="mb-1 text-xs font-medium text-foreground">
          Where can the evidence be found?
        </div>
        <input
          className={marketingInputCls}
          value={form.evidence_reference ?? ""}
          placeholder='e.g. "Form submission 3 Aug 2026" or "Contract in customer file"'
          maxLength={500}
          onChange={(e) => onChange({ evidence_reference: e.target.value })}
        />
        {errors.evidence_reference && (
          <div className="mt-1 text-[11px] font-medium text-destructive">
            {errors.evidence_reference}
          </div>
        )}
      </label>
      <label className="block">
        <div className="mb-1 text-xs font-medium text-foreground">Note (optional)</div>
        <input
          className={marketingInputCls}
          value={form.note ?? ""}
          placeholder="Anything else your team should know"
          maxLength={500}
          onChange={(e) => onChange({ note: e.target.value })}
        />
        {errors.note && (
          <div className="mt-1 text-[11px] font-medium text-destructive">{errors.note}</div>
        )}
      </label>
      {showEffectiveDate && (
        <label className="block">
          <div className="mb-1 text-xs font-medium text-foreground">
            When was it given? (today if left empty)
          </div>
          <input
            type="date"
            className={marketingInputCls}
            value={form.effective_at ?? ""}
            onChange={(e) => onChange({ effective_at: e.target.value })}
          />
          {errors.effective_at && (
            <div className="mt-1 text-[11px] font-medium text-destructive">
              {errors.effective_at}
            </div>
          )}
        </label>
      )}
      <label
        className={cn(
          "flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-xs",
          form.attestation ? "border-accent bg-accent/5" : "border-foreground/20 bg-white",
        )}
      >
        <input
          type="checkbox"
          className="mt-0.5"
          checked={form.attestation === true}
          onChange={(e) => onChange({ attestation: e.target.checked })}
        />
        <span className="text-foreground">
          I confirm this decision and evidence are genuine and documented by our organisation.
        </span>
      </label>
      {errors.attestation && (
        <div className="text-[11px] font-medium text-destructive">{errors.attestation}</div>
      )}
    </div>
  );
}

/* ── single-contact guided dialog ────────────────────────────────────────── */

function PermissionDialog({
  personId,
  personName,
  emailOptions,
  decision,
  onClose,
  onRecorded,
}: {
  personId: string;
  personName: string;
  emailOptions: { id: string; value: string; is_primary: boolean }[];
  decision: PermissionDecision;
  onClose: () => void;
  onRecorded: () => void;
}) {
  const [form, setForm] = useState<PermissionFormInput>({ decision });
  const [errors, setErrors] = useState<PermissionFormErrors>({});
  const [pointId, setPointId] = useState<string>(
    emailOptions.find((o) => o.is_primary)?.id ?? emailOptions[0]?.id ?? "",
  );
  const [requestId] = useState(newPermissionRequestId());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const nextErrors = validatePermissionForm(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setBusy(true);
    setError(null);
    const r = await recordPermission({
      person_id: personId,
      ...(pointId ? { contact_point_id: pointId } : {}),
      decision,
      ...(form.basis ? { basis: form.basis } : {}),
      ...(form.evidence_method ? { evidence_method: form.evidence_method } : {}),
      ...(form.evidence_reference ? { evidence_reference: form.evidence_reference } : {}),
      ...(form.note ? { note: form.note } : {}),
      ...(form.effective_at ? { effective_at: form.effective_at } : {}),
      ...(form.attestation !== undefined ? { attestation: form.attestation } : {}),
      request_id: requestId,
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    onRecorded();
  };

  const email = emailOptions.find((o) => o.id === pointId)?.value ?? "";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-auto">
        <DialogHeader>
          <DialogTitle>
            {decision === "subscribed" ? "Record marketing permission" : "Record unsubscribe"}
          </DialogTitle>
          <DialogDescription>{PERMISSION_DISCLAIMER}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {emailOptions.length > 1 ? (
            <label className="block">
              <div className="mb-1 text-xs font-medium text-foreground">
                Which email address does this apply to?
              </div>
              <select
                className={marketingInputCls}
                value={pointId}
                onChange={(e) => setPointId(e.target.value)}
              >
                {emailOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.value}
                    {o.is_primary ? " (primary)" : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="text-xs text-muted-foreground">
              This applies to <span className="font-medium text-foreground">{email}</span>.
            </p>
          )}
          <EvidenceFields
            form={form}
            errors={errors}
            onChange={(next) => {
              setForm((f) => ({ ...f, ...next }));
              setErrors({});
            }}
          />
          <div className="rounded-lg border border-hairline bg-surface-alt/60 px-3 py-2 text-xs text-muted-foreground">
            {decision === "subscribed" ? (
              <>
                When you save: {personName || "this contact"} becomes eligible for campaigns at{" "}
                <span className="font-medium text-foreground">{email}</span> (unless another issue
                such as suppression still excludes them), and this decision joins their permanent
                permission history.
              </>
            ) : (
              <>
                When you save: campaigns stop including {personName || "this contact"} at{" "}
                <span className="font-medium text-foreground">{email}</span> immediately. A later
                re-subscription will need new evidence.
              </>
            )}
          </div>
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-hairline bg-white px-3 py-1.5 text-xs font-medium hover:bg-surface-alt"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 disabled:opacity-50"
            >
              {busy && <Loader2 className="h-3 w-3 animate-spin" />}
              {decision === "subscribed" ? "Record permission" : "Record unsubscribe"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── the contact-detail card ─────────────────────────────────────────────── */

export function MarketingPermissionCard({
  personId,
  personName,
  emailOptions,
  canManage,
  onChanged,
}: {
  personId: string;
  personName: string;
  emailOptions: { id: string; value: string; is_primary: boolean }[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const [data, setData] = useState<PermissionHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<PermissionDecision | null>(null);

  const reload = useCallback(async () => {
    const r = await getPermissionHistory(personId);
    if (r.ok) {
      setData(r.data);
      setError(null);
    } else setError(r.error.message);
  }, [personId]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const latest = data?.history[0] ?? null;
  const lang = data ? eligibilityLanguage(data.eligibility) : null;
  const hasUsableEmail = emailOptions.length > 0;

  return (
    <div className="rounded-lg border border-foreground/15 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Email marketing permission
        </div>
        {canManage && hasUsableEmail && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDialog("subscribed")}
              className="inline-flex items-center gap-1 rounded-lg bg-foreground px-2.5 py-1 text-[11px] font-medium text-background hover:opacity-90"
            >
              <MailCheck className="h-3 w-3" /> Record permission
            </button>
            <button
              type="button"
              onClick={() => setDialog("unsubscribed")}
              className="inline-flex items-center gap-1 rounded-lg border border-hairline bg-white px-2.5 py-1 text-[11px] font-medium hover:bg-surface-alt"
            >
              <MailX className="h-3 w-3" /> Record unsubscribe
            </button>
          </div>
        )}
      </div>

      {!data && !error && (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading permission history…
        </div>
      )}
      {error && <div className="mt-2 text-xs text-destructive">{error}</div>}

      {data && lang && (
        <div className="mt-2 space-y-2 text-xs">
          <p>
            <span className="font-medium text-foreground">{lang.label}.</span>{" "}
            <span className="text-muted-foreground">{lang.meaning}</span>
          </p>
          {latest && (
            <p className="text-muted-foreground">
              Latest decision: <span className="text-foreground">{latest.state}</span>
              {latest.email && (
                <>
                  {" "}
                  for <span className="text-foreground">{latest.email}</span>
                </>
              )}{" "}
              · effective {fmtWhen(latest.effective_at)} · {evidenceSummary(latest)}
            </p>
          )}
          {data.suppressed && (
            <p className="flex items-start gap-1.5 text-destructive">
              <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" />A hard suppression also excludes
              this contact from all campaigns (for example after an unsubscribe link or a
              complaint). Recording permission here never bypasses it.
            </p>
          )}
          {!hasUsableEmail && (
            <p className="text-muted-foreground">
              No usable email address is on record, so no email permission can be recorded yet — add
              an email address first (Edit contact).
            </p>
          )}
          {data.history.length > 0 && (
            <div>
              <div className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                History (append-only)
              </div>
              <ul className="mt-1 space-y-1">
                {data.history.slice(0, 6).map((h) => (
                  <li key={h.id} className="text-muted-foreground">
                    <span
                      className={cn(
                        "font-medium",
                        h.state === "subscribed" ? "text-success" : "text-foreground",
                      )}
                    >
                      {h.state}
                    </span>{" "}
                    · effective {fmtWhen(h.effective_at)} · {evidenceSummary(h)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.history.length === 0 && (
            <p className="text-muted-foreground">
              No permission decision has been recorded yet
              {canManage && hasUsableEmail ? " — use “Record permission” above." : "."}
            </p>
          )}
        </div>
      )}

      {dialog && (
        <PermissionDialog
          personId={personId}
          personName={personName}
          emailOptions={emailOptions}
          decision={dialog}
          onClose={() => setDialog(null)}
          onRecorded={() => {
            setDialog(null);
            void reload();
            onChanged();
          }}
        />
      )}
    </div>
  );
}

/* ── controlled bulk workflow (Contacts list) ────────────────────────────── */

export function BulkPermissionDialog({
  personIds,
  onClose,
  onApplied,
}: {
  personIds: string[];
  onClose: () => void;
  onApplied: () => void;
}) {
  const [decision, setDecision] = useState<PermissionDecision>("subscribed");
  const [form, setForm] = useState<PermissionFormInput>({ decision: "subscribed" });
  const [errors, setErrors] = useState<PermissionFormErrors>({});
  const [preflight, setPreflight] = useState<PermissionBulkPreflight | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<PermissionBulkResult | null>(null);
  const [requestId] = useState(newPermissionRequestId());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const evidenceArgs = useMemo(
    () => ({
      ...(form.basis ? { basis: form.basis } : {}),
      ...(form.evidence_method ? { evidence_method: form.evidence_method } : {}),
      ...(form.evidence_reference ? { evidence_reference: form.evidence_reference } : {}),
      ...(form.note ? { note: form.note } : {}),
      ...(form.effective_at ? { effective_at: form.effective_at } : {}),
      ...(form.attestation !== undefined ? { attestation: form.attestation } : {}),
    }),
    [form],
  );

  const runPreflight = useCallback(async () => {
    setBusy(true);
    setError(null);
    const r = await permissionBulkPreflight({ person_ids: personIds, decision });
    setBusy(false);
    if (r.ok) setPreflight(r.data);
    else setError(r.error.message);
  }, [personIds, decision]);
  useEffect(() => {
    void runPreflight();
  }, [runPreflight]);

  const apply = async () => {
    if (!preflight) return;
    setBusy(true);
    setError(null);
    const r = await permissionBulkApply({
      person_ids: personIds,
      decision,
      ...evidenceArgs,
      request_id: requestId,
      contract: preflight.contract,
    });
    setBusy(false);
    if (!r.ok) {
      setConfirming(false);
      if (r.error.code === "VERSION_CONFLICT") {
        setError("The selection changed since it was checked — reviewing it again.");
        void runPreflight();
      } else {
        setError(r.error.message);
      }
      return;
    }
    setResult(r.data);
  };

  const goToConfirm = () => {
    const nextErrors = validatePermissionForm({ ...form, decision });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setConfirming(true);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-auto">
        <DialogHeader>
          <DialogTitle>Record marketing permission — selected contacts</DialogTitle>
          <DialogDescription>{PERMISSION_DISCLAIMER}</DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3 text-sm">
            <div className="rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-xs text-foreground">
              Recorded: ONE {result.decision} decision for exactly{" "}
              <span className="font-semibold">{result.applied}</span>{" "}
              {result.applied === 1 ? "contact" : "contacts"}.
              {result.refused_count > 0 && (
                <>
                  {" "}
                  {result.refused_count} of the selected contacts{" "}
                  {result.refused_count === 1 ? "was" : "were"} not touched (no usable email).
                </>
              )}
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onApplied}
                className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90"
              >
                Done
              </button>
            </div>
          </div>
        ) : !preflight ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking the selected contacts…
          </div>
        ) : confirming ? (
          <div className="space-y-3 text-sm">
            <p className="text-xs text-foreground">
              You are about to record{" "}
              <span className="font-semibold">
                ONE {decision} decision for exactly {preflight.eligible_count}{" "}
                {preflight.eligible_count === 1 ? "contact" : "contacts"}
              </span>
              {decision === "subscribed" && form.basis && (
                <>
                  {" "}
                  — basis: {PERMISSION_BASIS_LABELS[form.basis as PermissionBasis] ?? form.basis}
                </>
              )}
              . The same evidence is recorded for each of them, and each gains a permanent history
              row. Nothing else changes.
            </p>
            {preflight.refused_count > 0 && (
              <p className="text-xs text-muted-foreground">
                {preflight.refused_count} selected{" "}
                {preflight.refused_count === 1 ? "contact is" : "contacts are"} NOT included (no
                usable email address).
              </p>
            )}
            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded-lg border border-hairline bg-white px-3 py-1.5 text-xs font-medium hover:bg-surface-alt"
              >
                Go back
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void apply()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 disabled:opacity-50"
              >
                {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                Record for {preflight.eligible_count}{" "}
                {preflight.eligible_count === 1 ? "contact" : "contacts"}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <p className="text-xs text-muted-foreground">
              You selected {preflight.requested}{" "}
              {preflight.requested === 1 ? "contact" : "contacts"}
              {preflight.unique !== preflight.requested && <> ({preflight.unique} unique)</>} — only
              these explicitly selected contacts are affected, never contacts on other pages. Up to{" "}
              {preflight.cap} at a time.
            </p>
            <div className="max-h-36 overflow-auto rounded-lg border border-hairline p-2 text-xs">
              {preflight.eligible.map((e) => (
                <div key={e.person_id} className="flex justify-between gap-2">
                  <span className="truncate text-foreground">{e.display_name}</span>
                  <span className="truncate text-muted-foreground">{e.email}</span>
                </div>
              ))}
              {preflight.eligible_count === 0 && (
                <div className="text-muted-foreground">
                  None of the selected contacts has a usable email address.
                </div>
              )}
            </div>
            {preflight.refused_count > 0 && (
              <div className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-muted-foreground">
                {preflight.refused_count} selected{" "}
                {preflight.refused_count === 1 ? "contact" : "contacts"} will NOT be included:{" "}
                {preflight.refused
                  .map((r) =>
                    r.reason === "no_usable_email" ? "no usable email address" : "not found",
                  )
                  .filter((v, i, a) => a.indexOf(v) === i)
                  .join(", ")}
                .
              </div>
            )}
            <div className="flex gap-2">
              {(["subscribed", "unsubscribed"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => {
                    setDecision(d);
                    setForm((f) => ({ ...f, decision: d }));
                    setErrors({});
                  }}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-xs font-medium transition",
                    decision === d
                      ? "bg-foreground text-background"
                      : "border border-hairline bg-white text-foreground hover:bg-surface-alt",
                  )}
                >
                  {d === "subscribed" ? "Record permission" : "Record unsubscribe"}
                </button>
              ))}
            </div>
            <EvidenceFields
              form={{ ...form, decision }}
              errors={errors}
              onChange={(next) => {
                setForm((f) => ({ ...f, ...next }));
                setErrors({});
              }}
            />
            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-hairline bg-white px-3 py-1.5 text-xs font-medium hover:bg-surface-alt"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || preflight.eligible_count === 0}
                onClick={goToConfirm}
                className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 disabled:opacity-50"
              >
                Continue
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
