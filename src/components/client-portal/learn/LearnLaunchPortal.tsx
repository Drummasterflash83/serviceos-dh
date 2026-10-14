import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Mail,
  Phone,
  MessagesSquare,
  Headphones,
  RefreshCw,
  ArrowUpRight,
  ShieldCheck,
  Files,
  Voicemail,
} from "lucide-react";
import { mainNumberStatus } from "@/lib/emma-health";
import { useAuth } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";
import { startGmailOAuth } from "@/lib/api";
import {
  launchSnapshot,
  gmailConsentUrl,
  isCurrentLaunchRequest,
  type LaunchProcessingAttempt,
} from "@/lib/learn-launch";
import "@/styles/learn-launch.css";
import { LearnCards } from "./LearnCards";
import { LearnVoicemails } from "./LearnVoicemails";
import { LearnSlackSetup } from "./LearnSlackSetup";
import { LearnSlackEvidence } from "./LearnSlackEvidence";
import { LearnFileImports } from "./LearnFileImports";
import { LearnCommusoftCustomers } from "./LearnCommusoftCustomers";
import { LearnCommusoftWork } from "./LearnCommusoftWork";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const EmmaLearnRecap = lazy(() => import("./EmmaLearnRecap").then(m => ({default:m.EmmaLearnRecap})));

