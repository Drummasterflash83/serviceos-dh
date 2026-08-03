/**
 * Senders & Workspace — Marketing Settings section (Phase 4).
 *
 * Truthful sender administration over the marketing-senders Edge Function:
 * discovered Gmail OAuth accounts + Workspace DWD mailboxes, configured sender
 * profiles with connection/scope/health/last-verified truth, explicit
 * confirmations for enabling / default changes / disabling / test sends, and a
 * governed test-send flow that is honest about what it does: a REAL external
 * email when a live provider is connected, submitted through the untouched
 * Automation Engine, where "submitted" means Gmail accepted the request — not
 * that anything was delivered. Gmail exposes no usable capacity value through
 * this connection, and that is said outright rather than charted.
 */
import { useCallback, useEffect, useState } from "react";
import {
  BadgeCheck,
  CheckCircle2,
  Loader2,
  Mail,
  RefreshCw,
  Send,
  ShieldAlert,
  XCircle,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  createResendSender,
  createSender,
  getSendersOverview,
  getTestSendStatus,
  listTestRecipients,
  newTestSendRequestId,
  requestTestSend,
  setDefaultSender,
  setSenderEnabled,
  updateSender,
  verifySender,
  type SendersOverview,
  type SenderProfile,
  type TestDelivery,
  type TestRecipient,
  senderRemediation,
} from "@/lib/marketing/senders";

const inputCls =
  "rounded-lg border border-hairline bg-white px-2 py-2 text-sm outline-none focus:border-accent";
const cardCls = "rounded-xl border border-hairline bg-white p-4";
const btnCls =
  "rounded-lg border border-hairline bg-white px-2.5 py-1.5 text-xs font-medium hover:bg-surface-alt disabled:opacity-50";

function Note({ tone, children }: { tone: "error" | "warn" | "ok"; children: React.ReactNode }) {
  const cls =
    tone === "error"
      ? "border-destructive/30 bg-destructive/5 text-destructive"
      : tone === "warn"
        ? "border-warning/30 bg-warning/5 text-foreground"
        : "border-success/30 bg-success/5 text-foreground";
  return <div className={cn("rounded-lg border px-3 py-2 text-xs", cls)}>{children}</div>;
}

function Pill({ tone, label }: { tone: "ok" | "warn" | "err" | "muted"; label: string }) {
  const cls =
    tone === "ok"
      ? "bg-success/10 text-success"
      : tone === "warn"
        ? "bg-warning/10 text-foreground"
        : tone === "err"
          ? "bg-destructive/10 text-destructive"
          : "bg-surface-alt text-muted-foreground";
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", cls)}>{label}</span>
  );
}

const STATUS_TONE: Record<TestDelivery["status"], "ok" | "warn" | "err" | "muted"> = {
  queued: "muted",
  executing: "warn",
  submitted: "ok",
  failed: "err",
  unknown: "warn",
};

type Confirm =
  | { kind: "enable" | "disable" | "default"; sender: SenderProfile }
  | { kind: "test"; senderId: string }
  | null;

