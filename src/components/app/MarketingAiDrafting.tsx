// Marketing AI Drafting (Phase 7) — governed content PROPOSALS only. A
// generation request freezes the brief into an immutable Automation Intent;
// the registered adapter makes ONE provider call; the original AI output is
// immutable forever; humans revise as numbered revisions; acceptance writes a
// DRAFT (template / broadcast / sequence step) and never approves, launches
// or sends. Without a configured provider this surface shows an honest “Not
// connected / Configuration required” state — no fake output ever appears in
// the production data path.

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Loader2,
  PlugZap,
  RefreshCw,
  Sparkles,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  acceptAiProposal,
  cancelAiRequest,
  configureAiProvider,
  getAiProposalDetail,
  getAiProviderState,
  getAiRequestStatus,
  listAiRequests,
  newAiAcceptRequestId,
  newAiRequestId,
  rejectAiRequest,
  requestGeneration,
  reviseAiProposal,
  type AiProposalDetail,
  type AiProviderState,
  type AiRequestListRow,
  type GenerationBriefInput,
} from "@/lib/marketing/aidrafts";
import { searchObjectives, type ObjectiveSearchRow } from "@/lib/marketing/reporting";
import { listCampaigns } from "@/lib/marketing/campaigns";
import { listSequences } from "@/lib/marketing/sequences";
import { getSendersOverview } from "@/lib/marketing/senders";
import { listSegments } from "@/lib/marketing/segments";

/* ── local atoms (file-local by repo convention) ─────────────────────────── */

const inputCls =
  "w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm text-foreground outline-none focus:border-foreground/40";

