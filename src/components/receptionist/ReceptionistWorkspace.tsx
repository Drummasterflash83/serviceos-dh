import { useEffect, useMemo, useState, type FormEvent } from "react";
import { OpenFolkWordmark } from "@/components/OpenFolkWordmark";
import { WorkspaceMenu } from "@/components/WorkspaceMenu";
import { OpenFolkAdminLink } from "@/components/OpenFolkAdminLink";
import { clientWorkspaceHref, selectedWorkspace } from "@/lib/client-workspace-nav";
import { useQuery, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  Phone,
  ArrowUpRight,
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Search,
  RefreshCw,
  Users,
  MessageSquare,
  LayoutDashboard,
  SlidersHorizontal,
  ShieldCheck,
  Clock,
  Check,
  Plus,
  CircleAlert,
  Headphones,
  ChevronRight,
  LogOut,
  Sparkles,
  FileText,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";
import { callerGroups, durationLabel, type ReceptionistCall } from "@/lib/receptionist-data";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import "./receptionist.css";
import { PhonePlanner } from "./PhonePlanner";
import { decodePhonePlan, describePhonePlan } from "@/lib/phone-plan";

type Workspace = {
  tenant_id: string;
  company: string;
  name: string;
  role: string;
  phone_number: string | null;
  launch_stage: string;
  launch_note: string;
  knowledge_version: string | null;
  reviewed_at: string | null;
  build_task_id: string | null;
};
type Feedback = {
  id: string;
  call_id: string | null;
  title: string;
  body: string;
  priority: string;
  category: string;
  status: string;
  response: string;
  version: number;
  created_at: string;
  author_id: string;
};
type Page = {
  connection: string;
  calls: ReceptionistCall[];
  nextCursor: string | null;
  checkedAt: string;
};
type View = "today" | "calls" | "callers" | "improvements" | "details" | "phones";
const views = [
  { id: "today", label: "Your daily view", Icon: LayoutDashboard },
  { id: "calls", label: "Call journal", Icon: Phone },
  { id: "callers", label: "People who called", Icon: Users },
  { id: "phones", label: "Phones & call groups", Icon: Phone },
  { id: "improvements", label: "Make Emma better", Icon: Sparkles },
  { id: "details", label: "Receptionist details", Icon: SlidersHorizontal },
] as const;
const stages = ["New", "Reviewing", "In progress", "Ready to test", "Resolved"];
const date = (s: string) =>
  new Date(s).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
const time = (s: string) =>
  new Date(s).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
const demoWorkspace: Workspace = {
  tenant_id: "demo",
  company: "Drummonds",
  name: "Emma",
  role: "AI receptionist",
  phone_number: "+44 7426 924154",
  launch_stage: "Testing",
  launch_note: "Isolated test number. Main-number cutover remains a separate launch step.",
  knowledge_version: "Launch candidate · verify with Vapi",
  reviewed_at: null,
  build_task_id: null,
};
function exampleCalls(): ReceptionistCall[] {
  return [
    [
      "Example caller A",
      "+44 7700 900101",
      "Boiler service enquiry",
      "The caller asked about an annual service. Emma offered the scheduling team.",
      "customer-ended-call",
      "true",
      "positive",
    ],
    [
      "Example caller B",
      "+44 7700 900102",
      "A handover to review",
      "The transfer did not complete. Review the fallback and confirm that the caller was followed up.",
      "call.in-progress.error-transfer",
      "false",
      "frustrated",
    ],
    [
      "Example caller C",
      "+44 7700 900103",
      "A question about an invoice",
      "Emma routed an accounts enquiry. The conversation after transfer is not available.",
      "assistant-forwarded-call",
      "true",
      "neutral",
    ],
    [
      "Example caller A",
      "+44 7700 900101",
      "Appointment follow-up",
      "The caller asked to change an appointment. Emma identified the scheduling request.",
      "assistant-forwarded-call",
      null,
      null,
    ],
  ].map((x, i) => ({
    id: `example-${i}`,
    createdAt: new Date(Date.now() - i * 3600000).toISOString(),
    startedAt: new Date(Date.now() - i * 3600000).toISOString(),
    endedAt: new Date(Date.now() - i * 3600000 + 90000).toISOString(),
    caller: x[0]!,
    number: x[1],
    type: "inboundPhoneCall",
    status: "ended",
    duration: 90 + i * 21,
    cost: null,
    summary: x[3],
    success: x[5],
    sentiment: x[6],
    endedReason: x[4],
    transcript:
      "Illustrative transcript only. Real call transcripts appear here when Vapi is connected.",
    recording: null,
    needsReview: i === 1,
    outputs: [{ name: "Call reason", result: x[2] }],
  }));
}
export function ReceptionistWorkspace({
  demo = false,
  tenantId,
}: {
  demo?: boolean;
  tenantId?: string;
}) {
  const { user, signOut } = useAuth();
  const db = getSupabaseClient();
  const qc = useQueryClient();
  const [view, setView] = useState<View>("today"),
    [selectedTenant, setSelectedTenant] = useState(tenantId ?? ""),
    [search, setSearch] = useState(""),
    [period, setPeriod] = useState("7"),
    [reviewOnly, setReviewOnly] = useState(false),
    [selectedCall, setSelectedCall] = useState<ReceptionistCall | null>(null),
    [composer, setComposer] = useState(false),
    [noteCall, setNoteCall] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [settings, setSettings] = useState(false),
    [compact, setCompact] = useState(false),
    [focus, setFocus] = useState("Start with calls that need a closer look."),
    [editing, setEditing] = useState<Feedback | null>(null);
  const workspaces = useQuery({
    queryKey: ["receptionist-workspaces", user?.id],
    enabled: !!user && !demo,
    queryFn: async () => {
      const { data, error } = await db
        .from("receptionist_workspaces")
        .select(
          "tenant_id,company,name,role,phone_number,launch_stage,launch_note,knowledge_version,reviewed_at,build_task_id",
        )
        .order("company");
      if (error) throw Error("Your receptionist workspace could not be loaded.");
      return data as Workspace[];
    },
  });
  const w = demo ? demoWorkspace : selectedWorkspace(workspaces.data, selectedTenant);
  const tenant = w?.tenant_id;
  const workspaceHref = clientWorkspaceHref(demo ? undefined : selectedTenant || tenant);
  const operator = useQuery({
    queryKey: ["receptionist-operator", user?.id],
    enabled: !!user && !demo,
    queryFn: async () => {
      const { data, error } = await db.rpc("current_user_is_openfolk_operator", {
        required_permission: "platform.controlplane.admin",
      });
      return !error && data === true;
    },
  });
  const callsQuery = useInfiniteQuery({
    queryKey: ["receptionist-calls", user?.id, tenant],
    enabled: !!user && !!tenant && !demo,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await db.functions.invoke("receptionist-calls", {
        body: { tenantId: tenant, before: pageParam },
      });
      if (error || data?.error)
        throw Error(data?.error ?? "Call data is unavailable. Your saved feedback is still safe.");
      return data as Page;
    },
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    staleTime: 45000,
    refetchInterval: 60000,
  });
  const feedback = useQuery({
    queryKey: ["receptionist-feedback", user?.id, tenant],
    enabled: !!user && !!tenant && !demo,
    queryFn: async () => {
      const { data, error } = await db
        .from("receptionist_feedback")
        .select("*")
        .eq("tenant_id", tenant!)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw Error("Saved feedback could not be loaded.");
      return data as Feedback[];
    },
    refetchInterval: 30000,
  });
  const delivery = useQuery({
    queryKey: ["receptionist-delivery", user?.id, tenant],
    enabled: !!user && !!tenant && !demo,
    queryFn: async () => {
      const { data, error } = await db
        .from("client_notification_outbox")
        .select("source_id,source_version,state")
        .eq("tenant_id", tenant!)
        .eq("source_type", "receptionist_feedback")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw Error("Notification status unavailable");
      return data ?? [];
    },
    refetchInterval: 30000,
  });
  const [examples] = useState(exampleCalls);
  const calls = useMemo(
    () =>
      demo
        ? examples
        : [
            ...new Map(
              (callsQuery.data?.pages.flatMap((p) => p.calls) ?? []).map((c) => [c.id, c]),
            ).values(),
          ],
    [demo, examples, callsQuery.data],
  );
  const notes = demo
    ? [
        {
          id: "example-note",
          call_id: "example-1",
          title: "Check the fallback after a missed transfer",
          body: "Please make the next step clearer when the team cannot answer. This is example feedback for the design preview.",
          priority: "high",
          category: "routing",
          status: "Reviewing",
          response: "",
          version: 1,
          created_at: new Date().toISOString(),
          author_id: "demo",
        },
      ]
    : (feedback.data ?? []);
  const connected = demo || callsQuery.data?.pages[0]?.connection === "connected";
  const visible = calls.filter(
    (c) =>
      (period === "all" || Date.parse(c.createdAt) >= Date.now() - Number(period) * 86400000) &&
      (!reviewOnly || c.needsReview) &&
      `${c.caller} ${c.number ?? ""} ${c.summary ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const open = notes.filter((n) => n.status !== "Resolved"),
    attention = visible.filter((c) => c.needsReview),
    evaluated = visible.filter((c) => c.success === "true" || c.success === "false"),
    passed = evaluated.filter((c) => c.success === "true");
  const groups = callerGroups(visible);
  const loading = !demo && (workspaces.isLoading || callsQuery.isLoading);
  useEffect(() => {
    setSelectedTenant(tenantId ?? "");
  }, [tenantId]);
  useEffect(() => {
    setSelectedCall(null);
    setComposer(false);
    setEditing(null);
    setSearch("");
    setNotice("");
    setError("");
    try {
      const pref = JSON.parse(
        localStorage.getItem(`receptionist-view:${user?.id ?? "demo"}:${tenant}`) ?? "{}",
      );
      setCompact(pref.compact === true);
      setFocus(
        typeof pref.focus === "string" ? pref.focus : "Start with calls that need a closer look.",
      );
    } catch {
      // Invalid browser preferences must not prevent the workspace from loading.
    }
  }, [tenant, user?.id]);
  function saveView() {
    try {
      localStorage.setItem(
        `receptionist-view:${user?.id ?? "demo"}:${tenant}`,
        JSON.stringify({ compact, focus }),
      );
      setSettings(false);
      setNotice("Your daily view is saved on this browser.");
    } catch {
      setError("Your browser could not save this preference.");
    }
  }
  function addNote(callId: string | null = null) {
    setNoteCall(callId);
    setSelectedCall(null);
    setComposer(true);
    setError("");
    setNotice("");
  }
  async function postNote(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || !tenant) return;
    if (demo) {
      setNotice("Design preview only. Feedback is not sent or saved.");
      setComposer(false);
      return;
    }
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const { error } = await db.from("receptionist_feedback").insert({
        tenant_id: tenant,
        call_id: noteCall,
        title: String(form.get("title")).trim(),
        body: String(form.get("body")).trim(),
        category: form.get("category"),
        priority: form.get("priority"),
      });
      if (error) throw Error("Your note was not saved. Please try again.");
      await qc.invalidateQueries({ queryKey: ["receptionist-feedback"] });
      await qc.invalidateQueries({ queryKey: ["receptionist-delivery"] });
      setComposer(false);
      setNotice("Saved to OpenFolk. Slack delivery is shown separately on the note.");
      setView("improvements");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function updateNote(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing || busy) return;
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      const { data, error } = await db
        .from("receptionist_feedback")
        .update({ status: form.get("status"), response: form.get("response") })
        .eq("id", editing.id)
        .eq("version", editing.version)
        .select("id");
      if (error || !data?.length)
        throw Error("This item changed or could not be saved. Refresh it before trying again.");
      await qc.invalidateQueries({ queryKey: ["receptionist-feedback"] });
      setEditing(null);
      setNotice("Improvement updated. The client can see your response.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const noteDelivery = (n: Feedback) => {
    if (demo) return "Example · not sent";
    if (delivery.isError) return "Slack status unavailable";
    const d = delivery.data?.find((x) => x.source_id === n.id && x.source_version === n.version);
    return d?.state === "sent"
      ? "Sent to Slack"
      : d?.state === "failed"
        ? "Slack delivery needs attention"
        : "Saved · Slack delivery pending";
  };
  function CallList({
    items = visible.slice(0, view === "today" ? 5 : visible.length),
  }: {
    items?: ReceptionistCall[];
  }) {
    return items.length ? (
      <div className="rw-call-list">
        {items.map((c) => (
          <button className="rw-call-row" key={c.id} onClick={() => setSelectedCall(c)}>
            <span className={`rw-call-icon ${c.needsReview ? "rw-warn" : ""}`}>
              <Phone size={18} />
            </span>
            <span className="rw-caller">
              <strong>
                {c.caller === "Unidentified caller"
                  ? (c.number ?? "Withheld / unknown number")
                  : c.caller}
              </strong>
              <small>
                {c.caller !== "Unidentified caller"
                  ? (c.number ?? "Number unavailable")
                  : date(c.createdAt)}
              </small>
            </span>
            <span className="rw-call-summary">{c.summary ?? "Call summary not available yet"}</span>
            <span className={`rw-pill ${c.needsReview ? "rw-pill-amber" : ""}`}>
              {c.needsReview ? "Review suggested" : c.status === "ended" ? "Completed" : c.status}
            </span>
            <span className="rw-call-time">
              {time(c.createdAt)}
              <small>{durationLabel(c.duration)}</small>
            </span>
            <ChevronRight size={16} />
          </button>
        ))}
      </div>
    ) : (
      <Empty
        icon={<Phone />}
        title={
          loading
            ? "Loading your call journal…"
            : connected
              ? "No calls in this view"
              : "Your call journal is ready"
        }
        text={
          connected
            ? "Try another time period or clear your search."
            : "Connect Vapi to see real calls, summaries, recordings and assessments here."
        }
      />
    );
  }
  if (!demo && workspaces.isLoading)
    return <div className="rw-loading">Opening your receptionist workspace…</div>;
  if (!w)
    return (
      <div className="rw-loading">
        <h1>Your receptionist workspace</h1>
        <p>
          {workspaces.error?.message ?? "A receptionist has not been assigned to this login yet."}
        </p>
        <a href={workspaceHref}>Back to workspace</a>
      </div>
    );
  return (
    <div className={`rw ${compact ? "rw-compact" : ""}`}>
      <a className="rw-skip" href="#receptionist-main">
        Skip to dashboard
      </a>
      <aside className="rw-sidebar">
        <a href={workspaceHref} className="rw-brand" aria-label="OpenFolk — back to workspace">
          <OpenFolkWordmark onDark />
        </a>
        <WorkspaceMenu
          company={w.company}
          tenant={demo ? undefined : tenant}
          active="receptionist"
        />
        {(workspaces.data?.length ?? 0) > 1 && (
          <select
            aria-label="Company"
            value={tenant}
            onChange={(e) => setSelectedTenant(e.target.value)}
          >
            {workspaces.data?.map((w) => (
              <option key={w.tenant_id} value={w.tenant_id}>
                {w.company}
              </option>
            ))}
          </select>
        )}
        <p className="rw-nav-caption">A WARMER WELCOME</p>
        <nav aria-label="Receptionist workspace">
          <a href={workspaceHref} className="rw-workspace-nav">
            <ArrowLeft size={18} /> Workspace home
          </a>
          {views.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => {
                setView(id);
                setSearch("");
                setReviewOnly(false);
              }}
              className={view === id ? "active" : ""}
              aria-current={view === id ? "page" : undefined}
            >
              <Icon size={18} />
              {id === "improvements" ? `Make ${w.name} better` : label}
              {id === "improvements" && open.length > 0 && <span>{open.length}</span>}
            </button>
          ))}
        </nav>
        <div className="rw-sidebar-card">
          <AudioLines size={28} />
          <strong>
            Small observations.
            <br />
            Better conversations.
          </strong>
          <p>Your feedback helps us improve the next call.</p>
          <button onClick={() => addNote()}>
            Share an observation <ArrowUpRight size={16} />
          </button>
        </div>
        <div className="rw-sidebar-bottom">
          <a href={workspaceHref}>
            <ArrowLeft size={15} /> Back to workspace
          </a>
          <small>
            <ShieldCheck size={14} /> Private client workspace
          </small>
          {!demo && <OpenFolkAdminLink email={user?.email} authorised={operator.data} />}
          {!demo && (
            <button
              onClick={async () => {
                await signOut();
                qc.removeQueries({
                  predicate: (q) => String(q.queryKey[0]).startsWith("receptionist-"),
                });
              }}
            >
              <LogOut size={14} /> Sign out
            </button>
          )}
        </div>
      </aside>
      <div className="rw-shell">
        <header className="rw-topbar">
          <a href={workspaceHref} className="rw-workspace-back">
            <ArrowLeft size={17} /> Back to workspace
          </a>
          <div>
            <span className="rw-user-avatar">{(user?.email ?? "M").slice(0, 1).toUpperCase()}</span>
            <span>{demo ? "Mary’s view · design preview" : user?.email}</span>
          </div>
        </header>
        <main id="receptionist-main" className="rw-main">
          {demo && (
            <div className="rw-banner">
              DESIGN PREVIEW · Illustrative calls, not live customer data. No messages or
              invitations are sent.
            </div>
          )}
          {(error || callsQuery.isError || feedback.isError) && (
            <div role="alert" className="rw-banner rw-error">
              {error || callsQuery.error?.message || feedback.error?.message}
              <button
                onClick={() => {
                  setError("");
                  void callsQuery.refetch();
                  void feedback.refetch();
                }}
              >
                Try again
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="rw-banner">
              {notice}
            </div>
          )}
          <div className="rw-heading">
            <div>
              <p className="rw-eyebrow">
                {view === "today" ? "YOUR DAILY RECEPTIONIST BRIEF" : "THE RECEPTIONIST WORKSPACE"}
              </p>
              <h1>
                {view === "today"
                  ? `A good day starts with ${w.name}.`
                  : view === "improvements"
                    ? `Make ${w.name} better.`
                    : views.find((v) => v.id === view)?.label + "."}
              </h1>
              <p>
                {view === "today"
                  ? "Every conversation, a clearer picture. Here’s what deserves your attention."
                  : view === "calls"
                    ? "A clear record of who called, what happened and what to learn."
                    : view === "callers"
                      ? "Caller history grouped by phone number. Identity is only as reliable as the source."
                      : view === "improvements"
                        ? "From a quick observation to a tested improvement. Keep the conversation here."
                        : view === "phones"
                          ? "Arrange your phone system. OpenFolk handles the provider changes and testing."
                          : "The essentials, the launch stage and the evidence behind the status."}
              </p>
            </div>
            <button className="rw-btn rw-btn-light" onClick={() => setSettings(true)}>
              <SlidersHorizontal size={16} /> Make it yours
            </button>
          </div>
          <div
            className="rw-toolbar"
            hidden={view === "phones"}
            style={view === "phones" ? { display: "none" } : undefined}
          >
            <div className="rw-segment" aria-label="Call period">
              {[
                ["7", "Last 7 days"],
                ["30", "Last 30 days"],
                ["all", "All loaded calls"],
              ].map(([value, label]) => (
                <button
                  aria-pressed={period === value}
                  className={period === value ? "active" : ""}
                  key={value}
                  onClick={() => setPeriod(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              className="rw-refresh"
              disabled={demo || callsQuery.isFetching}
              onClick={() => void callsQuery.refetch()}
            >
              <RefreshCw size={14} className={callsQuery.isFetching ? "rw-spin" : ""} />
              {callsQuery.isFetching
                ? "Refreshing…"
                : connected
                  ? "Refresh calls"
                  : "Check connection"}
            </button>
          </div>
          {view === "today" && (
            <>
              <section className="rw-hero">
                <div className="rw-emma-orb">
                  <Headphones size={48} />
                  <span />
                </div>
                <div className="rw-hero-copy">
                  <div className="rw-hero-label">
                    MEET YOUR RECEPTIONIST <span className="rw-pill">{w.launch_stage}</span>
                  </div>
                  <h2>
                    {w.name}
                    <span>Calm. Clear. Here to help.</span>
                  </h2>
                  <p>{w.launch_note}</p>
                  <button onClick={() => setView("details")}>
                    Receptionist details <ArrowRight size={15} />
                  </button>
                </div>
                <div className="rw-connection">
                  <span className={`rw-dot ${connected ? "on" : ""}`} />
                  <strong>
                    {demo
                      ? "Example connection"
                      : callsQuery.isError
                        ? "Connection needs attention"
                        : connected
                          ? "Vapi data connected"
                          : "Awaiting Vapi connection"}
                  </strong>
                  <small>
                    {connected
                      ? `Last fetched ${time(callsQuery.data?.pages[0]?.checkedAt ?? new Date().toISOString())} · London time`
                      : "Call evidence will appear after connection."}
                  </small>
                  <div className="rw-wave">
                    {[13, 23, 36, 20, 43, 29, 17, 37, 49, 25, 14, 31, 40, 22, 12].map((h, i) => (
                      <i key={i} style={{ height: h }} />
                    ))}
                  </div>
                  <small>Data connection is separate from phone-line health.</small>
                </div>
              </section>
              <section className="rw-metrics" aria-label="Call metrics">
                <Metric
                  label="Calls in this view"
                  value={connected ? String(visible.length) : "—"}
                  detail="Within the loaded call history"
                  icon={<Phone size={17} />}
                />
                <Metric
                  label="Worth a closer look"
                  value={connected ? String(attention.length) : "—"}
                  detail="Provider signals · review suggested"
                  icon={<CircleAlert size={17} />}
                  accent
                />
                <Metric
                  label="Vapi success assessment"
                  value={
                    evaluated.length
                      ? `${Math.round((passed.length / evaluated.length) * 100)}%`
                      : "—"
                  }
                  detail={`${evaluated.length} assessed · not a happiness score`}
                  icon={<Check size={17} />}
                />
                <Metric
                  label="Open improvements"
                  value={feedback.isError ? "—" : String(open.length)}
                  detail="Shared observations and change requests"
                  icon={<Sparkles size={17} />}
                />
              </section>
              <div className="rw-main-grid">
                <section className="rw-panel">
                  <div className="rw-panel-title">
                    <div>
                      <p className="rw-eyebrow">A LITTLE ATTENTION GOES A LONG WAY</p>
                      <h2>Your next best steps</h2>
                    </div>
                    <span className="rw-pill">Daily review</span>
                  </div>
                  <div className="rw-focus">
                    <span>YOUR FOCUS</span>
                    <p>{focus}</p>
                  </div>
                  <button
                    className="rw-next"
                    onClick={() => {
                      setView("calls");
                      setReviewOnly(true);
                    }}
                  >
                    <span className="rw-number">01</span>
                    <div>
                      <strong>Look at calls that need a review</strong>
                      <p>
                        {connected
                          ? `${attention.length} in this view. Read the evidence before deciding.`
                          : "Waiting for call evidence from Vapi."}
                      </p>
                    </div>
                    <ArrowUpRight size={18} />
                  </button>
                  <button className="rw-next" onClick={() => setView("improvements")}>
                    <span className="rw-number">02</span>
                    <div>
                      <strong>Follow the improvements</strong>
                      <p>
                        {open.length} open. See what is being reviewed and what is ready to test.
                      </p>
                    </div>
                    <ArrowUpRight size={18} />
                  </button>
                  <button className="rw-next" onClick={() => addNote()}>
                    <span className="rw-number">03</span>
                    <div>
                      <strong>Tell us what you noticed</strong>
                      <p>A confusing answer, a good handover, an idea worth trying.</p>
                    </div>
                    <ArrowUpRight size={18} />
                  </button>
                </section>
                <section className="rw-note-card">
                  <div className="rw-note-art">
                    <MessageSquare size={38} />
                    <Sparkles size={24} />
                  </div>
                  <p className="rw-eyebrow">BUILT WITH YOUR KNOWLEDGE</p>
                  <h2>
                    You know your callers.
                    <br />
                    Help {w.name} know them too.
                  </h2>
                  <p>
                    Leave a note while it’s fresh. OpenFolk can review it, explain the change and
                    bring it back for testing.
                  </p>
                  <button className="rw-btn" onClick={() => addNote()}>
                    <Plus size={17} /> Add an observation
                  </button>
                  <small>Saved in your workspace. Delivery status stays visible.</small>
                </section>
              </div>
              <section className="rw-panel rw-journal">
                <div className="rw-panel-title">
                  <div>
                    <p className="rw-eyebrow">THE CONVERSATIONS BEHIND THE NUMBERS</p>
                    <h2>Recent calls</h2>
                  </div>
                  <button className="rw-text-btn" onClick={() => setView("calls")}>
                    Open call journal <ArrowRight size={16} />
                  </button>
                </div>
                <CallList />
              </section>
            </>
          )}
          {(view === "calls" || view === "callers") && (
            <>
              <div className="rw-searchbar">
                <label>
                  <Search size={18} />
                  <input
                    aria-label="Search calls"
                    placeholder="Find a caller, number or conversation…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <button
                  className={`rw-btn rw-btn-light ${reviewOnly ? "rw-selected" : ""}`}
                  aria-pressed={reviewOnly}
                  onClick={() => setReviewOnly(!reviewOnly)}
                >
                  <CircleAlert size={16} /> Needs a review
                </button>
              </div>
              <p className="rw-footnote">
                {calls.length} calls loaded.{" "}
                {callsQuery.hasNextPage
                  ? "More history is available below."
                  : "This reflects the records returned by Vapi."}{" "}
                Times shown in London time.
              </p>
              {view === "calls" ? (
                <section className="rw-panel">
                  <CallList items={visible} />
                </section>
              ) : (
                <div className="rw-people-grid">
                  {groups.map((g) => (
                    <section className="rw-panel rw-person" key={g.key}>
                      <div className="rw-person-title">
                        <span className="rw-person-avatar">
                          <Users size={22} />
                        </span>
                        <div>
                          <h2>
                            {g.name === "Unidentified caller"
                              ? "Caller identity unconfirmed"
                              : g.name}
                          </h2>
                          <p>{g.number ?? "Withheld / unknown number"}</p>
                        </div>
                        <span className="rw-pill">{g.calls.length} calls</span>
                      </div>
                      {g.calls.map((c) => (
                        <button
                          className="rw-person-call"
                          key={c.id}
                          onClick={() => setSelectedCall(c)}
                        >
                          <span>
                            {date(c.createdAt)}
                            <small>{c.summary ?? "Summary unavailable"}</small>
                          </span>
                          <ChevronRight size={16} />
                        </button>
                      ))}
                    </section>
                  ))}
                  {!groups.length && (
                    <Empty
                      icon={<Users />}
                      title="Your caller history will live here"
                      text="Callers are grouped by their number. Unknown numbers stay separate."
                    />
                  )}
                </div>
              )}
              {callsQuery.hasNextPage && (
                <button
                  className="rw-btn rw-load"
                  disabled={callsQuery.isFetchingNextPage}
                  onClick={() => void callsQuery.fetchNextPage()}
                >
                  {callsQuery.isFetchingNextPage ? "Loading…" : "Load older calls"}
                </button>
              )}
            </>
          )}
          {view === "improvements" && (
            <>
              <div className="rw-board-intro">
                <p>
                  Your team’s observations and OpenFolk’s responses, in one place.
                  <br />
                  <small>
                    Urgent flags are highlighted here. WhatsApp and phone escalation are not
                    connected yet.
                  </small>
                </p>
                <button className="rw-btn" onClick={() => addNote()}>
                  <Plus size={17} /> Add an observation
                </button>
              </div>
              <div className="rw-stage-track">
                {stages.map((s, i) => (
                  <div key={s}>
                    <span>{i + 1}</span>
                    <strong>{s}</strong>
                    <small>{notes.filter((n) => n.status === s).length} items</small>
                  </div>
                ))}
              </div>
              <div className="rw-feedback-grid">
                {notes.map((n) => (
                  <article
                    key={n.id}
                    className={`rw-panel rw-feedback ${n.priority === "urgent" ? "rw-urgent" : ""}`}
                  >
                    <div className="rw-feedback-top">
                      <span className="rw-pill">{n.status}</span>
                      <span className={`rw-priority ${n.priority}`}>{n.priority} priority</span>
                    </div>
                    <h2>{n.title}</h2>
                    <p className="rw-preserve">
                      {decodePhonePlan(n.body)
                        ? describePhonePlan(decodePhonePlan(n.body)!)
                        : n.body}
                    </p>
                    <div className="rw-feedback-meta">
                      <span>{n.category.replace("-", " ")}</span>
                      <span>{date(n.created_at)}</span>
                    </div>
                    {n.call_id && (
                      <button
                        className="rw-text-btn"
                        onClick={() => {
                          const c = calls.find((c) => c.id === n.call_id);
                          if (c) setSelectedCall(c);
                          else
                            setNotice(
                              "This note relates to an older call. Load older calls in the call journal to open its evidence.",
                            );
                        }}
                      >
                        <Phone size={14} /> Linked call <ArrowUpRight size={14} />
                      </button>
                    )}
                    {n.response && (
                      <div className="rw-response">
                        <strong>OpenFolk’s response</strong>
                        <p className="rw-preserve">{n.response}</p>
                      </div>
                    )}
                    <footer>
                      <small>{noteDelivery(n)}</small>
                      {operator.data && (
                        <button onClick={() => setEditing(n)}>
                          Update <ArrowRight size={14} />
                        </button>
                      )}
                    </footer>
                  </article>
                ))}
                {!notes.length && (
                  <Empty
                    icon={<MessageSquare />}
                    title="The best improvements start with an observation"
                    text="Add a note about a call, a routing change or something Emma handled well."
                  />
                )}
              </div>
              <p className="rw-footnote">
                Showing the latest 200 observations. Feedback does not change Emma’s live
                instructions automatically.
              </p>
            </>
          )}
          {view === "phones" && tenant && <PhonePlanner key={tenant} tenant={tenant} demo={demo} />}
          {view === "details" && (
            <div className="rw-details-grid">
              <section className="rw-panel">
                <div className="rw-panel-title">
                  <h2>{w.name}, at a glance</h2>
                  <Headphones size={25} />
                </div>
                <dl className="rw-facts">
                  {[
                    ["Receptionist", w.name],
                    ["Company", w.company],
                    ["Role", w.role],
                    ["Recorded launch stage", w.launch_stage],
                    ["Configured number", w.phone_number ?? "To confirm"],
                    ["Knowledge / prompt", w.knowledge_version ?? "To verify with Vapi"],
                    [
                      "Configuration reviewed",
                      w.reviewed_at ? date(w.reviewed_at) : "Awaiting live verification",
                    ],
                    ["Call evidence", connected ? "Connected to Vapi" : "Connection pending"],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="rw-footnote">{w.launch_note}</p>
              </section>
              <section className="rw-panel">
                <div className="rw-panel-title">
                  <h2>How we keep improving</h2>
                  <Sparkles size={24} />
                </div>
                <ol className="rw-how">
                  <li>
                    <strong>Notice something</strong>
                    <p>Add a note and link it to a call where possible.</p>
                  </li>
                  <li>
                    <strong>OpenFolk reviews it</strong>
                    <p>We check the evidence, decide what should change and record our response.</p>
                  </li>
                  <li>
                    <strong>Change, test, then release</strong>
                    <p>
                      Knowledge and routing changes are tested before being applied to live calls.
                    </p>
                  </li>
                </ol>
                {operator.data && w.build_task_id && (
                  <a className="rw-btn rw-btn-light" href={`codex://threads/${w.build_task_id}`}>
                    Build AI receptionist KB <ArrowUpRight size={15} />
                  </a>
                )}
                <div className="rw-response">
                  <strong>Notification connections</strong>
                  <p>
                    Feedback is saved in OpenFolk. Each note shows whether Slack delivery is pending
                    or confirmed. Urgent WhatsApp / phone alerts require a configured destination
                    and escalation rule.
                  </p>
                </div>
              </section>
            </div>
          )}
          <footer className="rw-page-footer">
            <span>
              <ShieldCheck size={14} /> Evidence first. Better with every review.
            </span>
            <span>Powered by OpenFolk</span>
          </footer>
        </main>
      </div>
      <Dialog
        open={!!selectedCall}
        onOpenChange={(open) => {
          if (!open) setSelectedCall(null);
        }}
      >
        <DialogContent className="rw-dialog">
          <DialogHeader>
            <DialogTitle>
              {selectedCall?.caller === "Unidentified caller"
                ? (selectedCall.number ?? "Unknown caller")
                : selectedCall?.caller}
            </DialogTitle>
            <DialogDescription>
              {selectedCall &&
                `${date(selectedCall.createdAt)} · ${durationLabel(selectedCall.duration)} · ${selectedCall.type === "inboundPhoneCall" ? "Incoming phone call" : selectedCall.type === "outboundPhoneCall" ? "Outgoing phone call" : "Web call"}`}
            </DialogDescription>
          </DialogHeader>
          {selectedCall && (
            <>
              <div className="rw-detail-badges">
                <span className="rw-pill">{selectedCall.status}</span>
                <span className="rw-pill">
                  {selectedCall.needsReview ? "Review suggested" : "No automatic review flag"}
                </span>
              </div>
              <h3>What happened</h3>
              <p>{selectedCall.summary ?? "Vapi has not provided a summary for this call."}</p>
              <dl className="rw-facts">
                <div>
                  <dt>Vapi success assessment</dt>
                  <dd>
                    {selectedCall.success === "true"
                      ? "Passed"
                      : selectedCall.success === "false"
                        ? "Needs review"
                        : (selectedCall.success ?? "Not assessed")}
                  </dd>
                </div>
                <div>
                  <dt>Caller sentiment · AI estimate</dt>
                  <dd>{selectedCall.sentiment ?? "Not assessed"}</dd>
                </div>
                <div>
                  <dt>Call ended because</dt>
                  <dd>{selectedCall.endedReason ?? "Not supplied"}</dd>
                </div>
                <div>
                  <dt>Vapi call cost</dt>
                  <dd>
                    {selectedCall.cost === null
                      ? "Not supplied"
                      : new Intl.NumberFormat("en-US", {
                          style: "currency",
                          currency: "USD",
                          maximumFractionDigits: 4,
                        }).format(selectedCall.cost)}
                  </dd>
                </div>
              </dl>
              <p className="rw-footnote">
                A transfer or an AI assessment does not establish customer satisfaction. Review the
                conversation and add your own observation.
              </p>
              {selectedCall.recording ? (
                <a
                  className="rw-btn rw-btn-light"
                  href={selectedCall.recording}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Headphones size={16} /> Listen to recording <ArrowUpRight size={15} />
                </a>
              ) : (
                <p className="rw-footnote">Recording not supplied by Vapi.</p>
              )}
              <details className="rw-transcript">
                <summary>
                  <FileText size={16} /> Read transcript
                </summary>
                <p className="rw-preserve">
                  {selectedCall.transcript ?? "Transcript not supplied by Vapi."}
                </p>
              </details>
              {selectedCall.outputs.length > 0 && (
                <details className="rw-transcript">
                  <summary>Vapi structured assessments</summary>
                  {selectedCall.outputs.map((o, i) => (
                    <div key={i}>
                      <strong>{o.name}</strong>
                      <pre>
                        {typeof o.result === "string"
                          ? o.result
                          : JSON.stringify(o.result, null, 2)}
                      </pre>
                    </div>
                  ))}
                </details>
              )}
              <button className="rw-btn" onClick={() => addNote(selectedCall.id)}>
                <MessageSquare size={16} /> Add a note about this call
              </button>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={composer}
        onOpenChange={(o) => {
          if (!busy) setComposer(o);
        }}
      >
        <DialogContent className="rw-dialog">
          <DialogHeader>
            <DialogTitle>What did you notice?</DialogTitle>
            <DialogDescription>
              {noteCall
                ? "Your observation will stay linked to this call."
                : "An idea, a correction or something worth celebrating."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={postNote} className="rw-form">
            <label>
              A short title
              <input
                name="title"
                required
                maxLength={160}
                placeholder="For example: make the handover clearer"
              />
            </label>
            <div className="rw-form-grid">
              <label>
                About
                <select name="category">
                  <option value="improvement">An improvement</option>
                  <option value="routing">Call routing</option>
                  <option value="knowledge">Emma’s knowledge</option>
                  <option value="caller-experience">Caller experience</option>
                  <option value="technical">A technical issue</option>
                  <option value="praise">Something that went well</option>
                </select>
              </label>
              <label>
                Priority
                <select name="priority">
                  <option value="normal">Normal · next review</option>
                  <option value="high">High · needs attention</option>
                  <option value="urgent">Urgent · immediate concern</option>
                </select>
              </label>
            </div>
            <label>
              The useful details
              <textarea
                name="body"
                required
                maxLength={10000}
                rows={5}
                placeholder="What happened? What would a better experience look like?"
              />
            </label>
            <p className="rw-footnote">
              Saved to OpenFolk for review. Urgent flags do not yet trigger a phone call or WhatsApp
              alert.
            </p>
            {error && <p role="alert">{error}</p>}
            <button className="rw-btn" disabled={busy}>
              {busy ? "Saving…" : "Save observation"}
              <ArrowRight size={16} />
            </button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={settings} onOpenChange={setSettings}>
        <DialogContent className="rw-dialog">
          <DialogHeader>
            <DialogTitle>Your daily view</DialogTitle>
            <DialogDescription>
              Make this space work for you. Preferences are saved on this browser.
            </DialogDescription>
          </DialogHeader>
          <div className="rw-form">
            <label>
              Your focus for the day
              <textarea
                value={focus}
                maxLength={250}
                onChange={(e) => setFocus(e.target.value)}
                rows={3}
              />
            </label>
            <label className="rw-checkbox">
              <input
                type="checkbox"
                checked={compact}
                onChange={(e) => setCompact(e.target.checked)}
              />{" "}
              Use a more compact call journal
            </label>
            <button className="rw-btn" onClick={saveView}>
              Save my view <Check size={16} />
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!editing}
        onOpenChange={(o) => {
          if (!o && !busy) setEditing(null);
        }}
      >
        <DialogContent className="rw-dialog">
          <DialogHeader>
            <DialogTitle>Update this improvement</DialogTitle>
            <DialogDescription>{editing?.title}</DialogDescription>
          </DialogHeader>
          {editing && (
            <form className="rw-form" onSubmit={updateNote}>
              <label>
                Status
                <select name="status" defaultValue={editing.status}>
                  {stages.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label>
                OpenFolk’s response
                <textarea
                  name="response"
                  rows={5}
                  maxLength={10000}
                  defaultValue={editing.response}
                />
              </label>
              {error && <p role="alert">{error}</p>}
              <button className="rw-btn" disabled={busy}>
                {busy ? "Saving…" : "Save update"}
              </button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
function Metric({
  label,
  value,
  detail,
  icon,
  accent = false,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className={`rw-metric ${accent ? "rw-metric-accent" : ""}`}>
      <div>
        {label}
        {icon}
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
function Empty({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="rw-empty">
      {icon}
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
