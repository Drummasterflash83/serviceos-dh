import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ChevronDown, Info, Mail, RefreshCw, ShieldCheck, Voicemail } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import {
  emailLabel,
  voicemailConnectionNotice,
  voicemailCountLabel,
  voicemailDate,
  voicemailDuration,
  type Mailbox,
  type VoicemailMessage,
} from "@/lib/voicemails";
import "./voicemails.css";
import { voicemailTranscriptDisplay } from "@/lib/voicemail-transcript";
import {
  parseVoicemailMailboxPage,
  parseVoicemailMessages,
  VOICEMAIL_MESSAGE_FIELDS,
} from "@/lib/voicemail-reader";

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

type InboxProps = { tenant: string; userId?: string; demo?: boolean };
export default function VoicemailInbox(props: InboxProps) {
  // A changed account/company must discard selection, message details and playback state.
  return (
    <ScopedVoicemailInbox
      key={`${props.tenant}:${props.userId ?? ""}:${!!props.demo}`}
      {...props}
    />
  );
}
function ScopedVoicemailInbox({ tenant, userId, demo = false }: InboxProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const mailboxes = useInfiniteQuery({
    queryKey: ["private-voicemail-mailboxes-v1", tenant, userId, demo],
    enabled: !!userId && !demo,
    initialPageParam: null as string | null,
    initialData: demo
      ? { pages: [{ rows: demoMailboxes, nextAfter: null as string | null }], pageParams: [null] }
      : undefined,
    getNextPageParam: (last) => last.nextAfter,
    retry: false,
    gcTime: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await getSupabaseClient().rpc("learn_voicemail_mailboxes", {
        p_tenant: tenant,
        p_after: pageParam,
      });
      if (error) throw error;
      return parseVoicemailMailboxPage(data, tenant, pageParam);
    },
  });
  const mailboxRows = mailboxes.data?.pages.flatMap((p) => p.rows) ?? [];
  const connectionNotice = voicemailConnectionNotice(mailboxRows);
  const mailbox = mailboxRows.find((m) => m.id === selected);
  const messages = useQuery({
    queryKey: ["receptionist-voicemail-messages", tenant, userId, selected, page, demo],
    enabled: !!userId && !!mailbox && !demo,
    initialData: demo ? { rows: demoMessages, count: demoMessages.length } : undefined,
    retry: false,
    gcTime: 0,
    queryFn: async () => {
      const { data, error, count } = await getSupabaseClient()
        .from("receptionist_voicemails")
        .select(VOICEMAIL_MESSAGE_FIELDS, { count: "exact" })
        .eq("tenant_id", tenant)
        .eq("mailbox_id", selected!)
        .order("received_at", { ascending: false })
        .order("id", { ascending: false })
        .range(page * 20, page * 20 + 19);
      if (error) throw error;
      return parseVoicemailMessages(data, count, tenant, selected!, page);
    },
  });
  return (
    <div className="vm-inbox">
      <section className="rw-panel vm-intro">
        <div>
          <p className="rw-eyebrow">YOUR TEAM’S MESSAGES</p>
          <h2>Your team’s voicemail, kept private.</h2>
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
      {!userId && !demo ? (
        <p role="status">Sign in to see the mailboxes your account can access.</p>
      ) : mailboxes.isPending ? (
        <p role="status">Loading your mailboxes…</p>
      ) : mailboxes.isError ? (
        <section className="rw-panel" role="alert">
          <h3>Mailboxes could not be checked</h3>
          <p>
            Refresh to try again, or ask OpenFolk to check the connection and your mailbox access.
            This does not mean you have no messages.
          </p>
          <button
            className="rw-btn rw-btn-light"
            disabled={demo || mailboxes.isFetching}
            onClick={() => void mailboxes.refetch()}
          >
            <RefreshCw size={16} /> Check again
          </button>
        </section>
      ) : !mailboxRows.length ? (
        <section className="rw-panel">
          <h3>Your mailboxes will appear here</h3>
          <p>
            No mailboxes are linked to your access yet. Ask OpenFolk to connect your mailbox or
            authorise manager access.
          </p>
        </section>
      ) : (
        <>
          {connectionNotice && (
            <section className="rw-panel vm-connection-notice" role="status">
              <Info size={22} aria-hidden="true" />
              <div>
                <h3>{connectionNotice.title}</h3>
                <p>{connectionNotice.detail}</p>
              </div>
            </section>
          )}
          <div className="vm-mailboxes" aria-label="Choose a mailbox">
            {mailboxRows.map((m) => (
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
                  <span>
                    {m.access_scope === "retained_messages"
                      ? "Previous mailbox assignment"
                      : `Extension ${m.extension}`}
                  </span>
                </span>
                <span className="vm-count">
                  <strong>{voicemailCountLabel(m).value}</strong>
                  {voicemailCountLabel(m).label}
                </span>
              </button>
            ))}
          </div>
          {mailboxes.hasNextPage && (
            <button
              className="rw-btn rw-btn-light"
              disabled={mailboxes.isFetching}
              onClick={() => void mailboxes.fetchNextPage()}
            >
              {mailboxes.isFetchingNextPage ? "Loading more mailboxes…" : "Show more mailboxes"}
            </button>
          )}
          <section id="voicemail-messages" className="rw-panel vm-messages" aria-live="polite">
            {!mailbox ? (
              <p>Select a mailbox above to open its messages.</p>
            ) : (
              <>
                <div className="vm-mailbox-heading">
                  <div>
                    <h2>{mailbox.display_name}</h2>
                    <p>
                      {mailbox.access_scope === "retained_messages"
                        ? "Messages retained under your existing access"
                        : `Extension ${mailbox.extension}`}
                    </p>
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
                  {mailbox.access_scope === "retained_messages" ? (
                    <p>
                      You can still read these earlier messages. Current mailbox settings and other
                      people’s messages are not included.
                    </p>
                  ) : (
                    <>
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
                    </>
                  )}
                  <small>
                    Counts cover messages saved in OpenFolk. Notification settings alone do not
                    confirm an email was sent. Saved messages do not establish complete provider
                    history.
                  </small>
                </div>
                {messages.isPending ? (
                  <p role="status">Loading messages…</p>
                ) : messages.isError ? (
                  <p role="alert">Messages could not be loaded. Please try Refresh.</p>
                ) : !messages.data?.rows.length ? (
                  <p>
                    {page > 0
                      ? "No saved messages on this page. Use Newer to return to earlier pages."
                      : mailbox.access_scope === "retained_messages" ||
                          mailbox.sync_state === "current"
                        ? "No saved messages in this mailbox."
                        : "Messages will appear after the provider connection is verified."}
                  </p>
                ) : (
                  messages.data.rows.map((message) => (
                    <Message key={message.id} message={message} tenant={tenant} />
                  ))
                )}
                {!messages.isError && !!messages.data && (messages.data.count > 20 || page > 0) && (
                  <div className="vm-pages">
                    <button
                      className="rw-btn rw-btn-light"
                      disabled={page === 0}
                      onClick={() => setPage(page - 1)}
                    >
                      Newer
                    </button>
                    <span>
                      Page {page + 1} · {messages.data.count} saved messages
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
  const transcript = voicemailTranscriptDisplay(message.transcript);
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
              <p className="vm-transcript">{transcript.text}</p>
              {transcript.providerFooterHidden && (
                <details>
                  <summary>Show full provider text</summary>
                  <p className="vm-transcript">{message.transcript}</p>
                </details>
              )}
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
