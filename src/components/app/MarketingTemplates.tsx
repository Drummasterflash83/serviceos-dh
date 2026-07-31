// Marketing Templates (Phase 7) — versioned, immutable template revisions on
// the ONE safe content model. Revising creates a new immutable revision; using
// a template PINS an exact revision into a campaign draft (never bypassing
// review/approval/preflight); archive preserves every revision and every
// existing campaign usage. Quality guidance is deterministic and clearly
// advisory — it is not AI and it never blocks. Hidden controls are NOT the
// security boundary — the server enforces every permission again.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Copy,
  Eye,
  FileText,
  ListChecks,
  Loader2,
  Plus,
  Send,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  createTemplate,
  duplicateTemplate,
  getTemplateDetail,
  listTemplates,
  previewTemplateContent,
  qualityCheck,
  reviseTemplate,
  setTemplateStatus,
  applyTemplateToBroadcast,
  applyTemplateToSequenceStep,
  newTemplateRequestId,
  type QualityReport,
  type TemplateContent,
  type TemplateDetail,
  type TemplateListRow,
  type TemplatePreview,
} from "@/lib/marketing/templates";
import { listCampaigns } from "@/lib/marketing/campaigns";
import { listSequences } from "@/lib/marketing/sequences";
import { getSendersOverview } from "@/lib/marketing/senders";
import { listSegments } from "@/lib/marketing/segments";

/* ── local atoms (file-local by repo convention) ─────────────────────────── */