function Btn({
  children,
  onClick,
  tone = "default",
  disabled,
  busy,
  ariaLabel,
  title,
  pressed,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  tone?: "default" | "primary" | "danger";
  disabled?: boolean;
  busy?: boolean;
  ariaLabel?: string;
  title?: string;
  pressed?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      aria-label={ariaLabel}
      title={title}
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

const STATUS_TONE: Record<string, string> = {
  queued: "bg-surface-alt text-muted-foreground",
  executing: "bg-warning/10 text-warning",
  succeeded: "bg-success/10 text-success",
  failed: "bg-destructive/10 text-destructive",
  unknown: "bg-destructive/10 text-destructive",
  cancelled: "bg-surface-alt text-muted-foreground",
};

/* ── provider configuration (owner/admin) ────────────────────────────────── */

function ProviderPanel({
  state,
  canManage,
  onChanged,
}: {
  state: AiProviderState;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [model, setModel] = useState(state.model ?? "");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    const r = await configureAiProvider({
      ...(model.trim() ? { model: model.trim() } : {}),
      ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
      enabled,
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setApiKey("");
    setOpen(false);
    onChanged();
  };

  return (
    <div
      className={cn(
        "rounded-xl border p-4",
        state.configured ? "border-hairline bg-white" : "border-warning/40 bg-warning/10",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <PlugZap className="h-4 w-4 text-muted-foreground" />
          Model provider
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
              state.configured ? "bg-success/10 text-success" : "bg-warning/20 text-foreground",
            )}
          >
            {state.configured ? "Connected" : "Not connected"}
          </span>
        </div>
        {canManage && <Btn onClick={() => setOpen((v) => !v)}>{open ? "Close" : "Configure"}</Btn>}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {state.configured ? (
          <>
            Provider openai · model <span className="font-medium">{state.model}</span> · prompt{" "}
            {state.prompt_version}. Generation is rate-limited, runs through the governed Automation
            Engine, and only ever produces proposals.
          </>
        ) : (
          <>
            Configuration required: an owner/admin must connect a model provider (model name + API
            key) before drafts can be generated. Nothing on this tab fabricates output while
            unconfigured.
            {!canManage && " Ask an owner/admin to configure it."}
          </>
        )}
      </div>
      {open && canManage && (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Field label="Model" hint="provider model identifier">
            <input
              className={inputCls}
              value={model}
              maxLength={80}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g. gpt-4o-mini"
            />
          </Field>
          <Field
            label="API key"
            hint="stored in the tenant Vault — never shown again, never sent to the browser"
          >
            <input
              className={inputCls}
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={state.secret_ref_present ? "(already stored — enter to replace)" : ""}
              autoComplete="off"
            />
          </Field>
          {error && <div className="text-xs text-destructive md:col-span-2">{error}</div>}
          <div className="flex gap-2 md:col-span-2">
            <Btn tone="primary" busy={busy} onClick={() => void save(true)}>
              Save & enable
            </Btn>
            {state.connector_enabled && (
              <Btn tone="danger" busy={busy} onClick={() => void save(false)}>
                Disable
              </Btn>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── proposal panel (original vs revisions, revise, accept) ──────────────── */

function ProposalPanel({
  proposal,
  onChanged,
  onNotice,
}: {
  proposal: AiProposalDetail;
  onChanged: () => void;
  onNotice: (m: string) => void;
}) {
  const original = proposal;
  const latest = proposal.revisions[0] ?? null;
  const [compare, setCompare] = useState<"original" | "latest">(latest ? "latest" : "original");
  const [editOpen, setEditOpen] = useState(false);
  const [subject, setSubject] = useState(latest?.subject ?? original.subject);
  const [body, setBody] = useState(latest?.body_authored ?? original.body_authored);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [acceptOpen, setAcceptOpen] = useState(false);
  const [dest, setDest] = useState<"template" | "broadcast" | "sequence_step">("template");
  const [templateName, setTemplateName] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [stepKey, setStepKey] = useState("");
  const [name, setName] = useState("");
  const [senderId, setSenderId] = useState("");
  const [segmentId, setSegmentId] = useState("");
  const [senders, setSenders] = useState<{ id: string; label: string }[]>([]);
  const [segments, setSegments] = useState<{ id: string; name: string }[]>([]);
  const [broadcasts, setBroadcasts] = useState<{ id: string; name: string; version: number }[]>([]);
  const [sequences, setSequences] = useState<{ id: string; name: string; version: number }[]>([]);

  useEffect(() => {
    if (!acceptOpen) return;
    (async () => {
      const [sv, sg, cs, sq] = await Promise.all([
        getSendersOverview(),
        listSegments(),
        listCampaigns(50),
        listSequences(50),
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
        setBroadcasts(
          (cs.data.campaigns ?? [])
            .filter((c) => ["draft", "review", "approved"].includes(c.status))
            .map((c) => ({ id: c.id, name: c.name, version: c.version })),
        );
      }
      if (sq.ok) {
        setSequences(
          (sq.data.sequences ?? [])
            .filter((s: { status: string }) =>
              ["draft", "review", "approved", "paused"].includes(s.status),
            )
            .map((s: { id: string; name: string; version: number }) => ({
              id: s.id,
              name: s.name,
              version: s.version,
            })),
        );
      }
    })();
  }, [acceptOpen]);

  const shown = compare === "original" ? original : (latest ?? original);

  const doRevise = async () => {
    setBusy(true);
    setError(null);
    const r = await reviseAiProposal(proposal.id, {
      subject,
      body_authored: body,
      ...(note.trim() ? { change_note: note.trim() } : {}),
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setEditOpen(false);
    onNotice("Human revision recorded — the original AI output is preserved unchanged.");
    onChanged();
  };

  const doAccept = async () => {
    setBusy(true);
    setError(null);
    const target =
      dest === "broadcast"
        ? broadcasts.find((b) => b.id === campaignId)
        : sequences.find((s) => s.id === campaignId);
    const r = await acceptAiProposal({
      proposal_id: proposal.id,
      ...(latest ? { revision_id: latest.id } : {}),
      destination_kind: dest,
      request_id: newAiAcceptRequestId(),
      ...(dest === "template" ? { template_name: templateName } : {}),
      ...(dest === "broadcast" && campaignId
        ? { campaign_id: campaignId, expected_version: target?.version ?? 0 }
        : {}),
      ...(dest === "broadcast" && !campaignId
        ? { name, sender_id: senderId, segment_id: segmentId }
        : {}),
      ...(dest === "sequence_step"
        ? {
            campaign_id: campaignId,
            expected_version: target?.version ?? 0,
            ...(stepKey ? { step_key: stepKey } : { append_step: true }),
          }
        : {}),
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    setAcceptOpen(false);
    onNotice(
      "Accepted into a DRAFT. Acceptance never approves, launches or sends — the normal review and approval path still applies, and any prior approval on the destination is invalidated.",
    );
    onChanged();
  };

  return (
    <div className="space-y-3 rounded-xl border border-hairline bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Sparkles className="h-4 w-4 text-accent" />
          AI proposal
          <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
            AI-generated content
          </span>
        </div>
        <div className="text-[11px] text-muted-foreground">
          {proposal.provider} · {proposal.model} · prompt {proposal.prompt_version}
          {proposal.prompt_tokens !== null &&
            ` · ${proposal.prompt_tokens}+${proposal.completion_tokens ?? 0} tokens`}
        </div>
      </div>

      <div className="flex gap-1 text-xs">
        <Btn
          tone={compare === "original" ? "primary" : "default"}
          pressed={compare === "original"}
          onClick={() => setCompare("original")}
        >
          Original (immutable)
        </Btn>
        <Btn
          tone={compare === "latest" ? "primary" : "default"}
          pressed={compare === "latest"}
          disabled={!latest}
          onClick={() => setCompare("latest")}
        >
          {latest ? `Human revision ${latest.revision_number}` : "No human revision yet"}
        </Btn>
      </div>

      <div className="rounded-lg border border-hairline bg-surface-alt p-3 text-xs">
        <div className="font-medium text-foreground">{shown.subject}</div>
        {shown.preview_text && <div className="text-muted-foreground">{shown.preview_text}</div>}
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap bg-transparent font-sans text-foreground">
          {shown.body_authored}
        </pre>
        {compare === "latest" && latest && (
          <div className="mt-2 text-[11px] text-muted-foreground">
            Edited by {latest.editor_email ?? "—"} at {new Date(latest.created_at).toLocaleString()}
            {latest.change_note && ` — ${latest.change_note}`}
          </div>
        )}
      </div>

      {proposal.revisions.length > 0 && (
        <div className="text-[11px] text-muted-foreground">
          {proposal.revisions.length} human revision{proposal.revisions.length === 1 ? "" : "s"} —
          every edit is recorded with its editor; the original is never overwritten.
        </div>
      )}
      {(proposal.accepted_into.template_revisions.length > 0 ||
        proposal.accepted_into.campaign_revisions.length > 0 ||
        proposal.accepted_into.sequence_steps.length > 0) && (
        <div className="flex items-center gap-1 text-[11px] text-success">
          <CheckCircle2 className="h-3 w-3" /> Accepted into{" "}
          {proposal.accepted_into.template_revisions.length +
            proposal.accepted_into.campaign_revisions.length +
            proposal.accepted_into.sequence_steps.length}{" "}
          draft destination(s).
        </div>
      )}

      {error && <div className="text-xs text-destructive">{error}</div>}
      <div className="flex flex-wrap gap-2">
        <Btn onClick={() => setEditOpen((v) => !v)}>
          {editOpen ? "Close editor" : "Edit as human revision"}
        </Btn>
        <Btn tone="primary" onClick={() => setAcceptOpen((v) => !v)}>
          Accept into a draft…
        </Btn>
      </div>

      {editOpen && (
        <div className="space-y-2 rounded-lg border border-hairline p-3">
          <Field label="Subject">
            <input
              className={inputCls}
              maxLength={300}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </Field>
          <Field label="Body">
            <textarea
              className={cn(inputCls, "min-h-[160px] font-mono text-xs")}
              maxLength={20000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>
          <Field label="Change note" hint="optional">
            <input
              className={inputCls}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <Btn tone="primary" busy={busy} onClick={() => void doRevise()}>
            Save human revision
          </Btn>
        </div>
      )}

      {acceptOpen && (
        <div className="space-y-3 rounded-lg border border-hairline p-3">
          <div className="text-xs text-muted-foreground">
            Acceptance writes a <span className="font-medium text-foreground">draft</span> using{" "}
            {latest ? `human revision ${latest.revision_number}` : "the original AI output"} — it
            cannot approve, launch or send anything.
          </div>
          <div className="flex gap-1">
            {(["template", "broadcast", "sequence_step"] as const).map((d) => (
              <Btn key={d} tone={dest === d ? "primary" : "default"} onClick={() => setDest(d)}>
                {d === "template" ? "Template" : d === "broadcast" ? "Broadcast" : "Sequence step"}
              </Btn>
            ))}
          </div>
          {dest === "template" && (
            <Field label="New template name">
              <input
                className={inputCls}
                maxLength={120}
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
              />
            </Field>
          )}
          {dest === "broadcast" && (
            <>
              <Field label="Existing broadcast draft" hint="or leave empty to create a new one">
                <select
                  className={inputCls}
                  value={campaignId}
                  onChange={(e) => setCampaignId(e.target.value)}
                >
                  <option value="">(create a new draft)</option>
                  {broadcasts.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </Field>
              {!campaignId && (
                <div className="grid gap-2 md:grid-cols-3">
                  <Field label="Name">
                    <input
                      className={inputCls}
                      maxLength={120}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </Field>
                  <Field label="Sender">
                    <select
                      className={inputCls}
                      value={senderId}
                      onChange={(e) => setSenderId(e.target.value)}
                    >
                      <option value="">Choose…</option>
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
                      <option value="">Choose…</option>
                      {segments.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              )}
            </>
          )}
          {dest === "sequence_step" && (
            <>
              <Field label="Sequence" hint="an active sequence must be paused first">
                <select
                  className={inputCls}
                  value={campaignId}
                  onChange={(e) => setCampaignId(e.target.value)}
                >
                  <option value="">Choose…</option>
                  {sequences.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Step key to replace" hint="leave empty to append a new email step">
                <input
                  className={inputCls}
                  maxLength={40}
                  value={stepKey}
                  onChange={(e) => setStepKey(e.target.value)}
                />
              </Field>
            </>
          )}
          <Btn
            tone="primary"
            busy={busy}
            disabled={
              (dest === "template" && !templateName) ||
              (dest === "broadcast" && !campaignId && (!name || !senderId || !segmentId)) ||
              (dest === "sequence_step" && !campaignId)
            }
            onClick={() => void doAccept()}
          >
            Accept into draft
          </Btn>
        </div>
      )}
    </div>
  );
}

/* ── main ────────────────────────────────────────────────────────────────── */

export function MarketingAiDrafting({
  canDraft,
  canManageProvider,
}: {
  canDraft: boolean;
  canManageProvider: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [state, setState] = useState<AiProviderState | null>(null);
  const [requests, setRequests] = useState<AiRequestListRow[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [requestId, setRequestId] = useState(newAiRequestId());
  const [brief, setBrief] = useState<Omit<GenerationBriefInput, "request_id">>({
    destination_kind: "template",
    campaign_objective: "",
    offer: "",
    audience: "",
    call_to_action: "",
  });
  const [objectiveOptions, setObjectiveOptions] = useState<ObjectiveSearchRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [proposal, setProposal] = useState<AiProposalDetail | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [st, rq] = await Promise.all([getAiProviderState(), listAiRequests(20)]);
    setLoading(false);
    if (!st.ok) {
      // permission denial is its OWN state — never a retryable failure and
      // never conflated with Not connected / Configuration required
      if (st.error.code === "FORBIDDEN") {
        setForbidden(true);
        return;
      }
      setError(st.error.message);
      return;
    }
    setForbidden(false);
    setState(st.data);
    if (rq.ok) setRequests(rq.data.requests ?? []);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!formOpen) return;
    (async () => {
      const r = await searchObjectives(undefined, 20);
      if (r.ok) setObjectiveOptions(r.data.objectives ?? []);
    })();
  }, [formOpen]);

  // an EDITED brief is a DIFFERENT logical request: rotate the request id so
  // a resubmit after a failure can never collide (REQUEST_MISMATCH) with —
  // or converge onto — a previously-submitted brief. An unchanged retry
  // keeps its id and converges idempotently on the server.
  useEffect(() => {
    setRequestId(newAiRequestId());
  }, [brief]);

  // bounded polling while any request is queued/executing (30s cap handled by
  // the effect re-running only while such requests exist)
  useEffect(() => {
    if (!requests.some((r) => r.status === "queued" || r.status === "executing")) return;
    const t = setTimeout(() => {
      void reload();
    }, 5000);
    return () => clearTimeout(t);
  }, [requests, reload]);

  const submit = async () => {
    setSubmitting(true);
    setFormError(null);
    const r = await requestGeneration({ ...brief, request_id: requestId });
    setSubmitting(false);
    if (!r.ok) {
      setFormError(
        r.error.code === "CONFIG_REQUIRED"
          ? "AI drafting is not configured — an owner/admin must connect a model provider first."
          : r.error.message,
      );
      // an unchanged retry reuses the SAME id (idempotent convergence); any
      // brief edit rotates it via the effect above
      return;
    }
    setFormOpen(false);
    setRequestId(newAiRequestId());
    setNotice(
      "Generation requested. It executes through the governed Automation Engine — in operational modes that withhold external execution the request stays queued with its real reason.",
    );
    void reload();
  };

  const openProposal = async (proposalId: string) => {
    const r = await getAiProposalDetail(proposalId);
    if (r.ok) setProposal(r.data);
    else setNotice(r.error.message);
  };

  if (loading && !state && !forbidden) {
    return (
      <div
        role="status"
        className="grid min-h-[30vh] place-items-center text-sm text-muted-foreground"
      >
        <span className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading AI drafting…
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
  if (error && !state) return <ErrorNote message={error} onRetry={() => void reload()} />;
  if (!state) return null;

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

      <ProviderPanel state={state} canManage={canManageProvider} onChanged={() => void reload()} />

      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          Every generation is rate-limited, recorded with model/prompt provenance, and produces an
          immutable proposal that a person must review. Acceptance creates drafts only.
        </div>
        {canDraft && (
          <Btn tone="primary" disabled={!state.configured} onClick={() => setFormOpen((v) => !v)}>
            <Bot className="h-3 w-3" /> New draft request
          </Btn>
        )}
      </div>

      {formOpen && state.configured && (
        <div className="space-y-3 rounded-xl border border-hairline bg-white p-4">
          <div className="text-sm font-semibold text-foreground">Generation brief</div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Campaign objective" hint="required">
              <textarea
                className={cn(inputCls, "min-h-[52px]")}
                maxLength={500}
                value={brief.campaign_objective}
                onChange={(e) => setBrief({ ...brief, campaign_objective: e.target.value })}
              />
            </Field>
            <Field label="Offer / service" hint="required">
              <textarea
                className={cn(inputCls, "min-h-[52px]")}
                maxLength={500}
                value={brief.offer}
                onChange={(e) => setBrief({ ...brief, offer: e.target.value })}
              />
            </Field>
            <Field label="Audience" hint="required — describe them, never paste a recipient list">
              <textarea
                className={cn(inputCls, "min-h-[52px]")}
                maxLength={500}
                value={brief.audience}
                onChange={(e) => setBrief({ ...brief, audience: e.target.value })}
              />
            </Field>
            <Field label="Why they should care" hint="optional">
              <textarea
                className={cn(inputCls, "min-h-[52px]")}
                maxLength={500}
                value={brief.why_care ?? ""}
                onChange={(e) => setBrief({ ...brief, why_care: e.target.value || undefined })}
              />
            </Field>
            <Field label="Main objection" hint="optional">
              <input
                className={inputCls}
                maxLength={500}
                value={brief.objection ?? ""}
                onChange={(e) => setBrief({ ...brief, objection: e.target.value || undefined })}
              />
            </Field>
            <Field label="Tone / brand guidance" hint="optional">
              <input
                className={inputCls}
                maxLength={300}
                value={brief.tone ?? ""}
                onChange={(e) => setBrief({ ...brief, tone: e.target.value || undefined })}
              />
            </Field>
            <Field label="Sender context" hint="optional — e.g. “the owner writing personally”">
              <input
                className={inputCls}
                maxLength={300}
                value={brief.sender_context ?? ""}
                onChange={(e) =>
                  setBrief({ ...brief, sender_context: e.target.value || undefined })
                }
              />
            </Field>
            <Field label="Desired call to action" hint="required">
              <input
                className={inputCls}
                maxLength={300}
                value={brief.call_to_action}
                onChange={(e) => setBrief({ ...brief, call_to_action: e.target.value })}
              />
            </Field>
            <Field
              label="Linked objective"
              hint="optional — only its title is shared with the model"
            >
              <select
                className={inputCls}
                value={brief.objective_id ?? ""}
                onChange={(e) => setBrief({ ...brief, objective_id: e.target.value || undefined })}
              >
                <option value="">(none)</option>
                {objectiveOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Intended destination" hint="advisory — acceptance decides for real">
              <select
                className={inputCls}
                value={brief.destination_kind}
                onChange={(e) =>
                  setBrief({
                    ...brief,
                    destination_kind: e.target.value as GenerationBriefInput["destination_kind"],
                  })
                }
              >
                <option value="template">Template draft</option>
                <option value="broadcast">Broadcast draft</option>
                <option value="sequence_step">Sequence email step</option>
              </select>
            </Field>
          </div>
          {formError && <div className="text-xs text-destructive">{formError}</div>}
          <div className="flex justify-end gap-2">
            <Btn onClick={() => setFormOpen(false)}>Cancel</Btn>
            <Btn
              tone="primary"
              busy={submitting}
              disabled={
                !brief.campaign_objective.trim() ||
                !brief.offer.trim() ||
                !brief.audience.trim() ||
                !brief.call_to_action.trim()
              }
              onClick={() => void submit()}
            >
              <Sparkles className="h-3 w-3" /> Request draft
            </Btn>
          </div>
        </div>
      )}

      {requests.length === 0 ? (
        <div className="rounded-xl border border-dashed border-hairline bg-white p-8 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-surface-alt">
            <Bot className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="mt-2 text-sm font-medium text-foreground">No draft requests yet</div>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            {state.configured
              ? "Describe what you want to say and to whom — the model proposes a draft that a person reviews, edits and accepts."
              : "Connect a model provider to enable AI drafting. No content is ever generated or faked while unconfigured."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-hairline bg-white">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-hairline text-muted-foreground">
                <th className="px-3 py-2 font-medium">Requested</th>
                <th className="px-3 py-2 font-medium">Brief</th>
                <th className="px-3 py-2 font-medium">Destination</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">By</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.ai_request_id} className="border-b border-hairline/60 last:border-0">
                  <td className="px-3 py-2 text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="max-w-xs truncate px-3 py-2 text-foreground">
                    {r.campaign_objective}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{r.destination_kind}</td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                        STATUS_TONE[r.status] ?? STATUS_TONE.queued,
                      )}
                    >
                      {r.status}
                    </span>
                    {(r.status === "failed" || r.status === "unknown") && r.last_error && (
                      <div
                        className="mt-0.5 max-w-[220px] truncate text-[10px] text-muted-foreground"
                        title={r.last_error}
                      >
                        {r.last_error}
                      </div>
                    )}
                    {r.status === "unknown" && (
                      <div className="mt-0.5 max-w-[220px] text-[10px] text-muted-foreground">
                        Result not confirmed — parked for review; it is never re-billed
                        automatically. Refresh to re-check, or start a new generation.
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{r.actor_email ?? "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      {r.status === "queued" && canDraft && (
                        <Btn
                          onClick={async () => {
                            const res = await cancelAiRequest(r.ai_request_id);
                            if (res.ok) {
                              setNotice("Generation cancelled before execution.");
                              void reload();
                            } else setNotice(res.error.message);
                          }}
                        >
                          <XCircle className="h-3 w-3" /> Cancel
                        </Btn>
                      )}
                      {(r.status === "queued" ||
                        r.status === "executing" ||
                        r.status === "unknown") && (
                        <Btn
                          ariaLabel="Refresh request status"
                          title="Refresh request status"
                          onClick={async () => {
                            const res = await getAiRequestStatus(r.ai_request_id);
                            if (res.ok) void reload();
                          }}
                        >
                          <RefreshCw className="h-3 w-3" />
                        </Btn>
                      )}
                      {r.proposal_id && (
                        <Btn tone="primary" onClick={() => void openProposal(r.proposal_id!)}>
                          View proposal
                        </Btn>
                      )}
                      {r.status === "succeeded" && canDraft && !r.closed_reason && (
                        <Btn
                          onClick={async () => {
                            const res = await rejectAiRequest(r.ai_request_id);
                            if (res.ok) {
                              setNotice(
                                "Proposal rejected — it remains as historical evidence per retention policy.",
                              );
                              void reload();
                            } else setNotice(res.error.message);
                          }}
                        >
                          Reject
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

      {proposal && (
        <ProposalPanel
          proposal={proposal}
          onChanged={() => {
            void openProposal(proposal.id);
            void reload();
          }}
          onNotice={(m) => setNotice(m)}
        />
      )}
    </div>
  );
}
