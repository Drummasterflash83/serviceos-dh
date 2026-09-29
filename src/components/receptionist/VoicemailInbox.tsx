import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Mail, RefreshCw, ShieldCheck, Voicemail } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import {
  emailLabel,
  voicemailDate,
  voicemailDuration,
  type Mailbox,
  type VoicemailMessage,
} from "@/lib/voicemails";
import "./voicemails.css";

// Synthetic, explicitly labelled design preview. No real messages or playback URLs.
const demoMailboxes: Mailbox[] = [
  {
    id: "example",
    display_name: "Example mailbox",
    extension: "100",
    notification_email: "example@example.test",
    email_enabled: true,
    last_synced_at: "2026-09-29T12:00:00Z",
    sync_state: "current",
    message_count: 2,
  },
];
const demoMessages: VoicemailMessage[] = [
  {
    id: "example-1",
    mailbox_id: "example",
    caller_name: "Example caller",
    caller_number: null,
    received_at: "2026-09-29T11:50:00Z",
    duration_seconds: 42,
    transcript: "Example message: Please call me back about arranging a visit. Thank you.",
    email_status: "sent",
    email_evidence_at: "2026-09-29T11:51:00Z",
    email_recipient: "example@example.test",
    recording_available: false,
  },
  {
    id: "example-2",
    mailbox_id: "example",
    caller_name: "Another example caller",
    caller_number: null,
    received_at: "2026-09-28T10:10:00Z",
    duration_seconds: 21,
    transcript: null,
    email_status: "unknown",
    email_evidence_at: null,
    email_recipient: null,
    recording_available: false,
  },
];