export function SendersSection() {
  const [data, setData] = useState<SendersOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    label: "",
    from_name: "",
    reply_to: "",
    signature_text: "",
  });
  const [recipients, setRecipients] = useState<TestRecipient[]>([]);
  const [deliveries, setDeliveries] = useState<TestDelivery[]>([]);
  const [test, setTest] = useState({
    sender_id: "",
    recipient_profile_id: "",
    subject: "",
    body: "",
  });
  const [testRequestId, setTestRequestId] = useState<string>(newTestSendRequestId());
  const [resendFromName, setResendFromName] = useState<string>("Drummonds");

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await getSendersOverview();
    if (r.ok) {
      setData(r.data);
      if (r.data.can_test) {
        const [rec, st] = await Promise.all([listTestRecipients(), getTestSendStatus(10)]);
        if (rec.ok) setRecipients(rec.data.recipients);
        if (st.ok) setDeliveries(st.data.deliveries);
      }
    } else {
      setError(r.error.message);
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const run = useCallback(
    async (
      op: () => Promise<{ ok: boolean; error?: { code: string; message: string } }>,
      okMsg: string,
    ) => {
      setBusy(true);
      setMsg(null);
      const r = await op();
      if (r.ok) {
        setMsg(okMsg);
        await reload();
      } else if (r.error?.code === "VERSION_CONFLICT") {
        setMsg("This sender changed elsewhere — reloaded.");
        await reload();
      } else {
        setMsg(r.error?.message ?? "The operation failed.");
      }
      setBusy(false);
      setConfirm(null);
    },
    [reload],
  );

  const refreshStatus = useCallback(async () => {
    const st = await getTestSendStatus(10);
    if (st.ok) setDeliveries(st.data.deliveries);
  }, []);

  if (loading) {
    return (
      <section className={cardCls}>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading senders & Workspace…
        </div>
      </section>
    );
  }
  if (error) {
    return (
      <section className={cardCls}>
        <div className="flex items-center justify-between">
          <div className="text-sm">Senders & Workspace failed to load: {error}</div>
          <button className={btnCls} onClick={() => void reload()}>
            Try again
          </button>
        </div>
      </section>
    );
  }
  if (!data) return null;

  const noSources =
    data.sources.gmail_accounts.length === 0 && data.sources.workspace_mailboxes.length === 0;
  const enabledAuthorized = data.senders.filter((s) => s.enabled && s.readiness.ready);

  return (
    <section className={cardCls}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-accent" />
          <div>
            <div className="text-sm font-semibold">Senders & Workspace</div>
            <p className="text-xs text-muted-foreground">
              Authorised Marketing senders over your connected Gmail / Google Workspace mailboxes.
              Sends run only through the governed Automation Engine.
            </p>
          </div>
        </div>
        <button className={btnCls} onClick={() => void reload()} disabled={busy}>
          <RefreshCw className="mr-1 inline h-3 w-3" /> Refresh
        </button>
      </div>

      {msg && (
        <div className="mb-3">
          <Note tone={msg.endsWith("failed.") ? "warn" : "ok"}>{msg}</Note>
        </div>
      )}

      {/* health strip — real evidence, no fabricated charts */}
      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <div className="rounded-lg border border-hairline p-2 text-xs">
          <div className="text-muted-foreground">Configured / enabled</div>
          <div className="tabular text-sm font-semibold">
            {data.health?.senders_configured ?? 0} / {data.health?.senders_enabled ?? 0}
          </div>
        </div>
        <div className="rounded-lg border border-hairline p-2 text-xs">
          <div className="text-muted-foreground">Send capability</div>
          <div className="text-sm font-semibold">
            {data.capability_enabled ? "Enabled (verified sender)" : "Off — no verified sender"}
          </div>
        </div>
        <div className="rounded-lg border border-hairline p-2 text-xs">
          <div className="text-muted-foreground">Provider capacity</div>
          <div className="text-sm font-semibold">Not reported by provider</div>
        </div>
        <div className="rounded-lg border border-hairline p-2 text-xs">
          <div className="text-muted-foreground">Needs review (unknown)</div>
          <div className="tabular text-sm font-semibold">
            {data.health?.unknown_needing_review ?? 0}
          </div>
        </div>
      </div>

      {!data.mode_permits_send && (
        <div className="mb-3">
          <Note tone="warn">
            Operational mode is <b>{data.operational_mode ?? "unknown"}</b>: the platform will
            accept and queue governed test sends, but the Automation Engine withholds irreversible
            external execution in this mode (the intent parks as mode-blocked with its real reason).
            Raising the mode is an explicit operator decision.
          </Note>
        </div>
      )}

      {/* configured senders */}
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Configured senders
      </div>
      {data.senders.length === 0 ? (
        <Note tone="warn">
          No Marketing sender is authorised yet. Authorise one of the discovered mailboxes below —
          nothing can send until a sender is verified and enabled.
        </Note>
      ) : (
        <div className="space-y-2">
          {data.senders.map((s) => {
            const isDefault = data.default_sender_profile_id === s.id;
            return (
              <div key={s.id} className="rounded-lg border border-hairline p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{s.label || s.mailbox_address}</span>
                  <span className="text-xs text-muted-foreground">{s.mailbox_address}</span>
                  <Pill
                    tone="muted"
                    label={
                      s.source_kind === "gmail_oauth"
                        ? "Gmail OAuth"
                        : s.source_kind === "resend"
                          ? "Resend"
                          : "Workspace DWD"
                    }
                  />
                  {isDefault && <Pill tone="ok" label="Default" />}
                  <Pill
                    tone={s.enabled ? "ok" : "muted"}
                    label={s.enabled ? "Enabled" : "Disabled"}
                  />
                  <Pill
                    tone={s.readiness.ready ? "ok" : "err"}
                    label={s.readiness.state.replaceAll("_", " ")}
                  />
                  <Pill
                    tone={
                      s.send_scope_state === "authorized"
                        ? "ok"
                        : s.send_scope_state === "missing"
                          ? "err"
                          : "warn"
                    }
                    label={`gmail.send: ${s.send_scope_state}`}
                  />
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  From name: {s.from_name ?? "—"} · Reply-to: {s.reply_to ?? "—"} · Signature:{" "}
                  {s.signature_text ? "set" : "—"} · Last verified:{" "}
                  {s.last_verified_at ? new Date(s.last_verified_at).toLocaleString() : "never"}
                </div>
                {senderRemediation(s.readiness.state) && (
                  <div className="mt-2">
                    <Note tone="warn">
                      <ShieldAlert className="mr-1 inline h-3 w-3" />
                      {senderRemediation(s.readiness.state)}
                    </Note>
                  </div>
                )}
                {data.can_manage && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      className={btnCls}
                      disabled={busy}
                      onClick={() =>
                        run(() => verifySender(s.id), "Send authorisation re-verified.")
                      }
                    >
                      Verify send authorisation
                    </button>
                    {s.enabled ? (
                      <button
                        className={btnCls}
                        disabled={busy}
                        onClick={() => setConfirm({ kind: "disable", sender: s })}
                      >
                        Disable…
                      </button>
                    ) : (
                      <button
                        className={btnCls}
                        disabled={busy || !s.readiness.ready}
                        onClick={() => setConfirm({ kind: "enable", sender: s })}
                      >
                        Enable…
                      </button>
                    )}
                    {!isDefault && s.enabled && (
                      <button
                        className={btnCls}
                        disabled={busy}
                        onClick={() => setConfirm({ kind: "default", sender: s })}
                      >
                        Set default…
                      </button>
                    )}
                    <button
                      className={btnCls}
                      disabled={busy}
                      onClick={() => {
                        setEditing(editing === s.id ? null : s.id);
                        setEditForm({
                          label: s.label ?? "",
                          from_name: s.from_name ?? "",
                          reply_to: s.reply_to ?? "",
                          signature_text: s.signature_text ?? "",
                        });
                      }}
                    >
                      {editing === s.id ? "Close" : "Edit"}
                    </button>
                  </div>
                )}
                {confirm && "sender" in confirm && confirm.sender.id === s.id && (
                  <div className="mt-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs">
                    {confirm.kind === "enable" && (
                      <p>
                        Enable <b>{s.mailbox_address}</b> as an external Marketing sender? Once a
                        verified sender is enabled, the governed send capability switches on for
                        this tenant.
                      </p>
                    )}
                    {confirm.kind === "disable" && (
                      <p>
                        Disable <b>{s.mailbox_address}</b>? Its history is preserved.{" "}
                        {data.default_sender_profile_id === s.id &&
                          "It is the current default — the default will be cleared."}
                      </p>
                    )}
                    {confirm.kind === "default" && (
                      <p>
                        Make <b>{s.mailbox_address}</b> the default Marketing sender? The change is
                        versioned and audited.
                      </p>
                    )}
                    <div className="mt-2 flex gap-2">
                      <button
                        className={btnCls}
                        disabled={busy}
                        onClick={() =>
                          run(
                            () =>
                              confirm.kind === "default"
                                ? setDefaultSender(s.id, s.updated_at)
                                : setSenderEnabled(s.id, confirm.kind === "enable", s.updated_at),
                            confirm.kind === "enable"
                              ? "Sender enabled."
                              : confirm.kind === "disable"
                                ? "Sender disabled (history preserved)."
                                : "Default sender updated.",
                          )
                        }
                      >
                        Confirm
                      </button>
                      <button className={btnCls} onClick={() => setConfirm(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {editing === s.id && (
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    <input
                      className={inputCls}
                      placeholder="Label"
                      value={editForm.label}
                      onChange={(e) => setEditForm({ ...editForm, label: e.target.value })}
                    />
                    <input
                      className={inputCls}
                      placeholder="From name"
                      value={editForm.from_name}
                      onChange={(e) => setEditForm({ ...editForm, from_name: e.target.value })}
                    />
                    <input
                      className={inputCls}
                      placeholder="Reply-to"
                      value={editForm.reply_to}
                      onChange={(e) => setEditForm({ ...editForm, reply_to: e.target.value })}
                    />
                    <textarea
                      className={cn(inputCls, "md:col-span-2")}
                      rows={2}
                      placeholder="Plain-text signature"
                      value={editForm.signature_text}
                      onChange={(e) => setEditForm({ ...editForm, signature_text: e.target.value })}
                    />
                    <div className="md:col-span-2">
                      <button
                        className={btnCls}
                        disabled={busy}
                        onClick={() =>
                          run(
                            () =>
                              updateSender(
                                s.id,
                                {
                                  label: editForm.label,
                                  from_name: editForm.from_name || null,
                                  reply_to: editForm.reply_to || null,
                                  signature_text: editForm.signature_text || null,
                                } as never,
                                s.updated_at,
                              ),
                            "Sender configuration saved.",
                          )
                        }
                      >
                        Save configuration
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* discovered sources */}
      <div className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Discovered mailboxes
      </div>
      {noSources ? (
        <Note tone="warn">
          No Gmail account or Google Workspace mailbox is connected for this tenant. Connect one in
          Settings → Email operations first — Marketing can only send through a mailbox the platform
          already ingests.
        </Note>
      ) : (
        <div className="space-y-1 text-xs">
          {data.sources.gmail_accounts.map((a) => (
            <div
              key={a.source_id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline px-3 py-2"
            >
              <span className="font-medium">{a.email_address ?? "(no address)"}</span>
              <Pill tone="muted" label="Gmail OAuth" />
              <Pill tone={a.status === "active" ? "ok" : "warn"} label={a.status} />
              {a.scope_known ? (
                a.has_send_scope ? (
                  <Pill tone="ok" label="send scope granted" />
                ) : (
                  <Pill tone="err" label="Re-authorisation required (no gmail.send)" />
                )
              ) : (
                <Pill tone="warn" label="scope unknown" />
              )}
              {a.sender_profile_id ? (
                <Pill tone="ok" label="sender configured" />
              ) : (
                data.can_manage && (
                  <button
                    className={btnCls}
                    disabled={busy || a.status !== "active"}
                    onClick={() =>
                      run(
                        () => createSender({ source_kind: "gmail_oauth", source_id: a.source_id }),
                        "Sender profile created — verify send authorisation next.",
                      )
                    }
                  >
                    Authorise as sender
                  </button>
                )
              )}
            </div>
          ))}
          {data.sources.workspace_mailboxes.map((m) => (
            <div
              key={m.source_id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline px-3 py-2"
            >
              <span className="font-medium">{m.email_address}</span>
              <Pill tone="muted" label="Workspace DWD" />
              <Pill tone={m.status === "active" ? "ok" : "warn"} label={m.status} />
              <Pill
                tone={m.connection_status === "active" ? "ok" : "warn"}
                label={`connection ${m.connection_domain}: ${m.connection_status}`}
              />
              {m.sender_profile_id ? (
                <Pill tone="ok" label="sender configured" />
              ) : (
                data.can_manage && (
                  <button
                    className={btnCls}
                    disabled={busy}
                    onClick={() =>
                      run(
                        () =>
                          createSender({ source_kind: "workspace_dwd", source_id: m.source_id }),
                        "Sender profile created — verify send authorisation next.",
                      )
                    }
                  >
                    Authorise as sender
                  </button>
                )
              )}
            </div>
          ))}
          {data.sources.workspace_connections.map((c) => (
            <div key={c.id} className="text-[11px] text-muted-foreground">
              Workspace connection {c.domain}: {c.status} · verified{" "}
              {c.last_verified_at ? new Date(c.last_verified_at).toLocaleString() : "never"} · DWD
              sending additionally requires the <code>{data.required_send_scope}</code> scope in the
              domain-wide delegation grant.
            </div>
          ))}
        </div>
      )}

      {/* Resend transport sender — a verified from-address, no Google needed */}
      {data.can_manage && (
        <div className="mt-4 rounded-lg border border-hairline p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Add Resend sender
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <input
              className={inputCls}
              value="onboarding@resend.dev"
              readOnly
              aria-label="Resend sandbox from address (test only)"
            />
            <input
              className={inputCls}
              value={resendFromName}
              onChange={(e) => setResendFromName(e.target.value)}
              placeholder="from name"
              aria-label="Resend from name"
            />
          </div>
          <button
            className={`${btnCls} mt-2`}
            disabled={busy}
            onClick={() =>
              run(
                () =>
                  createResendSender({
                    from_address: "onboarding@resend.dev",
                    from_name: resendFromName.trim() || undefined,
                  }),
                "Sandbox test sender created — test-only until a domain is verified.",
              )
            }
          >
            Add Resend sandbox sender (test only)
          </button>
          <p className="mt-1 text-[11px] text-muted-foreground">
            <strong>Sandbox / test only.</strong> Until a domain is verified in Resend, the only
            permitted sender is <code>onboarding@resend.dev</code>, usable for governed test sends
            only — campaigns and sequences are refused. The platform Resend key (
            <code>RESEND_API_KEY</code>) must be configured; without it the sender is shown but
            sending fails closed. The sandbox delivers only to your Resend account’s own address.
          </p>
        </div>
      )}

      {/* governed test send */}
      {data.can_test && (
        <>
          <div className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Governed test send
          </div>
          {enabledAuthorized.length === 0 ? (
            <Note tone="warn">Test sends need at least one enabled, send-verified sender.</Note>
          ) : (
            <div className="rounded-lg border border-hairline p-3">
              <div className="grid gap-2 md:grid-cols-2">
                <select
                  className={inputCls}
                  value={test.sender_id}
                  onChange={(e) => setTest({ ...test, sender_id: e.target.value })}
                >
                  <option value="">Sender…</option>
                  {enabledAuthorized.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label || s.mailbox_address}
                    </option>
                  ))}
                </select>
                <select
                  className={inputCls}
                  value={test.recipient_profile_id}
                  onChange={(e) => setTest({ ...test, recipient_profile_id: e.target.value })}
                >
                  <option value="">Recipient (tenant users only)…</option>
                  {recipients.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.email} ({r.role})
                    </option>
                  ))}
                </select>
                <input
                  className={cn(inputCls, "md:col-span-2")}
                  placeholder="Subject"
                  maxLength={300}
                  value={test.subject}
                  onChange={(e) => setTest({ ...test, subject: e.target.value })}
                />
                <textarea
                  className={cn(inputCls, "md:col-span-2")}
                  rows={3}
                  maxLength={10000}
                  placeholder="Body (plain text)"
                  value={test.body}
                  onChange={(e) => setTest({ ...test, body: e.target.value })}
                />
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                This sends a <b>real external email</b> when a live provider is connected. Success
                means <b>submitted to Gmail</b> — not delivered. The send runs through the governed
                Automation Engine (immutable intent, append-only attempts). Recipients are limited
                to this tenant's own users. No campaign or bulk sending exists yet.
              </p>
              {confirm?.kind === "test" ? (
                <div className="mt-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs">
                  <p>
                    Send the test email from{" "}
                    <b>{enabledAuthorized.find((s) => s.id === test.sender_id)?.mailbox_address}</b>{" "}
                    to <b>{recipients.find((r) => r.id === test.recipient_profile_id)?.email}</b>?
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      className={btnCls}
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          const r = await requestTestSend({
                            sender_id: test.sender_id,
                            recipient_profile_id: test.recipient_profile_id,
                            subject: test.subject.trim(),
                            body_text: test.body,
                            request_id: testRequestId,
                          });
                          if (r.ok) {
                            setTestRequestId(newTestSendRequestId());
                            await refreshStatus();
                          }
                          return r;
                        }, "Test send queued — the engine will report submitted / failed / unknown below.")
                      }
                    >
                      <Send className="mr-1 inline h-3 w-3" /> Confirm send
                    </button>
                    <button className={btnCls} onClick={() => setConfirm(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className={cn(btnCls, "mt-2")}
                  disabled={
                    busy ||
                    !test.sender_id ||
                    !test.recipient_profile_id ||
                    test.subject.trim().length === 0 ||
                    test.body.length === 0
                  }
                  onClick={() => setConfirm({ kind: "test", senderId: test.sender_id })}
                >
                  Send test…
                </button>
              )}
            </div>
          )}

          {deliveries.length > 0 && (
            <div className="mt-3 space-y-1">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Recent test sends
                </div>
                <button className={btnCls} onClick={() => void refreshStatus()}>
                  <RefreshCw className="mr-1 inline h-3 w-3" /> Refresh status
                </button>
              </div>
              {deliveries.map((d) => (
                <div key={d.id} className="rounded-lg border border-hairline px-3 py-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    {d.status === "submitted" ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                    ) : d.status === "failed" ? (
                      <XCircle className="h-3.5 w-3.5 text-destructive" />
                    ) : (
                      <BadgeCheck className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    <span className="font-medium">{d.subject}</span>
                    <span className="text-muted-foreground">→ {d.recipient_email}</span>
                    <Pill tone={STATUS_TONE[d.status]} label={d.status} />
                    {d.failure_class && <Pill tone="err" label={d.failure_class} />}
                    {d.status === "unknown" && (
                      <Pill tone="warn" label="needs review — never auto-resent" />
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {new Date(d.created_at).toLocaleString()}
                    {d.provider_message_id && <> · Gmail id {d.provider_message_id}</>}
                    {d.submitted_at && (
                      <> · submitted {new Date(d.submitted_at).toLocaleString()}</>
                    )}{" "}
                    · intent {d.intent_status ?? "—"} ({d.intent_attempts ?? 0} attempts)
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
