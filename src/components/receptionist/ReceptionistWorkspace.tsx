import { WorkspaceMenu } from "@/components/WorkspaceMenu";
import { OpenFolkAdminLink } from "@/components/OpenFolkAdminLink";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  Phone,
  Mic,
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
  Menu,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { clientWorkspaceHref, selectedWorkspace } from "@/lib/client-workspace-nav";
import { getSupabaseClient } from "@/lib/supabase";
import { callerGroups, durationLabel, type ReceptionistCall } from "@/lib/receptionist-data";
import { usePullToRefresh } from "@/lib/use-pull-to-refresh";
import {
  emmaHealthCards,
  healthCardCalls,
  mainNumberStatus,
  type EmmaHealthCardId,
} from "@/lib/emma-health";
import {
  callBrief,
  experienceCards,
  callOutcome,
  rankCalls,
  reviewCall,
  sameNumberHistory,
} from "@/lib/receptionist-review";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import "./receptionist.css";
import { PhonePlanner } from "./PhonePlanner";
import { CallRecording } from "./CallRecording";
import { decodePhonePlan, describePhonePlan } from "@/lib/phone-plan";
import { describePhoneChanges } from "@/lib/phone-changes";
import { PracticeImprove, PracticeEvidence, EmmaTraining, useEmmaInfo } from "./PracticeImprove";

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
  practice_session_id?: string | null;
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
type View = "today" | "calls" | "callers" | "improvements" | "details" | "phones" | "practice";
const views = [
  { id: "today", label: "Overview", Icon: LayoutDashboard },
  { id: "practice", label: "Practise and improve", Icon: Mic },
  { id: "improvements", label: "Make Emma better", Icon: Sparkles },
  { id: "callers", label: "People who called", Icon: Users },
  { id: "phones", label: "Phone system", Icon: Phone },
  { id: "details", label: "About your receptionist", Icon: SlidersHorizontal },
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
  company: "Drummond Heating",
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
  initialView,
}: {
  demo?: boolean;
  tenantId?: string;
  initialView?: string;
}) {
  const { user, signOut } = useAuth();
  const db = getSupabaseClient();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [view, setViewState] = useState<View>(
      views.some((v) => v.id === initialView) ? (initialView as View) : "today",
    ),
    [selectedTenant, setSelectedTenant] = useState(tenantId ?? ""),
    [search, setSearch] = useState(""),
    [period, setPeriod] = useState("7"),
    [reviewOnly, setReviewOnly] = useState(false),
    [experienceFilter, setExperienceFilter] = useState(""),
    [sort, setSort] = useState("recent"),
    [selectedCall, setSelectedCall] = useState<ReceptionistCall | null>(null),
    [selectedHealthCard, setSelectedHealthCard] = useState<EmmaHealthCardId | null>(null),
    [composer, setComposer] = useState(false),
    [noteCall, setNoteCall] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [settings, setSettings] = useState(false),
    [compact, setCompact] = useState(false),
    [focus, setFocus] = useState("Start with calls that need a closer look."),
    [editing, setEditing] = useState<Feedback | null>(null),
    [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pull = usePullToRefresh(
    () =>
      qc.refetchQueries({
        type: "active",
        predicate: (query) => String(query.queryKey[0]).startsWith("receptionist-"),
      }),
    !demo && !mobileMenuOpen,
  );
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", close);
    };
  }, [mobileMenuOpen]);
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
  const info = useEmmaInfo(tenant ?? "", user?.id, demo);
  const workspaceHref = clientWorkspaceHref(demo ? undefined : tenant);
  function setView(next: View) {
    setMobileMenuOpen(false);
    if (next === view) return;
    setViewState(next);
    void navigate({
      to: "/receptionist",
      search: { tenant: demo ? undefined : tenant, demo: demo ? "1" : undefined, view: next },
    });
  }
  function goBack() {
    if (window.history.length > 1) window.history.back();
    else window.location.assign(workspaceHref);
  }
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
  const connected =
    demo || (!callsQuery.isError && callsQuery.data?.pages[0]?.connection === "connected");
  const visible =
    view === "today"
      ? calls
      : calls.filter(
          (c) =>
            (period === "all" ||
              Date.parse(c.createdAt) >= Date.now() - Number(period) * 86400000) &&
            (!reviewOnly || reviewCall(c).priority > 0) &&
            (!experienceFilter ||
              view !== "calls" ||
              experienceCards([c]).some(
                (card) => card.id === experienceFilter && card.flagged > 0,
              )) &&
            `${c.caller} ${c.number ?? ""} ${c.summary ?? ""}`
              .toLowerCase()
              .includes(search.toLowerCase()),
        );
  const open = notes.filter((n) => n.status !== "Resolved");
  const groups = callerGroups(visible);
  const loading = !demo && (workspaces.isLoading || callsQuery.isLoading);
  const healthCards = useMemo(
    () =>
      emmaHealthCards(calls, {
        connected,
        loading,
        error: callsQuery.isError,
        launchStage: w?.launch_stage,
      }),
    [calls, connected, loading, callsQuery.isError, w?.launch_stage],
  );
  const healthCard = healthCards.find((card) => card.id === selectedHealthCard);
  const healthDetailCalls = healthCard ? healthCardCalls(healthCard, calls) : [];
  useEffect(() => {
    setSelectedTenant(tenantId ?? "");
  }, [tenantId]);
  useEffect(() => {
    setViewState(views.some((item) => item.id === initialView) ? (initialView as View) : "today");
  }, [initialView]);
  useEffect(() => {
    setSelectedCall(null);
    setSelectedHealthCard(null);
    setComposer(false);
    setEditing(null);
    setSearch("");
    setNotice("");
    setExperienceFilter("");
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
    onSelect = setSelectedCall,
  }: {
    items?: ReceptionistCall[];
    onSelect?: (call: ReceptionistCall) => void;
  }) {
    return items.length ? (
      <div className="rw-call-list">
        {items.map((c) => (
          <button className="rw-call-row" key={c.id} onClick={() => onSelect(c)}>
            <span className={`rw-call-icon ${reviewCall(c).priority > 0 ? "rw-warn" : ""}`}>
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
            <span className="rw-call-summary">
              {callBrief(c).text}
              <small>{callBrief(c).source}</small>
              <small className="rw-outcome">{callOutcome(c)}</small>
            </span>
            <span className={`rw-pill ${reviewCall(c).priority > 0 ? "rw-pill-amber" : ""}`}>
              {reviewCall(c).priority > 0
                ? reviewCall(c).label
                : reviewCall(c).assessmentAvailable
                  ? "Assessed"
                  : "Not assessed"}
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
      <aside className={`rw-sidebar ${mobileMenuOpen ? "is-mobile-open" : ""}`}>
        <a
          href={workspaceHref}
          className="rw-brand"
          aria-label={`${w.company} — back to workspace`}
        >
          {w.company === "Drummond Heating" ? (
            <img className="rw-client-logo" src="/brand/drummond-logo.png" alt="Drummonds" />
          ) : (
            <span>{w.company}</span>
          )}
        </a>
        <button
          type="button"
          className="of-mobile-menu-toggle"
          aria-label={mobileMenuOpen ? "Close receptionist menu" : "Open receptionist menu"}
          aria-expanded={mobileMenuOpen}
          aria-controls="receptionist-mobile-navigation"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? <X size={23} /> : <Menu size={23} />}
        </button>
        <div id="receptionist-mobile-navigation" className="rw-mobile-menu-panel">
          <p className="of-mobile-company">{w.company}</p>
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
          <p className="rw-nav-caption">AI RECEPTIONIST</p>
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
                  setExperienceFilter("");
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
            {!demo && <OpenFolkAdminLink email={user?.email} authorised={operator.data} />}
            <small>
              <ShieldCheck size={14} /> Private client workspace
            </small>
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
        </div>
      </aside>
      <div className="rw-shell">
        <div className="of-pull-status" role="status" aria-live="polite">
          {pull.refreshing
            ? "Updating Emma’s calls…"
            : pull.ready
              ? "Release to refresh"
              : pull.distance > 0
                ? "Pull to refresh"
                : ""}
        </div>
        <header className="rw-topbar">
          <button
            type="button"
            onClick={goBack}
            className="rw-workspace-back"
            aria-label="Go back to previous page"
          >
            <ArrowLeft size={17} /> Back
          </button>
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
              {view !== "today" && <p className="rw-eyebrow">THE RECEPTIONIST WORKSPACE</p>}
              <h1>
                {view === "today"
                  ? "Your receptionist"
                  : view === "improvements"
                    ? `Make ${w.name} better.`
                    : views.find((v) => v.id === view)?.label + "."}
              </h1>
              <p>
                {view === "today"
                  ? "Who called. What happened. What needs your attention."
                  : view === "calls"
                    ? "A clear record of who called, what happened and what to learn."
                    : view === "callers"
                      ? "Caller history grouped by phone number. Identity is only as reliable as the source."
                      : view === "improvements"
                        ? "From a quick observation to a tested improvement. Keep the conversation here."
                        : view === "phones"
                          ? "Your current setup, clearly shown. OpenFolk applies and verifies your changes."
                          : view === "practice"
                            ? "Have a conversation. Tell us what you would change. See it through with OpenFolk."
                            : "Her knowledge, her instructions and the evidence behind her setup."}
              </p>
            </div>
          </div>
          {(view === "calls" || view === "callers") && (
            <div className="rw-toolbar">
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
          )}
          {view === "today" && (
            <>
              <section className="rw-emma-pulse" aria-label="Emma at a glance">
                <div className="rw-emma-pulse-feature">
                  <button
                    className={`rw-emma-pulse-main rw-emma-tone-${healthCards[0].tone}`}
                    onClick={() => setSelectedHealthCard("service")}
                    aria-label={`${w.name}: ${healthCards[0].headline}. Open status details`}
                  >
                    <span className="rw-emma-pulse-icon">
                      {healthCards[0].tone === "watch" ? (
                        <CircleAlert size={30} />
                      ) : (
                        <Headphones size={30} />
                      )}
                    </span>
                    <span className="rw-emma-pulse-copy">
                      <span className="rw-eyebrow">{w.name.toUpperCase()} AT A GLANCE</span>
                      <strong>{healthCards[0].headline}</strong>
                      <span>{healthCards[0].summary}</span>
                      {!demo && (
                        <small>
                          {connected
                            ? "Call data connected to OpenFolk"
                            : callsQuery.isError
                              ? "Call data needs a check"
                              : "Call data awaiting update"}
                          {" · "}
                          {mainNumberStatus(w.launch_stage)}
                        </small>
                      )}
                      <small>
                        {demo
                          ? "Illustrative preview"
                          : callsQuery.data?.pages[0]?.checkedAt
                            ? `Last checked ${date(callsQuery.data.pages[0].checkedAt)}`
                            : "Latest check in progress"}
                      </small>
                    </span>
                    <ChevronRight className="rw-emma-pulse-chevron" size={20} aria-hidden="true" />
                  </button>
                  <div className="rw-emma-shortcuts" aria-label="Receptionist shortcuts">
                    <button type="button" onClick={() => setView("practice")}>
                      <Mic size={18} /> Practise with Emma <ArrowRight size={17} />
                    </button>
                    <button type="button" onClick={() => setView("improvements")}>
                      <Sparkles size={18} /> Make Emma better <ArrowRight size={17} />
                    </button>
                  </div>
                </div>
                <div className="rw-emma-signal-grid">
                  {healthCards.slice(1).map((card) => (
                    <button
                      key={card.id}
                      className={`rw-emma-signal rw-emma-tone-${card.tone}`}
                      onClick={() => setSelectedHealthCard(card.id)}
                    >
                      <span className="rw-emma-signal-top">
                        <span className="rw-emma-signal-icon">
                          {card.id === "experience" ? (
                            <Sparkles size={19} />
                          ) : card.id === "help" ? (
                            <Users size={19} />
                          ) : (
                            <Phone size={19} />
                          )}
                        </span>
                        <span className="rw-emma-signal-state">
                          {card.tone === "good"
                            ? "Healthy"
                            : card.tone === "watch"
                              ? "Needs attention"
                              : "Evidence building"}
                        </span>
                      </span>
                      <span className="rw-emma-signal-title">{card.title}</span>
                      <strong>{card.headline}</strong>
                      <span className="rw-emma-signal-summary">{card.summary}</span>
                      <span className="rw-emma-signal-action">
                        {card.flaggedIds.length ? "See the calls" : "See details"}{" "}
                        <ArrowRight size={15} />
                      </span>
                    </button>
                  ))}
                </div>
              </section>
              <section className="rw-panel rw-emma-roadmap" aria-label="Where Emma is heading">
                <div className="rw-panel-title">
                  <div>
                    <p className="rw-eyebrow">BUILT AROUND YOUR BUSINESS</p>
                    <h2>Where Emma is heading</h2>
                  </div>
                </div>
                <div className="rw-emma-roadmap-steps">
                  <div>
                    <small>NOW</small>
                    <strong>Answer and learn</strong>
                    <span>See calls, spot confusion and tell us what to improve.</span>
                  </div>
                  <div>
                    <small>NEXT</small>
                    <strong>Know the caller</strong>
                    <span>Connect verified conversations with customer and site cards.</span>
                  </div>
                  <div>
                    <small>THEN</small>
                    <strong>Know the work</strong>
                    <span>
                      Use linked job, asset and team context to guide the right next step.
                    </span>
                  </div>
                </div>
                <p>
                  Each connection will be checked before Emma uses it. She won’t guess which
                  customer or job a call belongs to.
                </p>
              </section>
              <section className="rw-panel rw-journal">
                <div className="rw-panel-title">
                  <div>
                    <p className="rw-eyebrow">WHEN YOU WANT THE DETAIL</p>
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
                {experienceFilter && view === "calls" && (
                  <button className="rw-btn rw-btn-light" onClick={() => setExperienceFilter("")}>
                    {experienceCards([]).find((c) => c.id === experienceFilter)?.title} · Clear
                    filter
                  </button>
                )}
                <label>
                  <Search size={18} />
                  <input
                    aria-label="Search calls"
                    placeholder="Find a caller, number or conversation…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <select
                  aria-label="Sort conversations"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="recent">Newest first</option>
                  <option value="attention">Attention first</option>
                </select>
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
                  <CallList items={sort === "attention" ? rankCalls(visible) : visible} />
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
                            <small>{callBrief(c).text}</small>
                            <small>{callBrief(c).source}</small>
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
                  Tell us what Emma missed. We review it, improve her, and ask you to test the
                  change.
                  <br />
                  <small>
                    Over time, verified customer, site and job cards will help Emma give more useful
                    answers.
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
                      {describePhoneChanges(n.body) ??
                        (decodePhonePlan(n.body)
                          ? describePhonePlan(decodePhonePlan(n.body)!)
                          : n.body)}
                    </p>
                    <div className="rw-feedback-meta">
                      <span>{n.category.replace("-", " ")}</span>
                      <span>{date(n.created_at)}</span>
                    </div>
                    {n.practice_session_id && tenant && user && (
                      <PracticeEvidence
                        tenant={tenant}
                        sessionId={n.practice_session_id}
                        viewerId={user.id}
                      />
                    )}
                    {n.call_id && !n.practice_session_id && (
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
          {tenant && (
            <PracticeImprove
              key={`practice:${tenant}:${user?.id}`}
              tenant={tenant}
              userId={user?.id}
              name={w.name}
              demo={demo}
              active={view === "practice"}
              info={info}
            />
          )}
          {view === "details" && (
            <div className="rw-details-grid">
              <EmmaTraining name={w.name} info={info} />
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
                    ["Phone routing", mainNumberStatus(w.launch_stage)],
                    ["Configured number", w.phone_number ?? "To confirm"],
                    ["Knowledge / prompt", w.knowledge_version ?? "To verify with Vapi"],
                    [
                      "Configuration reviewed",
                      w.reviewed_at ? date(w.reviewed_at) : "Awaiting live verification",
                    ],
                    [
                      "Call evidence",
                      connected ? "Call data connected to OpenFolk" : "Call data awaiting update",
                    ],
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
      <Dialog open={!!healthCard} onOpenChange={(open) => !open && setSelectedHealthCard(null)}>
        <DialogContent className="rw-dialog rw-health-detail">
          <DialogHeader>
            <DialogTitle>{healthCard?.title}</DialogTitle>
            <DialogDescription>{healthCard?.headline}</DialogDescription>
          </DialogHeader>
          {healthCard && (
            <>
              <p className="rw-health-detail-explanation">{healthCard.explanation}</p>
              {healthCard.id === "service" && (
                <div className="rw-health-detail-facts">
                  <div>
                    <span>Call data</span>
                    <strong>{connected ? "Receiving call records" : "Being checked"}</strong>
                  </div>
                  <div>
                    <span>Last checked</span>
                    <strong>
                      {callsQuery.data?.pages[0]?.checkedAt
                        ? date(callsQuery.data.pages[0].checkedAt)
                        : "In progress"}
                    </strong>
                  </div>
                  <div>
                    <span>Calls seen in this view</span>
                    <strong>{connected ? calls.length : "—"}</strong>
                  </div>
                </div>
              )}
              {connected && healthCard.id !== "service" && (
                <div className="rw-health-detail-facts">
                  <div>
                    <span>Calls observed</span>
                    <strong>{healthCard.observed}</strong>
                  </div>
                  <div>
                    <span>With this signal assessed</span>
                    <strong>{healthCard.assessed}</strong>
                  </div>
                  <div>
                    <span>Calls worth a look</span>
                    <strong>{healthCard.flaggedIds.length}</strong>
                  </div>
                </div>
              )}
              {connected && healthDetailCalls.length > 0 && (
                <section className="rw-health-detail-calls">
                  <h3>Conversations worth a look</h3>
                  <CallList
                    items={healthDetailCalls}
                    onSelect={(call) => {
                      setSelectedHealthCard(null);
                      setSelectedCall(call);
                    }}
                  />
                </section>
              )}
              {connected && healthDetailCalls.length === 0 && (
                <p className="rw-health-detail-empty">
                  {healthCard.tone === "waiting"
                    ? "There is nothing for you to review here yet. This view will develop as calls arrive and are assessed."
                    : "No calls need your review under this signal in the loaded history."}
                </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
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
                <span className="rw-pill">{reviewCall(selectedCall).label}</span>
              </div>
              <h3>What happened</h3>
              <p>{callBrief(selectedCall).text}</p>
              <p className="rw-footnote">{callBrief(selectedCall).source}</p>
              <p className="rw-outcome-detail">{callOutcome(selectedCall)}</p>
              {reviewCall(selectedCall).signals.length > 0 && (
                <section className="rw-evidence" aria-label="Reasons to review">
                  <h3>Why this call is flagged</h3>
                  {reviewCall(selectedCall).signals.map((signal) => (
                    <div key={signal.label}>
                      <strong>{signal.label}</strong>
                      <p>{signal.evidence}</p>
                      <small>{signal.source} · verify against the conversation</small>
                    </div>
                  ))}
                </section>
              )}
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
              <CallRecording
                key={`${tenant}:${selectedCall.id}`}
                tenant={tenant!}
                call={selectedCall}
                demo={demo}
              />
              <details className="rw-transcript">
                <summary>
                  <FileText size={16} /> Read transcript
                </summary>
                <p className="rw-preserve">
                  {selectedCall.transcript ?? "Transcript not supplied by Vapi."}
                </p>
              </details>
              <details className="rw-transcript">
                <summary>
                  <Users size={16} /> Same-number history ·{" "}
                  {sameNumberHistory(selectedCall, calls).length} loaded calls
                </summary>
                <p className="rw-footnote">
                  Numbers can be shared. This does not establish a customer, a Job link or repeated
                  unresolved chasing.
                </p>
                {sameNumberHistory(selectedCall, calls).map((c) => (
                  <button key={c.id} className="rw-person-call" onClick={() => setSelectedCall(c)}>
                    <span>
                      {date(c.createdAt)}
                      <small>{callBrief(c).text}</small>
                      <small>{callBrief(c).source}</small>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                ))}
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
                <MessageSquare size={16} /> Suggest an improvement
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
function Empty({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="rw-empty">
      {icon}
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