// Request-key discipline: every mutation carries a request id keyed to its
// SEMANTIC scope. An unchanged retry (same scope) reuses its key and
// converges idempotently on the server; any change to the semantic inputs is
// a different scope and therefore a different key; a SUCCESS clears the
// scope so the next distinct operation gets a fresh key.
const requestKeys = new Map<string, string>();
function requestKeyFor(scope: string): string {
  let k = requestKeys.get(scope);
  if (!k) {
    k = newTemplateRequestId();
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
    <label className="block text-xs">
      <span className="font-medium text-foreground">{label}</span>
      {hint && <span className="ml-2 text-muted-foreground">{hint}</span>}
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

function ForbiddenNote({ needs }: { needs: string }) {
  // a dedicated permission-denial state: never a retryable failure, never a
  // configuration hint — and it reveals nothing about what exists
  return (
    <div role="status" className="rounded-xl border border-hairline bg-surface-alt p-4">
      <div className="text-sm font-medium text-foreground">You don&apos;t have access to this</div>
      <div className="mt-1 text-xs text-muted-foreground">
        This area needs the {needs} permission. An owner or admin can grant it from Marketing access
        settings.
      </div>
    </div>
  );
}

/* ── guided editor ───────────────────────────────────────────────────────── */

interface EditorState {
  name: string;
  description: string;
  subject: string;
  preview_text: string;
  body_authored: string;
  token_fallbacks: Record<string, string>;
}

const EMPTY_EDITOR: EditorState = {
  name: "",
  description: "",
  subject: "",
  preview_text: "",
  body_authored: "",
  token_fallbacks: {},
};

function usedTokensOf(subject: string, body: string): string[] {
  const found = new Set<string>();
  for (const m of `${subject}\n${body}`.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)) found.add(m[1]);
  return [...found];
}

function editorContent(f: EditorState): TemplateContent {
  return {
    subject: f.subject,
    preview_text: f.preview_text.trim() === "" ? null : f.preview_text,
    body_authored: f.body_authored,
    token_fallbacks: f.token_fallbacks,
  };
}

/* ── use-in dialogs (launchDialog focus recipe: initial focus on Cancel,
      Tab trap, Escape closes — replacing draft content is confirmed
      explicitly, never a stray keypress) ──────────────────────────────────── */

function useDialogChrome(onClose: () => void) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  // remember the invoking control on OPEN and restore focus to it on CLOSE;
  // if it disappeared, fall back deterministically to the selected tab
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
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
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

function UseInBroadcastDialog({
  revisionId,
  revisionNumber,
  templateName,
  onClose,
  onDone,
}: {
  revisionId: string;
  revisionNumber: number;
  templateName: string;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const { dialogRef, cancelRef } = useDialogChrome(onClose);
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [name, setName] = useState("");
  const [senderId, setSenderId] = useState("");
  const [segmentId, setSegmentId] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [senders, setSenders] = useState<{ id: string; label: string }[]>([]);
  const [segments, setSegments] = useState<{ id: string; name: string }[]>([]);
  const [drafts, setDrafts] = useState<
    { id: string; name: string; status: string; version: number }[]
  >([]);

  useEffect(() => {
    (async () => {
      const [sv, sg, cs] = await Promise.all([
        getSendersOverview(),
        listSegments(),
        listCampaigns(50),
      ]);
      if (sv.ok) {
        setSenders(
          (sv.data.senders ?? []).map(
            (s: { id: string; label?: string; mailbox_address: string }) => ({
              id: s.id,
              label: s.label || s.mailbox_address,
            }),
          ),
        );
      }
      if (sg.ok) setSegments((sg.data.segments ?? []).map((s) => ({ id: s.id, name: s.name })));
      if (cs.ok) {
        setDrafts(
          (cs.data.campaigns ?? [])
            .filter((c) => ["draft", "review", "approved"].includes(c.status))
            .map((c) => ({ id: c.id, name: c.name, status: c.status, version: c.version })),
        );
      }
    })();
  }, []);

  const run = async () => {
    setBusy(true);
    setError(null);
    const target = drafts.find((d) => d.id === campaignId);
    const scope =
      mode === "new"
        ? `useb:new:${revisionId}:${name}:${senderId}:${segmentId}`
        : `useb:existing:${revisionId}:${campaignId}:${target?.version ?? 0}`;
    const res = await applyTemplateToBroadcast(
      mode === "new"
        ? {
            template_revision_id: revisionId,
            mode,
            name,
            sender_id: senderId,
            segment_id: segmentId,
            request_id: requestKeyFor(scope),
          }
        : {
            template_revision_id: revisionId,
            mode,
            campaign_id: campaignId,
            expected_version: target?.version ?? 0,
            request_id: requestKeyFor(scope),
          },
    );
    setBusy(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    clearRequestKey(scope);
    onDone(
      mode === "new"
        ? "New broadcast draft created from the pinned template revision."
        : "Draft content replaced with the pinned template revision — any prior approval/preflight is invalidated.",
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="use-broadcast-title"
        className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-xl border border-hairline bg-white p-5"
      >
        <div id="use-broadcast-title" className="text-sm font-semibold text-foreground">
          Use “{templateName}” (revision {revisionNumber}) in a Broadcast
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          The campaign pins this exact revision. Later template edits never change the campaign, and
          using a template never bypasses review, approval or preflight.
        </p>
        <div className="mt-3 flex gap-2">
          <Btn
            tone={mode === "new" ? "primary" : "default"}
            pressed={mode === "new"}
            onClick={() => setMode("new")}
          >
            New draft
          </Btn>
          <Btn
            tone={mode === "existing" ? "primary" : "default"}
            pressed={mode === "existing"}
            onClick={() => setMode("existing")}
          >
            Replace draft content
          </Btn>
        </div>
        <div className="mt-3 space-y-3">
          {mode === "new" ? (
            <>
              <Field label="Campaign name">
                <input
                  className={inputCls}
                  value={name}
                  maxLength={120}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field label="Sender">
                <select
                  className={inputCls}
                  value={senderId}
                  onChange={(e) => setSenderId(e.target.value)}
                >
                  <option value="">Choose a sender…</option>
                  {senders.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Segment">
                <select
                  className={inputCls}
                  value={segmentId}
                  onChange={(e) => setSegmentId(e.target.value)}
                >
                  <option value="">Choose a segment…</option>
                  {segments.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          ) : (
            <>
              <Field
                label="Broadcast draft"
                hint="replacing content creates a new revision and invalidates any approval"
              >
                <select
                  className={inputCls}
                  value={campaignId}
                  onChange={(e) => setCampaignId(e.target.value)}
                >
                  <option value="">Choose a campaign…</option>
                  {drafts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.status})
                    </option>
                  ))}
                </select>
              </Field>
              <div className="rounded-lg border border-warning/40 bg-warning/10 p-2 text-[11px] text-foreground">
                This replaces the campaign’s current draft content with the pinned template
                revision. The existing content stays in the campaign’s immutable history.
              </div>
            </>
          )}
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
          <Btn
            tone="primary"
            busy={busy}
            disabled={mode === "new" ? !name || !senderId || !segmentId : !campaignId}
            onClick={run}
          >
            <Send className="h-3 w-3" />
            {mode === "new" ? "Create draft" : "Replace content"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

function UseInSequenceDialog({
  revisionId,
  revisionNumber,
  templateName,
  onClose,
  onDone,
}: {
  revisionId: string;
  revisionNumber: number;
  templateName: string;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const { dialogRef, cancelRef } = useDialogChrome(onClose);
  const [campaignId, setCampaignId] = useState("");
  const [stepKey, setStepKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sequences, setSequences] = useState<
    { id: string; name: string; status: string; version: number }[]
  >([]);

  useEffect(() => {
    (async () => {
      const r = await listSequences(50);
      if (r.ok) {
        setSequences(
          (r.data.sequences ?? [])
            .filter((s: { status: string }) =>
              ["draft", "review", "approved", "paused"].includes(s.status),
            )
            .map((s: { id: string; name: string; status: string; version: number }) => ({
              id: s.id,
              name: s.name,
              status: s.status,
              version: s.version,
            })),
        );
      }
    })();
  }, []);

  const run = async () => {
    setBusy(true);
    setError(null);
    const target = sequences.find((s) => s.id === campaignId);
    const scope = `useq:${revisionId}:${campaignId}:${target?.version ?? 0}:${stepKey || "append"}`;
    const res = await applyTemplateToSequenceStep({
      template_revision_id: revisionId,
      campaign_id: campaignId,
      expected_version: target?.version ?? 0,
      ...(stepKey ? { step_key: stepKey } : { append_step: true }),
      request_id: requestKeyFor(scope),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    clearRequestKey(scope);
    onDone(
      "Sequence revision created with the pinned template content. The sequence returns to draft for re-approval; live enrolments stay pinned to their own revision.",
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="use-sequence-title"
        className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-xl border border-hairline bg-white p-5"
      >
        <div id="use-sequence-title" className="text-sm font-semibold text-foreground">
          Use “{templateName}” (revision {revisionNumber}) in a Sequence email step
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Adds (or replaces) a send-email step with this exact pinned revision. An ACTIVE sequence
          must be paused first; the change creates a new immutable sequence revision that needs
          re-approval.
        </p>
        <div className="mt-3 space-y-3">
          <Field label="Sequence">
            <select
              className={inputCls}
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
            >
              <option value="">Choose a sequence…</option>
              {sequences.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.status})
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Step key to replace"
            hint="leave empty to append a new email step at the end"
          >
            <input
              className={inputCls}
              value={stepKey}
              maxLength={40}
              onChange={(e) => setStepKey(e.target.value)}
              placeholder="(append a new step)"
            />
          </Field>
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
          <Btn tone="primary" busy={busy} disabled={!campaignId} onClick={run}>
            <ListChecks className="h-3 w-3" /> Place into sequence
          </Btn>
        </div>
      </div>
    </div>
  );
}

/* ── main ────────────────────────────────────────────────────────────────── */

export function MarketingTemplates({ canDraft }: { canDraft: boolean }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<TemplateListRow[]>([]);
  const [counts, setCounts] = useState<{ active: number; archived: number }>({
    active: 0,
    archived: 0,
  });
  const [statusFilter, setStatusFilter] = useState<"active" | "archived">("active");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<TemplateDetail | null>(null);
  const [form, setForm] = useState<EditorState>(EMPTY_EDITOR);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [forbidden, setForbidden] = useState(false);
  const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [preview, setPreview] = useState<TemplatePreview | null>(null);
  const [quality, setQuality] = useState<QualityReport | null>(null);
  const [checking, setChecking] = useState(false);

  const [useBroadcast, setUseBroadcast] = useState<{
    revisionId: string;
    revisionNumber: number;
    templateName: string;
  } | null>(null);
  const [useSequence, setUseSequence] = useState<{
    revisionId: string;
    revisionNumber: number;
    templateName: string;
  } | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await listTemplates({
      status: statusFilter,
      ...(search.trim() ? { search: search.trim() } : {}),
    });
    setLoading(false);
    if (!r.ok) {
      // permission denial is its OWN state, never a retryable failure
      if (r.error.code === "FORBIDDEN") {
        setForbidden(true);
        return;
      }
      setError(r.error.message);
      return;
    }
    setForbidden(false);
    setRows(r.data.templates ?? []);
    setCounts(r.data.counts ?? { active: 0, archived: 0 });
  }, [statusFilter, search]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    setPreview(null);
    setQuality(null);
    const r = await getTemplateDetail(id);
    setDetailLoading(false);
    if (!r.ok) {
      setNotice(r.error.message);
      return;
    }
    setDetail(r.data);
  };

  const openEditor = (t: TemplateDetail | null) => {
    setEditing(t);
    setSaveError(null);
    if (t) {
      const cur = t.revisions.find((r) => r.id === t.current_revision_id) ?? t.revisions[0];
      setForm({
        name: t.name,
        description: t.description ?? "",
        subject: cur?.subject ?? "",
        preview_text: cur?.preview_text ?? "",
        body_authored: cur?.body_authored ?? "",
        token_fallbacks: cur?.token_fallbacks ?? {},
      });
    } else {
      setForm(EMPTY_EDITOR);
    }
    setEditorOpen(true);
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    const content = editorContent(form);
    // the scope serialises every semantic input, so an edited form derives a
    // NEW key while an unchanged retry converges on the server
    const scope = editing
      ? `revise:${editing.id}:${editing.version}:${JSON.stringify([form, content])}`
      : `create:${JSON.stringify([form, content])}`;
    const res = editing
      ? await reviseTemplate(
          editing.id,
          editing.version,
          {
            name: form.name,
            description: form.description,
            ...content,
            preview_text: form.preview_text,
          },
          requestKeyFor(scope),
        )
      : await createTemplate(
          {
            name: form.name,
            ...(form.description.trim() ? { description: form.description } : {}),
            ...content,
          },
          requestKeyFor(scope),
        );
    setSaving(false);
    if (!res.ok) {
      setSaveError(res.error.message);
      return;
    }
    clearRequestKey(scope);
    setEditorOpen(false);
    setDetail(null);
    setNotice(
      editing
        ? "New immutable revision created. Campaigns pinned to earlier revisions are unchanged."
        : "Template created.",
    );
    void reload();
  };

  const runPreviewAndQuality = async () => {
    setChecking(true);
    setPreview(null);
    setQuality(null);
    const content = editorContent(form);
    const [p, q] = await Promise.all([previewTemplateContent(content), qualityCheck(content)]);
    setChecking(false);
    if (p.ok) setPreview(p.data);
    else setSaveError(p.error.message);
    if (q.ok) setQuality(q.data);
  };

  const tokens = useMemo(() => usedTokensOf(form.subject, form.body_authored), [form]);

  if (loading && rows.length === 0 && !forbidden) {
    return (
      <div
        role="status"
        className="grid min-h-[30vh] place-items-center text-sm text-muted-foreground"
      >
        <span className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading templates…
        </span>
      </div>
    );
  }
  if (forbidden) return <ForbiddenNote needs="Marketing view" />;
  if (error) return <ErrorNote message={error} onRetry={() => void reload()} />;

  return (
    <div className="space-y-4">
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
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {(["active", "archived"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              aria-pressed={statusFilter === s}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium",
                statusFilter === s
                  ? "bg-foreground text-background"
                  : "border border-hairline bg-white text-muted-foreground hover:bg-surface-alt",
              )}
            >
              {s === "active" ? `Active (${counts.active})` : `Archived (${counts.archived})`}
            </button>
          ))}
        </div>
        <input
          className="w-56 rounded-lg border border-hairline bg-white px-3 py-1.5 text-xs"
          placeholder="Search by name…"
          aria-label="Search templates by name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="grow" />
        {canDraft && (
          <Btn tone="primary" onClick={() => openEditor(null)}>
            <Plus className="h-3 w-3" /> New template
          </Btn>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-hairline bg-white p-8 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-surface-alt">
            <FileText className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="mt-2 text-sm font-medium text-foreground">
            {statusFilter === "archived" ? "No archived templates" : "No templates yet"}
          </div>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            {canDraft
              ? "Create a reusable, versioned email template. Campaigns pin the exact revision they use."
              : "Your role can view templates once they exist."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-hairline bg-white">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-hairline text-muted-foreground">
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Owner</th>
                <th className="px-3 py-2 font-medium">Current revision</th>
                <th className="px-3 py-2 font-medium">Usage</th>
                <th className="px-3 py-2 font-medium">Updated</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="border-b border-hairline/60 last:border-0">
                  <td className="px-3 py-2">
                    <button
                      className="font-medium text-foreground underline-offset-2 hover:underline"
                      onClick={() => void openDetail(t.id)}
                    >
                      {t.name}
                    </button>
                    {t.description && (
                      <div className="mt-0.5 max-w-xs truncate text-muted-foreground">
                        {t.description}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                        t.status === "active"
                          ? "bg-success/10 text-success"
                          : "bg-surface-alt text-muted-foreground",
                      )}
                    >
                      {t.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{t.created_by_email ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {t.current_revision
                      ? `#${t.current_revision.revision_number} · ${t.current_revision.subject.slice(0, 40)}`
                      : "—"}
                    <span className="ml-1 text-muted-foreground/70">
                      ({t.revision_count} total)
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular text-muted-foreground">
                    {t.usage_count}
                    {t.last_used_at && (
                      <span className="ml-1">
                        · last {new Date(t.last_used_at).toLocaleDateString()}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {new Date(t.updated_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      {canDraft && t.status === "active" && (
                        <Btn
                          onClick={async () => {
                            const scope = `dup:${t.id}`;
                            const r = await duplicateTemplate(t.id, requestKeyFor(scope));
                            if (r.ok) {
                              clearRequestKey(scope);
                              setNotice("Template duplicated.");
                              void reload();
                            } else setNotice(r.error.message);
                          }}
                          title="Duplicate"
                        >
                          <Copy className="h-3 w-3" />
                        </Btn>
                      )}
                      {canDraft && (
                        <Btn
                          onClick={async () => {
                            const next = t.status === "active" ? "archived" : "active";
                            const scope = `status:${t.id}:${t.version}:${next}`;
                            const r = await setTemplateStatus(
                              t.id,
                              t.version,
                              next,
                              requestKeyFor(scope),
                            );
                            if (r.ok) {
                              clearRequestKey(scope);
                              setNotice(
                                t.status === "active"
                                  ? "Template archived — history and existing campaign usage are preserved."
                                  : "Template restored.",
                              );
                              void reload();
                            } else setNotice(r.error.message);
                          }}
                          title={t.status === "active" ? "Archive" : "Restore"}
                        >
                          {t.status === "active" ? (
                            <Archive className="h-3 w-3" />
                          ) : (
                            <ArchiveRestore className="h-3 w-3" />
                          )}
                        </Btn>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* detail + revision history */}
      {detailLoading && (
        <div className="rounded-xl border border-hairline bg-white p-4 text-xs text-muted-foreground">
          <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> Loading template…
        </div>
      )}
      {detail && (
        <div className="rounded-xl border border-hairline bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-foreground">{detail.name}</div>
              <div className="text-xs text-muted-foreground">
                {detail.status} · {detail.revisions.length} revision
                {detail.revisions.length === 1 ? "" : "s"} · used {detail.usage.total} time
                {detail.usage.total === 1 ? "" : "s"}
                {detail.usage.last_used_at &&
                  ` · last used ${new Date(detail.usage.last_used_at).toLocaleString()}`}
              </div>
            </div>
            <div className="flex gap-1">
              {canDraft && detail.status === "active" && (
                <Btn onClick={() => openEditor(detail)}>Revise</Btn>
              )}
              <Btn onClick={() => setDetail(null)}>Close</Btn>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {detail.revisions.map((r) => (
              <div
                key={r.id}
                className={cn(
                  "rounded-lg border p-2",
                  r.id === detail.current_revision_id
                    ? "border-foreground/30 bg-surface-alt"
                    : "border-hairline",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div>
                    <span className="font-medium text-foreground">
                      Revision {r.revision_number}
                    </span>
                    {r.id === detail.current_revision_id && (
                      <span className="ml-1 rounded-full bg-foreground px-1.5 py-0.5 text-[10px] text-background">
                        current
                      </span>
                    )}
                    {r.source === "ai_draft" && (
                      <span className="ml-1 inline-flex items-center gap-0.5 rounded-full border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
                        <Sparkles className="h-2.5 w-2.5" /> AI-drafted, human-accepted
                      </span>
                    )}
                    <span className="ml-2 text-muted-foreground">
                      {r.subject.slice(0, 60)} · {new Date(r.created_at).toLocaleString()} ·{" "}
                      {r.created_by_email ?? "—"} · {r.source}
                    </span>
                  </div>
                  <div className="flex gap-1">
                    {(detail.usage.by_revision[String(r.revision_number)] ?? 0) > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        pinned by {detail.usage.by_revision[String(r.revision_number)]} use(s)
                      </span>
                    )}
                    {canDraft && detail.status === "active" && (
                      <>
                        <Btn
                          onClick={() =>
                            setUseBroadcast({
                              revisionId: r.id,
                              revisionNumber: r.revision_number,
                              templateName: detail.name,
                            })
                          }
                        >
                          <Send className="h-3 w-3" /> Use in Broadcast
                        </Btn>
                        <Btn
                          onClick={() =>
                            setUseSequence({
                              revisionId: r.id,
                              revisionNumber: r.revision_number,
                              templateName: detail.name,
                            })
                          }
                        >
                          <ListChecks className="h-3 w-3" /> Use in Sequence
                        </Btn>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* guided editor */}
      {editorOpen && (
        <div className="rounded-xl border border-hairline bg-white p-4">
          <div className="text-sm font-semibold text-foreground">
            {editing ? `Revise “${editing.name}”` : "New template"}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            One safe content model: plain text, {"{{token}}"} personalisation ( first_name,
            last_name, display_name, company_name) with explicit fallbacks, and [label](https://…)
            links. Saving a revision never changes campaigns pinned to earlier revisions.
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Field label="Name">
              <input
                className={inputCls}
                maxLength={120}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="Description" hint="optional">
              <input
                className={inputCls}
                maxLength={500}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </Field>
            <Field label="Subject">
              <input
                className={inputCls}
                maxLength={300}
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
              />
            </Field>
            <Field label="Preview text" hint="optional preheader, max 150">
              <input
                className={inputCls}
                maxLength={150}
                value={form.preview_text}
                onChange={(e) => setForm({ ...form, preview_text: e.target.value })}
              />
            </Field>
          </div>
          <div className="mt-3">
            <Field
              label="Body"
              hint="plain text · {{first_name}} etc · [label](https://destination) links"
            >
              <textarea
                className={cn(inputCls, "min-h-[180px] font-mono text-xs")}
                maxLength={20000}
                value={form.body_authored}
                onChange={(e) => setForm({ ...form, body_authored: e.target.value })}
              />
            </Field>
          </div>
          {tokens.length > 0 && (
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {tokens.map((t) => (
                <Field
                  key={t}
                  label={`Fallback for {{${t}}}`}
                  hint="used when the value is missing"
                >
                  <input
                    className={inputCls}
                    maxLength={200}
                    value={form.token_fallbacks[t] ?? ""}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        token_fallbacks: { ...form.token_fallbacks, [t]: e.target.value },
                      })
                    }
                  />
                </Field>
              ))}
            </div>
          )}
          {saveError && <div className="mt-2 text-xs text-destructive">{saveError}</div>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Btn onClick={() => void runPreviewAndQuality()} busy={checking}>
              <Eye className="h-3 w-3" /> Preview + quality guidance
            </Btn>
            <div className="grow" />
            <Btn onClick={() => setEditorOpen(false)}>Cancel</Btn>
            <Btn
              tone="primary"
              busy={saving}
              disabled={!form.name || !form.subject || !form.body_authored}
              onClick={() => void save()}
            >
              {editing ? "Save as new revision" : "Create template"}
            </Btn>
          </div>

          {quality && (
            <div className="mt-3 rounded-lg border border-hairline bg-surface-alt p-3">
              <div className="text-xs font-semibold text-foreground">
                Editorial guidance{" "}
                <span className="ml-1 rounded-full border border-hairline bg-white px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  deterministic · advisory · not AI
                </span>
              </div>
              {quality.findings.length === 0 ? (
                <div className="mt-1 text-xs text-muted-foreground">
                  No suggestions — the canonical validator still has the final technical say.
                </div>
              ) : (
                <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                  {quality.findings.map((f) => (
                    <li key={f.code}>• {f.message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {preview && (
            <div className="mt-3 rounded-lg border border-hairline p-3">
              <div className="text-xs font-semibold text-foreground">Preview (sample data)</div>
              <div className="mt-1 text-[11px] text-muted-foreground">{preview.note}</div>
              <div className="mt-2 rounded border border-hairline bg-surface-alt p-2 text-xs">
                <div className="font-medium text-foreground">{preview.subject}</div>
                {preview.preview_text && (
                  <div className="text-muted-foreground">{preview.preview_text}</div>
                )}
              </div>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded border border-hairline bg-white p-2 text-[11px] text-foreground">
                {preview.text}
              </pre>
            </div>
          )}
        </div>
      )}

      {useBroadcast && (
        <UseInBroadcastDialog
          {...useBroadcast}
          onClose={() => setUseBroadcast(null)}
          onDone={(m) => setNotice(m)}
        />
      )}
      {useSequence && (
        <UseInSequenceDialog
          {...useSequence}
          onClose={() => setUseSequence(null)}
          onDone={(m) => setNotice(m)}
        />
      )}
    </div>
  );
}