export default function VoicemailInbox({
  tenant,
  userId,
  demo = false,
}: {
  tenant: string;
  userId?: string;
  demo?: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const mailboxes = useQuery({
    queryKey: ["receptionist-voicemails", tenant, userId, demo],
    enabled: !!userId && !demo,
    initialData: demo ? demoMailboxes : undefined,
    retry: false,
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().rpc("voicemail_mailbox_summary", {
        p_tenant: tenant,
      });
      if (error) throw error;
      return (data ?? []) as Mailbox[];
    },
  });
  const mailbox = mailboxes.data?.find((m) => m.id === selected);
  const messages = useQuery({
    queryKey: ["receptionist-voicemail-messages", tenant, userId, selected, page, demo],
    enabled: !!userId && !!mailbox && !demo,
    initialData: demo ? { rows: demoMessages, count: demoMessages.length } : undefined,
    retry: false,
    queryFn: async () => {
      const { data, error, count } = await getSupabaseClient()
        .from("receptionist_voicemails")
        .select(
          "id,mailbox_id,caller_number,caller_name,received_at,duration_seconds,transcript,email_status,email_evidence_at,email_recipient,recording_available",
          { count: "exact" },
        )
        .eq("tenant_id", tenant)
        .eq("mailbox_id", selected!)
        .order("received_at", { ascending: false })
        .order("id", { ascending: false })
        .range(page * 20, page * 20 + 19);
      if (error) throw error;
      return { rows: (data ?? []) as VoicemailMessage[], count: count ?? 0 };
    },
  });
  return (
    <div className="vm-inbox">
      <section className="rw-panel vm-intro">
        <div>
          <p className="rw-eyebrow">YOUR TEAM’S MESSAGES</p>
          <h2>Every voicemail, in the right hands.</h2>
          <p>Choose a mailbox to see its saved messages, newest first.</p>
        </div>
        <span className="vm-privacy">
          <ShieldCheck size={18} /> Owners & authorised managers only
        </span>
      </section>
      {demo && (
        <section className="rw-panel">
          <h3>Design preview · example messages only</h3>
          <p>
            Sign in to your workspace to see the mailboxes you can access. No real voicemails appear
            in this demonstration.
          </p>
        </section>
      )}
      {mailboxes.isPending ? (
        <p role="status">Loading your mailboxes…</p>
      ) : mailboxes.isError ? (
        <section className="rw-panel" role="alert">
          <h3>Voicemail access is awaiting setup</h3>
          <p>
            We can’t load your mailboxes yet. OpenFolk needs to verify the Birchills message
            connection and mailbox permissions. This does not mean you have no messages.
          </p>
          <button
            className="rw-btn rw-btn-light"
            disabled={demo || mailboxes.isFetching}
            onClick={() => void mailboxes.refetch()}
          >
            <RefreshCw size={16} /> Check again
          </button>
        </section>
      ) : !mailboxes.data?.length ? (
        <section className="rw-panel">
          <h3>Your mailboxes will appear here</h3>
          <p>
            No mailboxes are linked to your access yet. Ask OpenFolk to connect your mailbox or
            authorise manager access.
          </p>
        </section>
      ) : (
        <>
          <div className="vm-mailboxes" aria-label="Choose a mailbox">
            {mailboxes.data.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`vm-mailbox${selected === m.id ? " is-selected" : ""}`}
                aria-pressed={selected === m.id}
                aria-controls="voicemail-messages"
                onClick={() => {
                  setSelected(m.id);
                  setPage(0);
                }}
              >
                <Voicemail size={22} />
                <span>
                  <strong>{m.display_name}</strong>
                  <span>Extension {m.extension}</span>
                </span>
                <span className="vm-count">
                  <strong>{m.message_count}</strong> saved
                </span>
              </button>
            ))}
          </div>
          <section id="voicemail-messages" className="rw-panel vm-messages" aria-live="polite">
            {!mailbox ? (
              <p>Select a mailbox above to open its messages.</p>
            ) : (
              <>
                <div className="vm-mailbox-heading">
                  <div>
                    <h2>{mailbox.display_name}</h2>
                    <p>Extension {mailbox.extension}</p>
                  </div>
                  <button
                    className="rw-btn rw-btn-light"
                    disabled={demo || messages.isFetching || mailboxes.isFetching}
                    onClick={() => {
                      void messages.refetch();
                      void mailboxes.refetch();
                    }}
                  >
                    <RefreshCw size={16} /> Refresh
                  </button>
                </div>
                <div className="vm-source">
                  <p>
                    <Mail size={16} />{" "}
                    {mailbox.email_enabled === true
                      ? `Email notifications enabled${mailbox.notification_email ? ` · ${mailbox.notification_email}` : ""}`
                      : mailbox.email_enabled === false
                        ? "Email notifications are off"
                        : "Email setup awaiting verification"}
                  </p>
                  <p>
                    {mailbox.last_synced_at
                      ? `Last message sync: ${voicemailDate(mailbox.last_synced_at)}`
                      : "Birchills message sync awaiting connection"}
                    {mailbox.sync_state === "error" ? " · Latest sync needs attention" : ""}
                  </p>
                  <small>
                    Counts cover messages saved in OpenFolk. Notification settings alone do not
                    confirm an email was sent.
                  </small>
                </div>
                {messages.isPending ? (
                  <p role="status">Loading messages…</p>
                ) : messages.isError ? (
                  <p role="alert">Messages could not be loaded. Please try Refresh.</p>
                ) : !messages.data?.rows.length ? (
                  <p>
                    {mailbox.sync_state === "current"
                      ? "No saved messages in this mailbox."
                      : "Messages will appear after the provider connection is verified."}
                  </p>
                ) : (
                  messages.data.rows.map((message) => (
                    <Message key={message.id} message={message} tenant={tenant} />
                  ))
                )}
                {!!messages.data && messages.data.count > 20 && (
                  <div className="vm-pages">
                    <button
                      className="rw-btn rw-btn-light"
                      disabled={page === 0}
                      onClick={() => setPage(page - 1)}
                    >
                      Newer
                    </button>
                    <span>
                      Page {page + 1} of {Math.ceil(messages.data.count / 20)}
                    </span>
                    <button
                      className="rw-btn rw-btn-light"
                      disabled={(page + 1) * 20 >= messages.data.count}
                      onClick={() => setPage(page + 1)}
                    >
                      Older
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Message({ message, tenant }: { message: VoicemailMessage; tenant: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="vm-message" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <span>
          <strong>
            {message.caller_name || message.caller_number || "Caller number withheld"}
          </strong>
          <span>
            {voicemailDate(message.received_at)} · {voicemailDuration(message.duration_seconds)}
          </span>
        </span>
        <span className={`vm-email vm-email-${message.email_status}`}>
          {emailLabel(message.email_status)}
        </span>
        <ChevronDown size={18} />
      </summary>
      {open && (
        <div className="vm-message-content">
          <dl>
            <div>
              <dt>Caller</dt>
              <dd>{message.caller_number || "Number not provided"}</dd>
            </div>
            <div>
              <dt>Email update</dt>
              <dd>
                {emailLabel(message.email_status)}
                {message.email_recipient ? ` · ${message.email_recipient}` : ""}
                {message.email_evidence_at && (
                  <span>Confirmed {voicemailDate(message.email_evidence_at)}</span>
                )}
              </dd>
            </div>
          </dl>
          {message.recording_available ? (
            <Recording tenant={tenant} id={message.id} />
          ) : (
            <p>Recording awaiting provider access.</p>
          )}
          {message.transcript && (
            <section>
              <h3>Message transcript</h3>
              <p className="vm-transcript">{message.transcript}</p>
            </section>
          )}
        </div>
      )}
    </details>
  );
}

function Recording({ tenant, id }: { tenant: string; id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    setBusy(true);
    setError("");
    setUrl(null);
    try {
      const { data, error } = await getSupabaseClient().functions.invoke(
        "receptionist-voicemail-recording",
        { body: { tenantId: tenant, messageId: id } },
      );
      if (error || typeof data?.url !== "string" || !data.url.startsWith("https://")) throw Error();
      setUrl(data.url);
    } catch {
      setError(
        "We couldn’t open this recording. Your access may have changed, or the audio is still being connected. Try again or ask OpenFolk.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="vm-recording">
      <h3>Listen to the voicemail</h3>
      <button className="rw-btn rw-btn-primary" disabled={busy} onClick={() => void load()}>
        {busy ? "Opening…" : url ? "Reload recording" : "Open recording"}
      </button>
      {url && (
        <audio
          controls
          preload="none"
          src={url}
          aria-label="Voicemail recording"
          onError={() =>
            setError("The recording link may have expired. Reload the recording to try again.")
          }
        />
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