export function LearnLaunchPortal({ tenantId }: { tenantId: string }) {
  const { user, profile } = useAuth();
  const [result, setResult] = useState<any>(null),
    [state, setState] = useState("loading"),
    [connectState, setConnectState] = useState("idle"),
    [notice, setNotice] = useState("");
  const [recapOpen, setRecapOpen] = useState(false);
  const [slackSetup, setSlackSetup] = useState(false);
  const [slackEvidence, setSlackEvidence] = useState(false);
  const [fileImports, setFileImports] = useState(false);
  const [commusoftReview, setCommusoftReview] = useState(false);
  const [commusoftWork, setCommusoftWork] = useState(false);
  const [cardRevision, setCardRevision] = useState(0);
  const revision = useRef(0),
    scope = useRef("");
  const pendingScope = useRef<{ scope: string; ticket: number } | null>(null);
  scope.current = `${user?.id ?? ""}:${tenantId}`;
  const receptionist = useQuery({
    queryKey: ["workspace-receptionist-summary", user?.id, tenantId],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().from("receptionist_workspaces")
        .select("name,launch_stage").eq("tenant_id", tenantId).maybeSingle();
      if (error) throw Error("Receptionist readiness unavailable");
      return data;
    },
    staleTime: 30_000,
    refetchInterval: 45_000,
  });
  const savedInputs = useQuery({
    queryKey: ["learn-visible-input-totals", user?.id, tenantId],
    enabled: !!user,
    retry: false,
    gcTime: 0,
    refetchInterval: 45_000,
    refetchOnWindowFocus: "always",
    queryFn: async () => {
      // Use the signed-in client's existing RLS, especially private mailbox
      // permissions. The launch metadata views deliberately exclude these tables.
      const read = async (table: "slack_messages" | "receptionist_voicemails") => {
        try {
          const { count, error } = await getSupabaseClient().from(table)
            .select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
          return !error && Number.isSafeInteger(count) && count! >= 0 ? count : null;
        } catch { return null; }
      };
      const [slack, voicemail] = await Promise.all([read("slack_messages"), read("receptionist_voicemails")]);
      return { slack, voicemail, observedAt: Date.now() };
    },
  });
  const canConnect =
    !!user && profile?.tenant_id === tenantId && ["owner", "admin", "ops"].includes(profile.role);
  async function refresh() {
    if (pendingScope.current?.scope === scope.current) return;
    const ticket = ++revision.current,
      selected = scope.current;
    pendingScope.current = { scope: selected, ticket };
    setState("loading");
    try {
      const { data, error } = await getSupabaseClient().functions.invoke("learn-launch-status", {
        body: { tenant_id: tenantId },
      });
      if (!isCurrentLaunchRequest(ticket, selected, revision.current, scope.current)) return;
      const valid = !error && launchSnapshot(data, tenantId, Date.now());
      setResult(valid ? { ...valid, scope: selected } : null);
      setState(valid ? "ready" : "unavailable");
    } catch {
      if (isCurrentLaunchRequest(ticket, selected, revision.current, scope.current)) {
        setResult(null);
        setState("failed");
      }
    } finally {
      if (pendingScope.current?.ticket === ticket) pendingScope.current = null;
    }
  }
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      setResult((old: any) => (old && Date.now() >= Date.parse(old.valid_until) ? null : old));
    }, 1000);
    // The server snapshot expires after one minute. Keep an open showcase
    // current instead of removing its totals until someone manually refreshes.
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 45_000);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      clearInterval(poll);
      pendingScope.current = null;
      document.removeEventListener("visibilitychange", onVisible);
      revision.current++;
    };
  }, [user?.id, tenantId]);
  async function connect() {
    if (!canConnect || connectState === "connecting") return;
    const selected = scope.current,
      ticket = revision.current;
    setConnectState("connecting");
    setNotice("");
    try {
      const response = await startGmailOAuth();
      if (!isCurrentLaunchRequest(ticket, selected, revision.current, scope.current)) return;
      const url = response.ok ? gmailConsentUrl(response.data.auth_url) : null;
      if (!url) {
        setConnectState("failed");
        setNotice(
          "Gmail connection could not start. Please try again or ask OpenFolk to check the connection.",
        );
        return;
      }
      window.location.assign(url);
    } catch {
      if (isCurrentLaunchRequest(ticket, selected, revision.current, scope.current)) {
        setConnectState("failed");
        setNotice("Gmail connection could not start. Please try again.");
      }
    }
  }
  const display = (v: unknown) =>
    typeof v === "number" ? v.toLocaleString("en-GB") : "Not checked";
  const when = (v: unknown) =>
    typeof v === "string" ? new Date(v).toLocaleString("en-GB") : "Not confirmed";
  const attempt = (v: LaunchProcessingAttempt | undefined) => {
    if (!v || v.state === "unknown") return "Status not available";
    if (v.state === "idle") return "No update recorded yet";
    if (v.state === "processing")
      return `Processing · ${display(v.records_processed)} processed so far · started ${when(v.started_at)}`;
    return `${v.state === "success" ? "Update completed" : "Update needs attention"} · ${display(v.records_processed)} processed · completed ${when(v.completed_at)}`;
  };
  const active = result?.scope === scope.current && Date.now() < Date.parse(result.valid_until) ? result : null;
  const visibleInputs = savedInputs.data && Date.now() - savedInputs.data.observedAt < 60_000
    ? savedInputs.data : null;
  return (
    <div className="lr-page">
      <div className="cp-page-heading lr-heading">
        <div>
          <p className="of-eyebrow">STAGE 1 · LEARN</p>
          <h1>Your business, coming into view.</h1>
          <p>Your saved communications, connected systems and next steps.</p>
        </div>
        <button
          className="cp-secondary"
          disabled={state === "loading"}
          onClick={() => { void refresh(); void savedInputs.refetch(); }}
        >
          <RefreshCw size={15} />
          Refresh
        </button>
      </div>
      <section className="cp-card" style={{marginBottom:20}} aria-label="Emma's LEARN recap">
        <div className="lr-section-heading" style={{margin:0}}>
          <div><p className="of-eyebrow">A WORD FROM EMMA</p><h2>Your progress, brought to life.</h2><p>Hear what has arrived and what it could help your business discover.</p></div>
          <button className="cp-secondary" disabled={!user} onClick={()=>setRecapOpen(true)}><Headphones size={17}/> Hear Emma’s recap</button>
        </div>
      </section>
      <Dialog open={recapOpen} onOpenChange={setRecapOpen}>
        <DialogContent className="cp-dialog max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader><DialogTitle>Emma’s LEARN recap</DialogTitle><DialogDescription>A fresh snapshot of saved inputs, in Emma’s current voice. Collection and completed analysis are kept distinct.</DialogDescription></DialogHeader>
          {recapOpen && user && <Suspense fallback={<p role="status">Preparing Emma’s recap…</p>}><EmmaLearnRecap key={`${user.id}:${tenantId}`} tenantId={tenantId} userId={user.id} tester={user.email ?? "You"}/></Suspense>}
        </DialogContent>
      </Dialog>
      {!active && (
        <p role="status" className="lr-notice">
          {state === "loading"
            ? "Checking your saved activity…"
            : "Capture status is not available for this session. You can still review saved cards below. Refresh to try again, or ask OpenFolk to check access."}
        </p>
      )}
      {active && (
        <p role="status" className="lr-notice">
          Saved input totals · checked {when(active.observed_at)}. Updates automatically while this page is open.
        </p>
      )}
        <section className="lr-counts lr-input-overview" aria-label="Your inputs at a glance">
          {[
            { name: "Email", value: active?.counts.email.record_count, Icon: Mail, note: "Emails saved in LEARN", detail: active?.email.last_successful_message_sync_at ? `Latest capture ${when(active.email.last_successful_message_sync_at)}` : "Capture status awaiting confirmation", href: "#learn-communication-sources" },
            { name: "Phone", value: active?.counts.phone.record_count, Icon: Phone, note: "Call records saved in LEARN", detail: active?.phone.last_successful_call_sync_at ? `Latest capture ${when(active.phone.last_successful_call_sync_at)}` : "Capture status awaiting confirmation", href: "#learn-communication-sources" },
            { name: "Voice recordings", value: active?.recordings.record_count, Icon: Files, note: "Recordings saved", detail: "Audio coverage is checked separately", href: "#learn-communication-sources" },
            { name: "Slack", value: visibleInputs?.slack, Icon: MessagesSquare, note: "Slack messages saved in LEARN", detail: "History imports and replies are checked separately", href: null },
            { name: "Voicemail", value: visibleInputs?.voicemail, Icon: Voicemail, note: "Saved messages visible to your account", detail: "Open your private inbox to read and listen", href: `/client?tenant=${encodeURIComponent(tenantId)}&section=receptionist&view=voicemails` },
          ].map((c) => (
            <article className="lr-count" key={c.name}>
              <div className="lr-count-label">
                {c.name}
                <c.Icon size={17} />
              </div>
              <strong className={typeof c.value === "number" ? "" : "lr-unknown"}>
                {display(c.value)}
              </strong>
              <small>{c.note}</small>
              <p className="lr-input-detail">{c.detail}</p>
              {c.href ? <a className="lr-input-link" href={c.href}>View details <ArrowUpRight size={13} /></a> : <button className="lr-input-link" onClick={() => setSlackEvidence(true)}>View Slack evidence <ArrowUpRight size={13} /></button>}
            </article>
          ))}
          <article className="lr-count lr-emma-readiness">
            <div className="lr-count-label">AI {receptionist.data?.name || "Emma"}<Headphones size={17} /></div>
            <strong className="lr-unknown">{receptionist.isPending ? "Checking readiness" : receptionist.isError ? "Check needed" : mainNumberStatus(receptionist.data?.launch_stage)}</strong>
            <small>Recorded launch status · call routing still needs verification</small>
            <a className="lr-input-link" href={`/client?tenant=${encodeURIComponent(tenantId)}&section=receptionist`}>Open AI Receptionist <ArrowUpRight size={13} /></a>
          </article>
        </section>
      <p className="lr-input-caption">These are saved totals, not a claim that every historical message or call has been captured.</p>
      <LearnCards key={cardRevision} tenantId={tenantId} />
      <LearnVoicemails key={`${user?.id}:${tenantId}`} tenantId={tenantId} actorId={user?.id} />
      <section className="cp-card">
        <h2>Customer and job systems</h2>
        <p>
          Review customers retained from your connected business system before linking their cards.
        </p>
        <button className="cp-secondary" onClick={() => setCommusoftReview(true)}>
          Review Commusoft customers
        </button>{" "}
        <button className="cp-secondary" onClick={() => setCommusoftWork(true)}>
          Review Commusoft sites, jobs and contacts
        </button>
      </section>
      <Dialog open={commusoftWork} onOpenChange={setCommusoftWork}>
        <DialogContent
          overlayClassName="z-[90]"
          className="cp-dialog z-[91] max-h-[90vh] overflow-y-auto sm:max-w-4xl"
        >
          <DialogHeader>
            <DialogTitle>Commusoft site, job and contact review</DialogTitle>
            <DialogDescription>
              Review customer relationships and recover saved batches.
            </DialogDescription>
          </DialogHeader>
          {commusoftWork && (
            <LearnCommusoftWork
              onSaved={() => setCardRevision((v) => v + 1)}
              key={`${user?.id}:${tenantId}:${profile?.role}`}
              actorId={user?.id ?? ""}
              tenantId={tenantId}
              canEdit={
                !!user &&
                profile?.tenant_id === tenantId &&
                ["owner", "admin"].includes(profile.role)
              }
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={commusoftReview} onOpenChange={setCommusoftReview}>
        <DialogContent
          overlayClassName="z-[90]"
          className="cp-dialog z-[91] max-h-[90vh] overflow-y-auto sm:max-w-4xl"
        >
          <DialogHeader>
            <DialogTitle>Commusoft customer review</DialogTitle>
            <DialogDescription>
              Inspect retained source details and confirm the appropriate customer identity.
            </DialogDescription>
          </DialogHeader>
          {commusoftReview && (
            <LearnCommusoftCustomers
              onSaved={() => setCardRevision((v) => v + 1)}
              key={`${user?.id}:${tenantId}:${profile?.role}`}
              tenantId={tenantId}
              canEdit={
                !!user &&
                profile?.tenant_id === tenantId &&
                ["owner", "admin"].includes(profile.role)
              }
            />
          )}
        </DialogContent>
      </Dialog>
      <section className="cp-card">
        <h2>Customer, site and job files</h2>
        <p>Review prepared source files and retained import results.</p>
        <button className="cp-secondary" onClick={() => setFileImports(true)}>
          Review file imports
        </button>
      </section>
      <Dialog open={fileImports} onOpenChange={setFileImports}>
        <DialogContent
          overlayClassName="z-[90]"
          className="cp-dialog z-[91] max-h-[90vh] overflow-y-auto sm:max-w-4xl"
        >
          <DialogHeader>
            <DialogTitle>Customer, site and job imports</DialogTitle>
            <DialogDescription>
              Preview a prepared CSV, inspect its mapping and approve the saved import.
            </DialogDescription>
          </DialogHeader>
          {fileImports && (
            <LearnFileImports
              key={`${user?.id}:${tenantId}:${profile?.role}`}
              tenantId={tenantId}
              canEdit={
                !!user &&
                profile?.tenant_id === tenantId &&
                ["owner", "admin"].includes(profile.role)
              }
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={slackEvidence} onOpenChange={setSlackEvidence}>
        <DialogContent overlayClassName="z-[90]" className="cp-dialog z-[91] max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Slack evidence</DialogTitle>
            <DialogDescription>Review saved public channel observations and their retained messages.</DialogDescription>
          </DialogHeader>
          {slackEvidence && user && <LearnSlackEvidence key={`${user.id}:${tenantId}:${profile?.role}`} tenantId={tenantId} actorId={user.id}/>}
        </DialogContent>
      </Dialog>
      <Dialog open={slackSetup} onOpenChange={setSlackSetup}>
        <DialogContent
          overlayClassName="z-[90]"
          className="cp-dialog z-[91] max-h-[90vh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>Slack imports</DialogTitle>
            <DialogDescription>
              Import channel messages and observed thread replies using an existing company
              connection.
            </DialogDescription>
          </DialogHeader>
          {slackSetup && (
            <LearnSlackSetup
              key={`${user?.id}:${tenantId}`}
              tenantId={tenantId}
              actorId={user?.id ?? ""}
              canEdit={
                !!user &&
                profile?.tenant_id === tenantId &&
                ["owner", "admin"].includes(profile.role)
              }
            />
          )}
        </DialogContent>
      </Dialog>
      <div className="lr-section-heading" id="learn-communication-sources">
        <div>
          <h2>Your communication sources</h2>
          <p>Review each connection and its latest recorded activity.</p>
        </div>
      </div>
      <section className="lr-connectors">
        <article className="lr-connector">
          <div className="lr-source-icon slack">
            <MessagesSquare size={21} />
          </div>
          <h3>Slack</h3>
          <p className="lr-scope">Channel messages and replies</p>
          <p className="lr-source-note">
            Open Slack imports to review channel progress and replies. Slack notifications do not
            confirm that conversations have been imported.
          </p>
          <button className="lr-source-action" onClick={() => setSlackEvidence(true)}>
            Browse saved Slack evidence <ArrowUpRight size={15} />
          </button>
          <div className="lr-sync">
            <span>Slack notifications</span>
            <strong>
              {active?.slack.notifications_enabled === true
                ? "Enabled"
                : active?.slack.notifications_enabled === false
                  ? "Disabled"
                  : "Not confirmed"}
            </strong>
          </div>
          <button className="lr-source-action" onClick={() => setSlackSetup(true)}>
            Review Slack imports
            <ArrowUpRight size={15} />
          </button>
        </article>
        <article className="lr-connector">
          <div className="lr-source-icon email">
            <Mail size={21} />
          </div>
          <h3>Email</h3>
          <p className="lr-scope">Gmail / Workspace</p>
          <p className="lr-source-note">
            {active
              ? `${display(active.email.accounts)} accounts · ${display(active.email.selected_mailboxes)} selected mailboxes.`
              : "Connection details are not available. Refresh the status or ask OpenFolk to check access."}
          </p>
          {active && (
            <details className="lr-coverage">
              <summary>Email coverage details</summary>
              <p>
                {display(active.email.disabled_accounts)} accounts disabled ·{" "}
                {display(active.email.mailboxes)} mailboxes discovered.
              </p>
              <p>
                Saved labels: Inbox {display(active.email.stored_label_counts?.inbox)} · Sent{" "}
                {display(active.email.stored_label_counts?.sent)} · Draft{" "}
                {display(active.email.stored_label_counts?.draft)}. A message can have more than one
                label. Full history and changes to drafts are not confirmed.
              </p>
            </details>
          )}
          <div className="lr-sync">
            <span>Latest email update</span>
            <strong>{attempt(active?.email.latest_message_sync_attempt)}</strong>
            {active?.email.latest_message_sync_attempt?.state === "failed" && (
              <strong>
                Ask OpenFolk to review the email connection. Saved messages remain available.
              </strong>
            )}
            <span>Last completed email update</span>
            <strong>{when(active?.email.last_successful_message_sync_at)}</strong>
          </div>
          <button
            className="lr-source-action"
            disabled={!canConnect || connectState === "connecting"}
            onClick={() => void connect()}
          >
            {connectState === "connecting"
              ? "Starting consent…"
              : connectState === "failed"
                ? "Retry Gmail connection"
                : "Connect Gmail"}
            <ArrowUpRight size={15} />
          </button>
        </article>
        <article className="lr-connector">
          <div className="lr-source-icon birchills">
            <Phone size={21} />
          </div>
          <h3>Phone / Birchills</h3>
          <p className="lr-scope">Calls, recordings and transcripts</p>
          <p className="lr-source-note">
            {active
              ? `${display(active.counts.phone.record_count)} calls saved. Coverage across your phone numbers and recording access still need confirmation.`
              : "Call status is not available. You can open your saved communications below."}
          </p>
          {active && (
            <details className="lr-coverage">
              <summary>Transcript coverage details</summary>
              <p>
                {display(active.phone.transcript_status_counts?.completed)} completed ·{" "}
                {display(active.phone.transcript_status_counts?.failed)} need attention ·{" "}
                {display(active.phone.transcript_status_counts?.pending)} waiting ·{" "}
                {display(active.phone.transcript_status_counts?.processing)} processing.
              </p>
              <p>
                These are saved processing results. They do not confirm transcript accuracy or that
                every call was captured.
              </p>
            </details>
          )}
          <div className="lr-sync">
            <span>Latest call update</span>
            <strong>{attempt(active?.phone.latest_call_sync_attempt)}</strong>
            {active?.phone.latest_call_sync_attempt?.state === "failed" && (
              <strong>
                Ask OpenFolk to review the phone connection. Saved calls remain available.
              </strong>
            )}
            <span>Last completed call update</span>
            <strong>{when(active?.phone.last_successful_call_sync_at)}</strong>
          </div>
          <a className="lr-source-action" href="/app#communications">
            Open saved communications
            <ArrowUpRight size={15} />
          </a>
        </article>
        <article className="lr-connector">
          <div className="lr-source-icon emma">
            <Headphones size={21} />
          </div>
          <h3>Emma</h3>
          <p className="lr-scope">Independent AI receptionist</p>
          <p className="lr-source-note">
            Emma is managed separately. Check its workspace for receptionist activity.
          </p>
          <div className="lr-sync">
            <span>Receptionist activity here</span>
            <strong>Unverified</strong>
          </div>
        </article>
      </section>
      <article className="cp-card lr-activity" style={{ marginTop: 24 }}>
        <h2>Recent saved calls</h2>
        <p>
          A call can include several connected legs and recordings. The list below does not confirm
          that the whole conversation was captured.
        </p>
        {active?.phone.recent_calls?.length ? (
          <ul>
            {active.phone.recent_calls.map((c: any) => (
              <li key={c.id}>
                <div>
                  <strong>{when(c.started_at)}</strong>
                  <small>
                    Provider {c.raw_direction ?? "direction unknown"} ·{" "}
                    {display(c.recording_ids?.length)} linked recordings · full audio not confirmed
                  </small>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p>No recent call details are available in this view.</p>
        )}
      </article>
      <section className="lr-bottom">
        <article className="cp-card">
          <h2>Email onboarding</h2>
          <p>
            Connect a Gmail account above and review the permissions on Google’s consent screen.
            Connecting an account does not confirm that its history has been imported.
          </p>
          <p>
            Inbox and Sent are supported by the current import. Draft changes are not supported. Use
            Workspace setup to review your company’s mailboxes; finding a mailbox does not mean it
            has been selected or fully imported.
          </p>
          <a className="cp-secondary" href="/app#settings">
            Open Workspace setup
            <ArrowUpRight size={14} />
          </a>
          {!canConnect && <p>Only your company’s owner, admin or ops user can connect Gmail.</p>}
          {notice && <p role="alert">{notice}</p>}
        </article>
        <article className="cp-card lr-safety">
          <div className="lr-small-heading">
            <ShieldCheck size={18} />
            <h2>Your data, under your control</h2>
          </div>
          <p>
            Your access is limited to the records your account can view. Refreshing this page does
            not change saved communications.{" "}
            {active && (
              <>
                Voicemails saved: {display(visibleInputs?.voicemail)}. Complete voicemail
                history and playable audio still need confirmation.
              </>
            )}
          </p>
          <p>Customer-system records can be reviewed above as they become available.</p>
        </article>
      </section>
    </div>
  );
}
