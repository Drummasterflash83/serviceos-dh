import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "motion/react";
import {
  LayoutDashboard, Workflow, Phone, Bot, Banknote, Settings, Briefcase,
  Search, Bell, ArrowUpRight, Activity, ChevronRight, Sparkles,
  GraduationCap, Mail, MessageSquare, Database, HardDrive, Globe,
  Monitor, FileText, Radio, Brain, TrendingUp, AlertTriangle, CheckCircle2,
  Zap, Eye, Target, Gauge, Layers, Network, ShieldCheck, Clock, Filter,
  Users, Inbox, IdCard,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import dhIcon from "@/assets/dh-icon-blackwhite.png.asset.json";
import {
  Protocol, OperationsHub, Customers,
  ApprovalQueuePanel, RecurringIssuesPanel, SystemsInventoryPanel,
} from "@/components/app/NewViews";
import { CardsView } from "@/components/app/Cards";


export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [
      { title: "ServiceOS · Command Centre" },
      { name: "description", content: "Live operations, calls, finance and intelligence - in one surface." },
    ],
  }),
  component: AppShell,
});

type ViewKey = "dashboard" | "cards" | "learn" | "intelligence" | "automations" | "agents" | "protocol" | "operations" | "calls" | "customers" | "finance" | "settings";

const NAV: { key: ViewKey; label: string; icon: typeof LayoutDashboard }[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "cards", label: "Cards", icon: IdCard },
  { key: "learn", label: "Learn", icon: GraduationCap },
  { key: "intelligence", label: "Intelligence", icon: Brain },
  { key: "automations", label: "Automations", icon: Zap },
  { key: "agents", label: "Agents", icon: Bot },
  { key: "protocol", label: "Protocol", icon: ShieldCheck },
  { key: "operations", label: "Operations", icon: Briefcase },
  { key: "calls", label: "Calls", icon: Phone },
  { key: "customers", label: "Customers", icon: Users },
  { key: "finance", label: "Numbers", icon: TrendingUp },
  { key: "settings", label: "Settings", icon: Settings },
];


function AppShell() {
  const [view, setView] = useState<ViewKey>("dashboard");

  return (
    <div className="flex min-h-screen bg-surface-alt text-foreground">
      {/* Sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-hairline bg-white md:flex">
        <Link to="/" className="flex items-center gap-2 border-b border-hairline px-5 py-4 text-display text-[15px] font-bold">
          <img src={dhIcon.url} alt="Drummonds" className="h-6 w-6 rounded-md object-contain" />
          ServiceOS
        </Link>

        <nav className="flex-1 space-y-1 p-3">
          {NAV.map((item) => (
            <button
              key={item.key}
              onClick={() => setView(item.key)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
                view === item.key
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-surface-alt hover:text-foreground",
              )}
            >
              <item.icon className="h-4 w-4" />
              <span className="flex-1 text-left">{item.label}</span>
              {view === item.key && <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          ))}
        </nav>

        <div className="border-t border-hairline p-4">
          <div className="rounded-xl bg-surface-alt p-3">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              All systems live
            </div>
            <div className="mt-2 text-xs text-muted-foreground">Drummond Heating</div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-hairline bg-white/80 px-6 py-3 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="text-display text-lg font-semibold capitalize">
              {NAV.find((n) => n.key === view)?.label}
            </div>
            <span className="hidden text-xs text-muted-foreground md:inline">·</span>
            <span className="hidden font-mono text-xs text-muted-foreground md:inline">Tuesday · 14:22</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative hidden md:block">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                placeholder="Search jobs, calls, customers…"
                className="w-72 rounded-full border border-hairline bg-white py-1.5 pl-9 pr-3 text-sm outline-none transition focus:border-accent"
              />
            </div>
            <button className="grid h-9 w-9 place-items-center rounded-full border border-hairline">
              <Bell className="h-4 w-4 text-muted-foreground" />
            </button>
            <div className="grid h-9 w-9 place-items-center rounded-full bg-foreground text-xs font-semibold text-background">DH</div>
          </div>
        </header>

        <main className="flex-1 p-6">
          {view === "dashboard" && <Dashboard />}
          {view === "cards" && <CardsView />}
          {view === "learn" && <Learn />}
          {view === "intelligence" && <Intelligence />}
          {view === "automations" && <Automations />}
          {view === "agents" && <Agents />}
          {view === "protocol" && <Protocol />}
          {view === "operations" && <OperationsHub jobsSlot={<Operations />} />}
          {view === "calls" && <Calls />}
          {view === "customers" && <Customers />}
          {view === "finance" && <Finance />}
          {view === "settings" && <SettingsView />}
        </main>
      </div>
    </div>
  );
}

/* ────── DASHBOARD ────── */
function Dashboard() {
  const statTiles = [
    { l: "Live jobs", v: "42", sub: "+6 vs yesterday", icon: Workflow },
    { l: "Inside protocol", v: "94%", sub: "16 of 17 threads", icon: ShieldCheck },
    { l: "On-call tonight", v: "T. Reid", sub: "+2 backups armed", icon: Clock },
    { l: "Mailbox health", v: "47m", sub: "oldest unread · office@", icon: Inbox },
    { l: "Revenue today", v: "£18.4k", sub: "+12% vs wk avg", icon: Banknote },
  ];

  // Company Health · hourly composite (jobs on track, comms answered, sentiment, money flowing)
  // score 0-100, higher = healthier. Reasons drive hover tooltips and the insights panel.
  type HealthPoint = { hour: string; score: number; reason?: string; pillar?: string };
  const health: HealthPoint[] = [
    { hour: "00:00", score: 96 }, { hour: "01:00", score: 97 }, { hour: "02:00", score: 98 },
    { hour: "03:00", score: 98 }, { hour: "04:00", score: 97 }, { hour: "05:00", score: 95 },
    { hour: "06:00", score: 92 }, { hour: "07:00", score: 90 }, { hour: "08:00", score: 88 },
    { hour: "09:00", score: 91 }, { hour: "10:00", score: 89 }, { hour: "11:00", score: 86 },
    { hour: "12:00", score: 84 }, { hour: "13:00", score: 82 },
    { hour: "14:00", score: 78, pillar: "Operations", reason: "Supplier delay affecting 3 jobs" },
    { hour: "15:00", score: 74, pillar: "Operations", reason: "Engineer 04 over-running · 28 min behind" },
    { hour: "16:00", score: 71, pillar: "Quoting",    reason: "Quote follow-ups overdue ×7" },
    { hour: "17:00", score: 68, pillar: "Quoting",    reason: "Alan's review queue building (4 quotes)" },
    { hour: "18:00", score: 62, pillar: "Comms",      reason: "office@ unread climbing · 47m oldest" },
    { hour: "19:00", score: 58, pillar: "Customer",   reason: "ABC School sentiment turned frustrated" },
    { hour: "20:00", score: 54, pillar: "Customer",   reason: "Complaint risk · ABC School (unresolved)" },
    { hour: "21:00", score: 51, pillar: "Customer",   reason: "No touchpoint in quote→book gap (3 wks)" },
    { hour: "22:00", score: 49, pillar: "Comms",      reason: "Rudy callbacks owed ×3 · landing on Mary" },
    { hour: "23:00", score: 47, pillar: "Operations", reason: "Parts not verified at goods-in (×2)" },
  ];
  const overall = Math.round(health.reduce((a, b) => a + b.score, 0) / health.length);
  const trend = health[health.length - 1].score - health[0].score; // negative = declining

  const insights = [
    { tone: "warning",     pillar: "Operations", text: "Supplier delay affecting 3 jobs", detail: "Reorder window closes 16:00 — switch to Plumb Base saves 2 days." },
    { tone: "accent",      pillar: "Quoting",    text: "Quote follow-up overdue ×7",      detail: "Day-20 nudge ready to send. ~70% reply rate on spam-drift line." },
    { tone: "destructive", pillar: "Customer",   text: "Complaint risk · ABC School",     detail: "Frustrated sentiment + no callback in 2 days. Mary owns the response." },
    { tone: "warning",     pillar: "Comms",      text: "office@ unread climbing",         detail: "Oldest 47m. 3 likely routable to scheduling — auto-route ready." },
    { tone: "success",     pillar: "Money",      text: "Margin tracking +3.4% vs week",   detail: "Procurement agent saved £214 across 3 supplier comparisons today." },
  ] as const;


  const activity = [
    { t: "14:22", who: "Reception Agent", what: "Inbound call · ABC School routed to dispatch" },
    { t: "14:19", who: "Procurement Agent", what: "Compared 3 supplier quotes · saved £214" },
    { t: "14:15", who: "Scheduling Agent", what: "Re-routed Engineer 04 · saved 28 mins" },
    { t: "14:11", who: "Finance Agent", what: "Reconciled invoice INV-3387 · matched" },
    { t: "14:04", who: "Workflow Intelligence", what: "New automation candidate detected (74% time saving)" },
  ];

  return (
    <div className="space-y-6">
      {/* Hero · today snapshot */}
      <div className="rounded-2xl border border-hairline bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-foreground text-background">
                <LayoutDashboard className="h-3 w-3" />
              </span>
              Dashboard · today
            </div>
            <h2 className="text-display mt-3 text-2xl font-semibold tracking-tight">
              Drummond Heating, at a glance.
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              One clean snapshot of the business · jobs in flight, money on the move, and where attention is needed next.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-hairline bg-surface-alt px-3 py-1.5 text-[11px] font-medium">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
            Live · streaming
          </div>
        </div>

        {/* Aligned stat row */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {statTiles.map((k) => (
            <div key={k.l} className="rounded-xl border border-hairline bg-surface-alt p-4">
              <div className="flex h-5 items-center justify-between text-muted-foreground">
                <div className="text-[10px] font-medium uppercase tracking-wider">{k.l}</div>
                <k.icon className="h-3.5 w-3.5" />
              </div>
              <div className="text-display mt-3 h-8 text-2xl font-bold leading-none tabular text-foreground">{k.v}</div>
              <div className="mt-2 h-4 text-[10px] leading-none text-muted-foreground">{k.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Pillar snapshot */}
      <div className="rounded-2xl border border-hairline bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Pillar health · live</div>
            <div className="text-display mt-1 text-lg font-semibold">Where the business stands right now.</div>
          </div>
          <div className="text-[11px] text-muted-foreground">Recalculated hourly</div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PILLARS.map((p) => {
            const h = PILLAR_HEALTH[p.key];
            return (
              <div key={p.key} className="rounded-xl border border-hairline bg-surface-alt p-4">
                <div className="flex h-5 items-center justify-between text-muted-foreground">
                  <div className="text-[10px] font-medium uppercase tracking-wider">{p.label}</div>
                  <p.icon className="h-3.5 w-3.5" />
                </div>
                <div className="text-display mt-3 h-8 text-2xl font-bold leading-none tabular text-foreground">{h.score}</div>
                <div className="mt-2 h-4 text-[10px] leading-none text-muted-foreground">{h.trend}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Risk windows + insights */}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-hairline bg-white p-5 md:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Complaint risk</div>
              <div className="text-display mt-1 text-sm font-semibold">Last 24 windows</div>
            </div>
            <span className="rounded-full border border-success/20 bg-success/10 px-2.5 py-1 text-[10px] font-medium text-success">Low</span>
          </div>
          <div className="mt-5 flex h-20 items-end gap-1">
            {Array.from({ length: 24 }).map((_, i) => {
              const h = 20 + ((i * 13) % 60);
              const tone = i < 18 ? "bg-success/40" : i < 22 ? "bg-warning/50" : "bg-destructive/50";
              return <div key={i} className={cn("flex-1 rounded-sm", tone)} style={{ height: `${h}px` }} />;
            })}
          </div>
          <div className="mt-3 flex justify-between font-mono text-[10px] text-muted-foreground">
            <span>00:00</span><span>12:00</span><span>now</span>
          </div>
        </div>

        <div className="rounded-2xl border border-hairline bg-white p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">AI insights</div>
              <div className="text-display mt-1 text-sm font-semibold">Needs attention</div>
            </div>
            <Sparkles className="h-4 w-4 text-accent" />
          </div>
          <div className="mt-4 space-y-2">
            {insights.map((x) => (
              <div key={x.text} className="flex items-start gap-2 rounded-lg border border-hairline p-2.5">
                <span className={cn(
                  "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                  x.tone === "warning" && "bg-warning",
                  x.tone === "accent" && "bg-accent",
                  x.tone === "destructive" && "bg-destructive",
                )} />
                <span className="text-xs leading-snug">{x.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Live activity */}
      <div className="rounded-2xl border border-hairline bg-white">
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Live activity</div>
            <div className="text-display mt-0.5 text-sm font-semibold">Agents and automations, in real time</div>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-success">
            <Activity className="h-3.5 w-3.5" /> streaming
          </div>
        </div>
        <div className="divide-y divide-hairline">
          {activity.map((row) => (
            <div key={row.t} className="grid grid-cols-12 items-center gap-3 px-5 py-3 text-sm">
              <div className="col-span-2 font-mono text-xs text-muted-foreground">{row.t}</div>
              <div className="col-span-3 font-medium">{row.who}</div>
              <div className="col-span-7 text-muted-foreground">{row.what}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ────── OPERATIONS ────── */
function Operations() {
  const jobs = [
    { id: "J-3402", customer: "ABC School", engineer: "T. Reid", status: "Urgent", value: "£1,840" },
    { id: "J-3401", customer: "Greenfield Care Home", engineer: "M. Patel", status: "In progress", value: "£640" },
    { id: "J-3400", customer: "12 Marlborough Rd", engineer: "S. Walsh", status: "Scheduled", value: "£320" },
    { id: "J-3399", customer: "Highbridge Foods Ltd", engineer: "-", status: "Awaiting parts", value: "£2,120" },
    { id: "J-3398", customer: "Crestmont Apartments", engineer: "L. Bryan", status: "Completed", value: "£480" },
  ];
  return (
    <div className="rounded-2xl border border-hairline bg-white">
      <div className="grid grid-cols-12 border-b border-hairline px-5 py-3 text-[11px] uppercase tracking-wider text-muted-foreground">
        <div className="col-span-2">Job</div>
        <div className="col-span-4">Customer</div>
        <div className="col-span-3">Engineer</div>
        <div className="col-span-2">Status</div>
        <div className="col-span-1 text-right">Value</div>
      </div>
      {jobs.map((j) => (
        <div key={j.id} className="grid grid-cols-12 items-center border-b border-hairline px-5 py-4 text-sm last:border-0 hover:bg-surface-alt">
          <div className="col-span-2 font-mono text-xs">{j.id}</div>
          <div className="col-span-4 font-medium">{j.customer}</div>
          <div className="col-span-3 text-muted-foreground">{j.engineer}</div>
          <div className="col-span-2">
            <span className={cn(
              "rounded-full px-2.5 py-0.5 text-[11px] font-medium",
              j.status === "Urgent" && "bg-destructive/10 text-destructive",
              j.status === "In progress" && "bg-accent/10 text-accent",
              j.status === "Scheduled" && "bg-surface-alt text-muted-foreground",
              j.status === "Awaiting parts" && "bg-warning/10 text-warning",
              j.status === "Completed" && "bg-success/10 text-success",
            )}>{j.status}</span>
          </div>
          <div className="col-span-1 text-right font-mono tabular">{j.value}</div>
        </div>
      ))}
    </div>
  );
}

/* ────── CALLS ────── */
function Calls() {
  const calls = [
    { time: "14:22", caller: "ABC School", urgency: "High", sentiment: "Frustrated", intent: "No heating" },
    { time: "13:51", caller: "M. Greene", urgency: "Med", sentiment: "Neutral", intent: "Annual service" },
    { time: "13:30", caller: "Highbridge Foods", urgency: "Low", sentiment: "Positive", intent: "Quote query" },
    { time: "12:48", caller: "Crestmont Apts.", urgency: "High", sentiment: "Frustrated", intent: "Leak" },
  ];
  return (
    <div className="space-y-5">
      <RecurringIssuesPanel />
      <div className="grid gap-3 md:grid-cols-12">
        <div className="rounded-2xl border border-hairline bg-white md:col-span-7">
          <div className="border-b border-hairline px-5 py-3 text-sm font-semibold">Recent calls</div>
          {calls.map((c, i) => (
            <div key={i} className="grid grid-cols-12 items-center border-b border-hairline px-5 py-4 text-sm last:border-0 hover:bg-surface-alt">
              <div className="col-span-2 font-mono text-xs text-muted-foreground">{c.time}</div>
              <div className="col-span-4 font-medium">{c.caller}</div>
              <div className="col-span-2 text-xs">{c.urgency}</div>
              <div className="col-span-2 text-xs text-muted-foreground">{c.sentiment}</div>
              <div className="col-span-2 text-xs text-muted-foreground">{c.intent}</div>
            </div>
          ))}
        </div>
        <div className="rounded-2xl border border-hairline bg-white p-5 md:col-span-5">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Live transcript</div>
          <div className="mt-3 text-sm font-semibold">ABC School · 14:22</div>
          <div className="mt-4 space-y-3 text-sm">
            <p><span className="font-mono text-xs text-muted-foreground">caller</span><br />Our heating's been out since this morning, three classrooms…</p>
            <p><span className="font-mono text-xs text-accent">agent</span><br />Understood. I'm escalating now and dispatching the nearest engineer.</p>
          </div>
          <div className="mt-4 rounded-lg border border-accent/30 bg-accent-soft p-3 text-xs">
            <div className="font-semibold text-accent">Recommended action</div>
            <div className="mt-1 text-foreground">Escalate · dispatch T. Reid (12 min away)</div>
          </div>
        </div>
      </div>
    </div>
  );
}




/* ────── AGENTS ────── */
type AgentCat = "ops" | "finance" | "customer" | "compliance" | "cross";
type AgentMode = "Advisory" | "Draft" | "Execute" | "Escalate";
type AgentStatus = "Active" | "Idle" | "Paused" | "Training";

type AgentItem = {
  id: string;
  name: string;
  cat: AgentCat;
  icon: typeof Phone;
  purpose: string;
  task: string;
  mode: AgentMode;
  status: AgentStatus;
  confidence: number;
  runs7d: string;
  saved: string;
  tools: string[];
  allowed: string[];
  forbidden: string[];
  escalate: string;
};

const AGENT_CATS: { key: AgentCat; label: string; tone: string }[] = [
  { key: "ops", label: "Operations", tone: "accent" },
  { key: "finance", label: "Finance", tone: "success" },
  { key: "customer", label: "Customer", tone: "warning" },
  { key: "compliance", label: "Compliance", tone: "muted" },
  { key: "cross", label: "Cross-cutting", tone: "accent" },
];

const AGENTS: AgentItem[] = [
  {
    id: "a1", name: "Reception Agent", cat: "ops", icon: Phone,
    purpose: "Triage every inbound call, route to the right queue, summarise for dispatch.",
    task: "Handling 2 live calls · routing to dispatch",
    mode: "Execute", status: "Active", confidence: 96, runs7d: "1,284", saved: "31 hrs/wk",
    tools: ["Voice AI", "Commusoft", "Calendar"],
    allowed: ["Classify intent", "Draft callback notes", "Route to engineer queue"],
    forbidden: ["Confirm pricing", "Promise SLAs to customers"],
    escalate: "Hands off to duty manager on complaint sentiment > 0.7 or contract VIP flag.",
  },
  {
    id: "a2", name: "Inbox Agent", cat: "ops", icon: Mail,
    purpose: "Classify inbound email, draft replies, attach to the right job.",
    task: "Sorting 41 unread · 12 drafts ready",
    mode: "Draft", status: "Active", confidence: 91, runs7d: "612", saved: "14 hrs/wk",
    tools: ["Gmail", "Commusoft", "Templates"],
    allowed: ["Classify and label", "Draft replies for approval", "Link to job record"],
    forbidden: ["Send without approval", "Edit invoices"],
    escalate: "Escalates anything tagged dispute, refund or legal.",
  },
  {
    id: "a3", name: "Scheduling Agent", cat: "ops", icon: Workflow,
    purpose: "Optimise the daily board by skill, location, urgency and SLA.",
    task: "Optimising 11 routes · saving 2h 18m today",
    mode: "Execute", status: "Active", confidence: 92, runs7d: "318", saved: "9 hrs/wk",
    tools: ["Calendar", "Maps", "Commusoft"],
    allowed: ["Re-sequence non-VIP jobs", "Suggest engineer swaps", "Auto-confirm under 30 min slips"],
    forbidden: ["Cancel a job", "Move a contract SLA job without approval"],
    escalate: "Asks dispatcher when a move breaks a contract SLA window.",
  },
  {
    id: "a4", name: "Quote Agent", cat: "finance", icon: FileText,
    purpose: "Prepare quote drafts, chase missing info, check supplier pricing.",
    task: "Preparing 7 quote drafts · 2 awaiting parts",
    mode: "Draft", status: "Active", confidence: 87, runs7d: "94", saved: "11 hrs/wk",
    tools: ["Commusoft", "Supplier APIs", "PDF builder"],
    allowed: ["Pull part pricing", "Draft quote PDF", "Send chase emails for missing info"],
    forbidden: ["Send the quote", "Apply discount over 5%"],
    escalate: "Owner approval required on quotes > £5,000.",
  },
  {
    id: "a5", name: "Procurement Agent", cat: "finance", icon: Network,
    purpose: "Compare supplier pricing across catalogues, normalise parts, flag savings.",
    task: "Comparing 3 supplier quotes · saved £214 today",
    mode: "Execute", status: "Active", confidence: 91, runs7d: "212", saved: "£6.4k/mo",
    tools: ["Wolseley", "City Plumbing", "Plumbase"],
    allowed: ["Place orders < £400", "Switch supplier on >5% saving", "Consolidate weekly orders"],
    forbidden: ["Open new supplier accounts", "Pay invoices"],
    escalate: "Escalates stock-outs that put a same-day job at risk.",
  },
  {
    id: "a6", name: "Finance Agent", cat: "finance", icon: Banknote,
    purpose: "Track overdue invoices, reconcile payments, prepare chase workflows.",
    task: "Reconciling 47 invoices · 6 chases queued",
    mode: "Draft", status: "Active", confidence: 88, runs7d: "188", saved: "£12k cash unlocked",
    tools: ["Xero", "Stripe", "Commusoft"],
    allowed: ["Match payments to invoices", "Draft chase letters", "Tag disputed invoices"],
    forbidden: ["Write-off debt", "Refund a customer"],
    escalate: "Hands off chases > 60 days to the owner.",
  },
  {
    id: "a7", name: "Customer Care Agent", cat: "customer", icon: Sparkles,
    purpose: "Post-job follow-ups, review requests, sentiment monitoring.",
    task: "Sending 14 post-job follow-ups · 3 risk alerts",
    mode: "Execute", status: "Active", confidence: 84, runs7d: "402", saved: "+8pt CSAT",
    tools: ["SMS", "Email", "Reviews.io"],
    allowed: ["Send follow-up SMS / email", "Request reviews on 5-star jobs", "Open care ticket"],
    forbidden: ["Issue refunds", "Promise rebooking"],
    escalate: "Escalates sentiment < 0.4 or any mention of 'complaint'.",
  },
  {
    id: "a8", name: "Compliance Agent", cat: "compliance", icon: ShieldCheck,
    purpose: "Flag missing certs, RAMS, photos and audit gaps before they bite.",
    task: "Checking 22 job records · 4 gaps flagged",
    mode: "Advisory", status: "Active", confidence: 95, runs7d: "146", saved: "0 audit gaps",
    tools: ["Commusoft", "Drive", "Gas Safe register"],
    allowed: ["Open gap tickets", "Notify engineer of missing doc", "Block invoice on missing cert"],
    forbidden: ["Sign off compliance documents"],
    escalate: "Escalates expiring Gas Safe ID to office manager 30 days out.",
  },
  {
    id: "a9", name: "Job Health Agent", cat: "ops", icon: Gauge,
    purpose: "Score every live job by risk, delay, sentiment and financial exposure.",
    task: "Scoring 42 live jobs · 3 amber, 1 red",
    mode: "Advisory", status: "Active", confidence: 89, runs7d: "1,012", saved: "−18% overruns",
    tools: ["Commusoft", "Calls", "Email"],
    allowed: ["Surface job risk score", "Notify owner of red jobs", "Suggest interventions"],
    forbidden: ["Cancel or reschedule jobs"],
    escalate: "Pings owner the moment a job turns red.",
  },
  {
    id: "a10", name: "Asset Health Agent", cat: "compliance", icon: HardDrive,
    purpose: "Predictive view of customer assets, service due dates and failure risk.",
    task: "Watching 1,840 assets · 42 due in 30 days",
    mode: "Draft", status: "Active", confidence: 86, runs7d: "204", saved: "+£18k recurring",
    tools: ["Commusoft", "IoT feeds", "Service history"],
    allowed: ["Draft service-due reminders", "Flag failing assets", "Suggest contract upsell"],
    forbidden: ["Book service slots directly"],
    escalate: "Escalates assets with two faults in 90 days.",
  },
  {
    id: "a11", name: "Workflow Intelligence", cat: "cross", icon: Brain,
    purpose: "Watch how work actually flows and surface new automation candidates.",
    task: "Tracking 38 workflows · 4 new candidates today",
    mode: "Advisory", status: "Active", confidence: 93, runs7d: "—", saved: "12 upgrades shipped",
    tools: ["Event stream", "Audit log", "Pattern miner"],
    allowed: ["Detect repeat patterns", "Score automation impact", "Propose to Intelligence layer"],
    forbidden: ["Deploy automations on its own"],
    escalate: "Sends every candidate to the Intelligence review queue.",
  },
  {
    id: "a12", name: "Voice Analytics", cat: "customer", icon: Radio,
    purpose: "Listen to every call, extract intent, sentiment and coaching moments.",
    task: "Analysed 84 calls today · 6 coaching clips",
    mode: "Advisory", status: "Training", confidence: 81, runs7d: "598", saved: "+11pt first-call resolution",
    tools: ["Voice AI", "Transcripts", "CRM"],
    allowed: ["Score sentiment", "Tag call intent", "Flag coaching moments"],
    forbidden: ["Action on calls directly", "Share recordings externally"],
    escalate: "Notifies owner of any threat or safeguarding language.",
  },
];

const MODE_TONE: Record<AgentMode, string> = {
  Advisory: "bg-muted/40 text-muted-foreground border-hairline",
  Draft: "bg-accent/10 text-accent border-accent/20",
  Execute: "bg-success/10 text-success border-success/20",
  Escalate: "bg-warning/10 text-warning border-warning/20",
};

const STATUS_TONE: Record<AgentStatus, string> = {
  Active: "text-success",
  Idle: "text-muted-foreground",
  Paused: "text-warning",
  Training: "text-accent",
};

function Agents() {
  const [cat, setCat] = useState<"all" | AgentCat>("all");
  const [mode, setMode] = useState<"all" | AgentMode>("all");
  const [open, setOpen] = useState<AgentItem | null>(null);

  const filtered = AGENTS.filter(
    (a) => (cat === "all" || a.cat === cat) && (mode === "all" || a.mode === mode),
  );

  const avgConfidence = Math.round(AGENTS.reduce((s, a) => s + a.confidence, 0) / AGENTS.length);
  const liveCount = AGENTS.filter((a) => a.status === "Active").length;

  const statTiles = [
    { l: "Agents deployed", v: String(AGENTS.length), sub: "across 5 categories", icon: Bot },
    { l: "Live now", v: String(liveCount), sub: "actively working", icon: Activity },
    { l: "Runs · 7 days", v: "5.4k", sub: "auditable actions", icon: Workflow },
    { l: "Avg confidence", v: `${avgConfidence}%`, sub: "fleet wide", icon: Gauge },
    { l: "Owner reviews", v: "9", sub: "queued for approval", icon: CheckCircle2 },
  ];

  const modeOptions: ("all" | AgentMode)[] = ["all", "Advisory", "Draft", "Execute", "Escalate"];

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="rounded-2xl border border-hairline bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-foreground text-background">
                <Bot className="h-3 w-3" />
              </span>
              Agents · the workforce inside ServiceOS
            </div>
            <h2 className="text-display mt-3 text-2xl font-semibold tracking-tight">
              AI workers with a role, a policy and an audit trail.
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Every agent has scoped permissions, clear escalation rules and a full run log. Click any agent to inspect its policy and recent work.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-hairline bg-surface-alt px-3 py-1.5 text-[11px] font-medium">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
            No silent automation
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {statTiles.map((k) => (
            <div key={k.l} className="rounded-xl border border-hairline bg-surface-alt p-4">
              <div className="flex h-5 items-center justify-between text-muted-foreground">
                <div className="text-[10px] font-medium uppercase tracking-wider">{k.l}</div>
                <k.icon className="h-3.5 w-3.5" />
              </div>
              <div className="text-display mt-3 h-8 text-2xl font-bold leading-none tabular text-foreground">{k.v}</div>
              <div className="mt-2 h-4 text-[10px] leading-none text-muted-foreground">{k.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Category filter row */}
      <div className="rounded-2xl border border-hairline bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Filter by category</div>
            <div className="text-display mt-1 text-sm font-semibold">Pick a slice of the workforce.</div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(["all", ...AGENT_CATS.map((c) => c.key)] as ("all" | AgentCat)[]).map((k) => {
              const label = k === "all" ? "All" : AGENT_CATS.find((c) => c.key === k)!.label;
              const count = k === "all" ? AGENTS.length : AGENTS.filter((a) => a.cat === k).length;
              return (
                <button
                  key={k}
                  onClick={() => setCat(k)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                    cat === k
                      ? "border-foreground bg-foreground text-background"
                      : "border-hairline bg-white text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label} <span className="ml-1 tabular opacity-70">{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-hairline pt-4">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Approval mode</span>
          {modeOptions.map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                "rounded-full border px-3 py-1 text-[11px] font-medium transition",
                mode === m
                  ? "border-foreground bg-foreground text-background"
                  : "border-hairline bg-white text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "all" ? "All modes" : m}
            </button>
          ))}
        </div>
      </div>

      <ApprovalQueuePanel />

      {/* Agent grid */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {filtered.map((a) => {
          const catMeta = AGENT_CATS.find((c) => c.key === a.cat)!;
          return (
            <button
              key={a.id}
              onClick={() => setOpen(a)}
              className="group rounded-2xl border border-hairline bg-white p-5 text-left transition hover:border-foreground/40 hover:shadow-sm"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-9 w-9 place-items-center rounded-xl border border-hairline bg-surface-alt">
                    <a.icon className="h-4 w-4 text-foreground" />
                  </span>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{catMeta.label}</div>
                    <div className="text-display text-sm font-semibold leading-tight">{a.name}</div>
                  </div>
                </div>
                <span className={cn("flex items-center gap-1.5 text-[10px] uppercase tracking-wider", STATUS_TONE[a.status])}>
                  <span className={cn("h-1.5 w-1.5 rounded-full", a.status === "Active" ? "bg-success animate-pulse" : a.status === "Training" ? "bg-accent" : a.status === "Paused" ? "bg-warning" : "bg-muted-foreground")} />
                  {a.status}
                </span>
              </div>

              <p className="mt-4 text-xs leading-relaxed text-muted-foreground line-clamp-2">{a.task}</p>

              <div className="mt-4 flex items-center justify-between">
                <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider", MODE_TONE[a.mode])}>
                  {a.mode}
                </span>
                <span className="font-mono text-[11px] tabular text-muted-foreground">{a.confidence}% conf.</span>
              </div>

              <div className="mt-3 h-1 rounded-full bg-surface-alt">
                <div className="h-full rounded-full bg-foreground" style={{ width: `${a.confidence}%` }} />
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-hairline pt-3 text-[11px]">
                <span className="text-muted-foreground">Runs · 7d <span className="font-mono tabular text-foreground">{a.runs7d}</span></span>
                <span className="text-muted-foreground">Impact <span className="font-mono tabular text-foreground">{a.saved}</span></span>
              </div>
            </button>
          );
        })}
      </div>

      <Dialog open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="max-w-2xl">
          {open && (() => {
            const catMeta = AGENT_CATS.find((c) => c.key === open.cat)!;
            return (
              <>
                <DialogHeader>
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <open.icon className="h-3.5 w-3.5" />
                    {catMeta.label} · {open.mode}
                  </div>
                  <DialogTitle className="text-display text-xl font-semibold">{open.name}</DialogTitle>
                  <DialogDescription className="text-sm">{open.purpose}</DialogDescription>
                </DialogHeader>

                <div className="grid grid-cols-3 gap-3 border-y border-hairline py-4">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Confidence</div>
                    <div className="text-display mt-1 text-lg font-bold tabular">{open.confidence}%</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Runs · 7d</div>
                    <div className="text-display mt-1 text-lg font-bold tabular">{open.runs7d}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Impact</div>
                    <div className="text-display mt-1 text-lg font-bold tabular">{open.saved}</div>
                  </div>
                </div>

                <div className="space-y-4 text-sm">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Right now</div>
                    <div className="mt-1 rounded-lg border border-hairline bg-surface-alt p-3 text-xs">{open.task}</div>
                  </div>

                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Tools</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {open.tools.map((t) => (
                        <span key={t} className="rounded-full border border-hairline bg-surface-alt px-2.5 py-1 text-[11px] font-medium">{t}</span>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-success">Allowed</div>
                      <ul className="mt-2 space-y-1.5">
                        {open.allowed.map((x) => (
                          <li key={x} className="flex items-start gap-2 text-xs">
                            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                            <span>{x}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-destructive">Forbidden</div>
                      <ul className="mt-2 space-y-1.5">
                        {open.forbidden.map((x) => (
                          <li key={x} className="flex items-start gap-2 text-xs">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                            <span>{x}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="rounded-lg border border-warning/20 bg-warning/5 p-3">
                    <div className="text-[11px] uppercase tracking-wider text-warning">Escalation policy</div>
                    <p className="mt-1 text-xs text-foreground">{open.escalate}</p>
                  </div>
                </div>

                <div className="flex justify-end gap-2 border-t border-hairline pt-4">
                  <button className="rounded-lg border border-hairline px-3 py-1.5 text-xs font-medium hover:bg-surface-alt">Inspect run log</button>
                  <button className="rounded-lg border border-hairline px-3 py-1.5 text-xs font-medium hover:bg-surface-alt">Adjust policy</button>
                  <button className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90">{open.status === "Paused" ? "Activate" : "Pause"}</button>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ────── NUMBERS ────── */
function Finance() {
  // 12 months: M1-M3 pre-ServiceOS, M4 onwards post-deployment
  const revenue = [184, 192, 188, 214, 232, 248, 271, 286, 298, 312, 328, 344];
  const deployIdx = 3; // ServiceOS goes live at month 4

  const headline = [
    { l: "Revenue · monthly", before: "£188k", after: "£344k", delta: "+83%", icon: Banknote },
    { l: "Gross margin", before: "22%", after: "36%", delta: "+14pp", icon: TrendingUp },
    { l: "Admin hours / wk", before: "142", after: "58", delta: "−59%", icon: Clock },
    { l: "Avg job cycle", before: "6.4 days", after: "3.1 days", delta: "−52%", icon: Workflow },
    { l: "CSAT", before: "78", after: "92", delta: "+14pt", icon: Sparkles },
  ];

  const operational = [
    { l: "First-call resolution", before: "61%", after: "84%", tone: "success" as const },
    { l: "Quotes sent in 24h", before: "38%", after: "91%", tone: "success" as const },
    { l: "Overdue invoices > 30d", before: "£62k", after: "£18k", tone: "success" as const },
    { l: "Engineer utilisation", before: "64%", after: "82%", tone: "success" as const },
    { l: "Compliance gaps", before: "11", after: "0", tone: "success" as const },
    { l: "Repeat customer rate", before: "44%", after: "67%", tone: "success" as const },
  ];

  const wins = [
    { v: "£214k", l: "Cash unlocked", sub: "faster invoicing + chase automation" },
    { v: "1,840", l: "Hours recovered", sub: "from reactivity · back to proactive work" },
    { v: "£68k", l: "Procurement savings", sub: "via supplier comparison agent" },
    { v: "£18.4k", l: "Warranty £ recovered", sub: "claimed back from manufacturers" },
    { v: "£148k", l: "PPM value secured", sub: "renewals booked on schedule" },
    { v: "27", l: "Automations live", sub: "running every day, every job" },
  ];

  const w = 600, h = 200, pad = 8;
  const max = Math.max(...revenue);
  const linePath = revenue
    .map((p, i) => {
      const x = pad + (i / (revenue.length - 1)) * (w - pad * 2);
      const y = h - pad - (p / max) * (h - pad * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const deployX = pad + (deployIdx / (revenue.length - 1)) * (w - pad * 2);

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="rounded-2xl border border-hairline bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-foreground text-background">
                <TrendingUp className="h-3 w-3" />
              </span>
              Numbers · 12 months with ServiceOS
            </div>
            <h2 className="text-display mt-3 text-2xl font-semibold tracking-tight">
              The business, before and after.
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Every metric below is a like-for-like comparison · the three months before ServiceOS went live, against the latest run-rate today.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-hairline bg-surface-alt px-3 py-1.5 text-[11px] font-medium">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
            Live · refreshed hourly
          </div>
        </div>

        {/* Headline tiles */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {headline.map((k) => (
            <div key={k.l} className="rounded-xl border border-hairline bg-surface-alt p-4">
              <div className="flex h-5 items-center justify-between text-muted-foreground">
                <div className="text-[10px] font-medium uppercase tracking-wider">{k.l}</div>
                <k.icon className="h-3.5 w-3.5" />
              </div>
              <div className="text-display mt-3 h-8 text-2xl font-bold leading-none tabular text-foreground">{k.after}</div>
              <div className="mt-2 flex h-4 items-center justify-between text-[10px] leading-none">
                <span className="text-muted-foreground line-through">{k.before}</span>
                <span className="font-mono tabular text-success">{k.delta}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Trend chart */}
      <div className="rounded-2xl border border-hairline bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Revenue trajectory</div>
            <div className="text-display mt-1 text-lg font-semibold">From £188k/mo to £344k/mo.</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Margin climbed in lockstep · from 22% to 36% · as automation cut admin and procurement leakage.
            </p>
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-foreground" /> Revenue
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="h-2 w-0.5 bg-accent" /> ServiceOS live
            </span>
          </div>
        </div>

        <svg viewBox={`0 0 ${w} ${h}`} className="mt-5 w-full">
          <defs>
            <linearGradient id="numbers-grad" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g className="text-foreground">
            <path d={`${linePath} L${w - pad},${h - pad} L${pad},${h - pad} Z`} fill="url(#numbers-grad)" />
            <path d={linePath} fill="none" stroke="currentColor" strokeWidth="1.75" />
          </g>
          {/* deploy marker */}
          <line x1={deployX} x2={deployX} y1={pad} y2={h - pad} strokeDasharray="3 3" strokeWidth="1" className="text-accent" stroke="currentColor" />
          <circle cx={deployX} cy={pad + 4} r="3" className="fill-accent" />
        </svg>

        <div className="mt-2 flex justify-between font-mono text-[10px] text-muted-foreground">
          <span>M1</span><span>M3 · go-live</span><span>M6</span><span>M9</span><span>M12 · today</span>
        </div>
      </div>

      {/* Before / after table */}
      <div className="rounded-2xl border border-hairline bg-white">
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Operational gains</div>
            <div className="text-display mt-0.5 text-sm font-semibold">Where the lift actually came from</div>
          </div>
          <span className="rounded-full border border-success/20 bg-success/10 px-2.5 py-1 text-[10px] font-medium text-success">All metrics improved</span>
        </div>
        <div className="divide-y divide-hairline">
          {operational.map((o) => {
            return (
              <div key={o.l} className="grid grid-cols-12 items-center gap-3 px-5 py-3 text-sm">
                <div className="col-span-5 font-medium">{o.l}</div>
                <div className="col-span-3 font-mono text-xs tabular text-muted-foreground line-through">{o.before}</div>
                <div className="col-span-3 font-mono text-sm tabular font-semibold">{o.after}</div>
                <div className="col-span-1 flex justify-end">
                  <ArrowUpRight className={cn("h-4 w-4", o.tone === "success" ? "text-success" : "text-muted-foreground")} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Wins summary */}
      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
        {wins.map((w) => (
          <div key={w.l} className="rounded-2xl border border-hairline bg-white p-5">
            <div className="text-display text-3xl font-bold tabular text-foreground">{w.v}</div>
            <div className="mt-2 text-sm font-semibold">{w.l}</div>
            <div className="mt-1 text-xs leading-snug text-muted-foreground">{w.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ────── SETTINGS ────── */
function SettingsView() {
  return (
    <div className="space-y-5">
      <SystemsInventoryPanel />
      <div className="max-w-2xl space-y-3">
        {["Workspace", "Members & roles", "Integrations", "Security & audit", "Billing"].map((s) => (
          <div key={s} className="flex items-center justify-between rounded-2xl border border-hairline bg-white px-5 py-4 hover:bg-surface-alt">
            <div className="text-sm font-medium">{s}</div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ────── LEARN ────── */
type SourceTone = "success" | "warning" | "accent" | "muted";
type SourceDetail = {
  name: string;
  icon: typeof Phone;
  status: string;
  events: string;
  desc: string;
  tone: SourceTone;
  connection: string;
  lastSync: string;
  retention: string;
  coverage: number; // 0-100
  accuracy: number; // 0-100
  signals: { l: string; v: string; sub?: string }[];
  topics: { label: string; pct: number }[];
  insights: string[];
  automations: string[];
  privacy: string[];
};

const SOURCES: SourceDetail[] = [
  {
    name: "Phone Calls", icon: Phone, status: "Live", events: "1,284", tone: "success",
    desc: "Inbound · outbound · voicemail · transcripts",
    connection: "Twilio + ServiceOS Voice · 4 numbers", lastSync: "live · 12s ago",
    retention: "Transcripts 180d · audio 30d",
    coverage: 96, accuracy: 92,
    signals: [
      { l: "Calls captured (30d)", v: "1,284", sub: "↑ 14% vs prior" },
      { l: "Avg handle time", v: "4m 12s" },
      { l: "Voicemails transcribed", v: "318" },
      { l: "Sentiment flagged ↓", v: "47" },
    ],
    topics: [
      { label: "Booking / scheduling", pct: 38 },
      { label: "Quote follow-up", pct: 22 },
      { label: "Complaint / chase", pct: 17 },
      { label: "Engineer dispatch", pct: 14 },
      { label: "Account / billing", pct: 9 },
    ],
    insights: [
      "37% of complaint calls involve delayed post-visit comms",
      "11 callbacks last week never converted to a follow-up job (~£7,840)",
      "ABC School: 4 frustrated calls in 6 weeks · sentiment trending down",
    ],
    automations: [
      "Auto-draft visit summary SMS within 30 mins of engineer leaving site",
      "Trigger callback-SLA timer when caller leaves voicemail",
      "Escalate to account manager on 2+ negative-sentiment calls in 14d",
    ],
    privacy: ["PII redacted from transcripts", "Audio purged after 30 days", "Caller opt-out honoured"],
  },
  {
    name: "Email", icon: Mail, status: "Live", events: "8,412", tone: "success",
    desc: "office@ · invoicing@ · scheduling@",
    connection: "Google Workspace · 6 shared mailboxes", lastSync: "live · 4s ago",
    retention: "Bodies 365d · attachments referenced not stored",
    coverage: 99, accuracy: 94,
    signals: [
      { l: "Threads ingested (30d)", v: "8,412" },
      { l: "Avg first response", v: "1h 48m" },
      { l: "Quotes sent", v: "612" },
      { l: "Invoices emailed", v: "1,104" },
    ],
    topics: [
      { label: "Quotes & estimates", pct: 31 },
      { label: "Scheduling", pct: 24 },
      { label: "Invoice & payment", pct: 19 },
      { label: "Supplier comms", pct: 14 },
      { label: "Compliance docs", pct: 12 },
    ],
    insights: [
      "Quote → approval cycle averages 3.2 days; 41% slip past day 5",
      "18% of customer threads include a missed action by us",
      "Supplier ACME has 6 unanswered chase emails this month",
    ],
    automations: [
      "Auto-classify and route to correct queue (quote, invoice, support)",
      "Draft follow-up if customer hasn't replied to a quote in 72h",
      "Extract PO numbers + line items into Commusoft automatically",
    ],
    privacy: ["Mailbox-scoped access", "No personal inboxes ingested", "Attachments scanned in-place"],
  },
  {
    name: "Slack", icon: MessageSquare, status: "Live", events: "3,902", tone: "success",
    desc: "Operational channels · DMs · escalations",
    connection: "Slack workspace · 14 channels indexed", lastSync: "live · 2s ago",
    retention: "Messages 180d · files referenced",
    coverage: 88, accuracy: 90,
    signals: [
      { l: "Messages ingested", v: "3,902" },
      { l: "Escalations detected", v: "63" },
      { l: "Decisions captured", v: "118" },
      { l: "Action items extracted", v: "274" },
    ],
    topics: [
      { label: "#ops-dispatch", pct: 34 },
      { label: "#engineers", pct: 22 },
      { label: "#sales-pipeline", pct: 18 },
      { label: "#finance", pct: 14 },
      { label: "#leadership", pct: 12 },
    ],
    insights: [
      "63 escalations in #ops-dispatch last 30d - 22% lacked owner assignment",
      "Recurring 'parts shortage' theme across 3 channels",
      "Decisions made in Slack rarely propagated to Commusoft notes",
    ],
    automations: [
      "Auto-create Commusoft task from :rotating_light: emoji + mention",
      "Mirror Slack decisions into the relevant job/customer record",
      "Daily digest of unresolved escalations to ops lead",
    ],
    privacy: ["DMs excluded unless user opts in", "Bot messages filtered", "Channel-level allowlist"],
  },
  {
    name: "Commusoft", icon: Database, status: "Syncing", events: "12,640", tone: "success",
    desc: "Jobs · estimates · invoices · assets · PPM",
    connection: "Commusoft API · bi-directional", lastSync: "3m ago",
    retention: "Live mirror · change history 2y",
    coverage: 100, accuracy: 97,
    signals: [
      { l: "Records mirrored", v: "12,640" },
      { l: "Open jobs", v: "184" },
      { l: "PPM contracts", v: "92" },
      { l: "Assets tracked", v: "1,406" },
    ],
    topics: [
      { label: "Reactive jobs", pct: 46 },
      { label: "PPM visits", pct: 28 },
      { label: "Installs", pct: 14 },
      { label: "Quotes", pct: 12 },
    ],
    insights: [
      "Job notes consistently miss parts-used field on 22% of completed jobs",
      "PPM scheduling clusters in last week of month - capacity strain",
      "Engineer utilisation 71% - 14% lost to travel reschedules",
    ],
    automations: [
      "Auto-fill parts used from engineer voice note at job close",
      "Smooth PPM scheduling across the month using capacity model",
      "Flag stale 'awaiting parts' jobs after 5 days",
    ],
    privacy: ["Role-scoped reads", "PII never leaves Commusoft + ServiceOS", "Audit log on every write"],
  },
  {
    name: "QuickBooks", icon: Banknote, status: "Live", events: "4,118", tone: "success",
    desc: "Invoices · payments · debt · cash flow",
    connection: "QuickBooks Online · OAuth", lastSync: "8m ago",
    retention: "Live mirror · ledger snapshots daily",
    coverage: 100, accuracy: 99,
    signals: [
      { l: "Invoices (30d)", v: "1,104" },
      { l: "Overdue value", v: "£48.2k" },
      { l: "Avg days to pay", v: "31" },
      { l: "Credit notes", v: "12" },
    ],
    topics: [
      { label: "Invoiced revenue", pct: 62 },
      { label: "Aged debt 30+", pct: 18 },
      { label: "Supplier bills", pct: 14 },
      { label: "Credits / refunds", pct: 6 },
    ],
    insights: [
      "Top 3 debtors account for 54% of aged debt > 60d",
      "Invoices sent on Friday paid 4.2 days slower on average",
      "PPM customers pay 11 days faster than reactive - bias mix upward",
    ],
    automations: [
      "Auto-chase aged debt with tone tuned to customer history",
      "Match payments to invoices via reference + amount + customer",
      "Forecast 30/60/90 cash position daily",
    ],
    privacy: ["Read-only by default", "Writes require approval", "Books reconciled, never overwritten"],
  },
  {
    name: "Google Workspace", icon: Mail, status: "Live", events: "6,221", tone: "success",
    desc: "Calendar · contacts · shared drives",
    connection: "Google Workspace · domain-wide delegation", lastSync: "live",
    retention: "Calendar 365d · contacts mirrored",
    coverage: 97, accuracy: 95,
    signals: [
      { l: "Events captured", v: "4,118" },
      { l: "Engineers tracked", v: "11" },
      { l: "Contacts unified", v: "2,103" },
      { l: "Meeting summaries", v: "318" },
    ],
    topics: [
      { label: "Engineer dispatch", pct: 48 },
      { label: "Internal meetings", pct: 22 },
      { label: "Customer site visits", pct: 18 },
      { label: "Supplier calls", pct: 12 },
    ],
    insights: [
      "23% of engineer calendar slots overrun by > 30 mins",
      "Customer site visits without prep doc → 2.1× callback rate",
      "Internal meeting load peaked Wed 10-12 - automation candidates",
    ],
    automations: [
      "Auto-attach job brief + customer history to dispatch events",
      "Reflow engineer day when a visit overruns by 20+ mins",
      "Deduplicate contacts across Workspace + Commusoft",
    ],
    privacy: ["Calendar metadata only by default", "Personal events ignored", "Per-user opt-in for body capture"],
  },
  {
    name: "Google Drive", icon: HardDrive, status: "Indexing", events: "2,847", tone: "warning",
    desc: "Documents · supplier files · certificates",
    connection: "Shared drives · 6 root folders", lastSync: "indexing · 64% complete",
    retention: "Metadata + embeddings · file bodies fetched on demand",
    coverage: 64, accuracy: 88,
    signals: [
      { l: "Files indexed", v: "2,847" },
      { l: "Certificates extracted", v: "412" },
      { l: "Supplier price lists", v: "38" },
      { l: "Duplicates flagged", v: "190" },
    ],
    topics: [
      { label: "Certifications", pct: 32 },
      { label: "Supplier docs", pct: 26 },
      { label: "Customer quotes", pct: 22 },
      { label: "Internal SOPs", pct: 20 },
    ],
    insights: [
      "27 customer certificates expire within 60 days - none currently surfaced",
      "Supplier price lists out of sync with quoting templates",
      "Folder sprawl: 190 near-duplicate quote files identified",
    ],
    automations: [
      "Watch certificate expiry and auto-schedule renewals",
      "Sync supplier price list updates into quote builder",
      "Suggest canonical file when a near-duplicate is opened",
    ],
    privacy: ["Per-folder scope", "No personal Drive access", "Embeddings stored, file bodies not retained"],
  },
  {
    name: "Perplexity", icon: Brain, status: "Live", events: "184", tone: "success",
    desc: "Market · supplier · regulatory research",
    connection: "Perplexity API · scheduled + on-demand", lastSync: "today 06:00",
    retention: "Research briefs 365d · sources cited",
    coverage: 100, accuracy: 90,
    signals: [
      { l: "Briefs generated", v: "184" },
      { l: "Reg / standards watch", v: "12 topics" },
      { l: "Supplier scans", v: "46" },
      { l: "Market signals", v: "126" },
    ],
    topics: [
      { label: "Regulatory & compliance", pct: 34 },
      { label: "Supplier intelligence", pct: 28 },
      { label: "Competitor signals", pct: 22 },
      { label: "Market & pricing", pct: 16 },
    ],
    insights: [
      "Upcoming F-gas guidance change - affects 14 PPM contracts",
      "Two supplier price increases announced this week",
      "Competitor expanding into West London commercial segment",
    ],
    automations: [
      "Weekly compliance digest tailored to active service lines",
      "Alert when a tracked supplier publishes price / lead-time changes",
      "Brief the sales team on competitor moves in our patch",
    ],
    privacy: ["Outbound queries scrubbed of customer data", "Sources logged with every brief"],
  },
  {
    name: "Website Forms", icon: Globe, status: "Live", events: "342", tone: "success",
    desc: "Enquiries · booking · quote requests",
    connection: "drummonds.co.uk · 4 forms", lastSync: "live",
    retention: "Submissions 2y",
    coverage: 100, accuracy: 96,
    signals: [
      { l: "Submissions (30d)", v: "342" },
      { l: "Quote requests", v: "188" },
      { l: "Service bookings", v: "97" },
      { l: "Spam filtered", v: "1,204" },
    ],
    topics: [
      { label: "Boiler service", pct: 38 },
      { label: "Bathroom design", pct: 24 },
      { label: "Commercial enquiry", pct: 22 },
      { label: "Other", pct: 16 },
    ],
    insights: [
      "Avg time-to-first-response from form submit: 4h 12m - target 1h",
      "Mobile submissions convert 28% better when reply within 30 mins",
      "Commercial enquiries under-served vs domestic by 2.4× response time",
    ],
    automations: [
      "Auto-acknowledge + qualify enquiry within 60 seconds",
      "Route commercial enquiries to dedicated owner",
      "Pre-fill Commusoft lead from form fields",
    ],
    privacy: ["GDPR consent enforced", "Marketing tracking opt-in only"],
  },
  {
    name: "Desktop Workflow", icon: Monitor, status: "Learning", events: "21,408", tone: "accent",
    desc: "App usage · sequences · copy/paste · forms",
    connection: "ServiceOS Desktop Agent · 11 installs", lastSync: "live",
    retention: "Event metadata 90d · screenshots OCR'd then deleted",
    coverage: 78, accuracy: 86,
    signals: [
      { l: "Events captured", v: "21,408" },
      { l: "Distinct workflows", v: "412" },
      { l: "Repeatable sequences", v: "186" },
      { l: "Automation candidates", v: "12" },
    ],
    topics: [
      { label: "Commusoft data entry", pct: 36 },
      { label: "Quote prep (PDF + sheets)", pct: 24 },
      { label: "Email triage", pct: 18 },
      { label: "QuickBooks reconciliation", pct: 12 },
      { label: "File hunting in Drive", pct: 10 },
    ],
    insights: [
      "Supplier quote prep takes ~22 mins · 74% of steps repeatable",
      "Engineer job sheet → invoice path crosses 4 apps and 11 clicks",
      "Avg 38 mins/day/person spent searching for files",
    ],
    automations: [
      "Spin up Procurement Agent for supplier quote prep",
      "One-click 'job → invoice' macro across Commusoft + QuickBooks",
      "Suggest the right file based on the active customer context",
    ],
    privacy: ["Metadata-first", "Screenshots deleted post-OCR", "No keystroke logging", "Pause anytime"],
  },
  {
    name: "Documents & PDFs", icon: FileText, status: "Live", events: "1,920", tone: "success",
    desc: "Quotes · job sheets · certifications · OCR",
    connection: "Drive + email attachments + uploads", lastSync: "live",
    retention: "Extracted fields kept · originals referenced",
    coverage: 92, accuracy: 91,
    signals: [
      { l: "Docs processed", v: "1,920" },
      { l: "OCR pages", v: "8,140" },
      { l: "Fields extracted", v: "46,210" },
      { l: "Anomalies flagged", v: "84" },
    ],
    topics: [
      { label: "Job sheets", pct: 34 },
      { label: "Supplier invoices", pct: 26 },
      { label: "Certifications", pct: 22 },
      { label: "Customer quotes", pct: 18 },
    ],
    insights: [
      "Supplier invoices vary line-item formatting in 38% of cases",
      "Certification PDFs missing engineer signature in 6% of files",
      "Quote templates drifted across 4 variants this quarter",
    ],
    automations: [
      "Auto-extract line items from supplier invoices into QuickBooks",
      "Block job-close if certification doc is unsigned",
      "Consolidate quote templates to single canonical version",
    ],
    privacy: ["OCR on-platform", "No third-party doc AI by default"],
  },
  {
    name: "IoT Telemetry", icon: Radio, status: "Planned", events: "-", tone: "muted",
    desc: "Boilers · sensors · fault codes · energy",
    connection: "Not yet connected", lastSync: "-",
    retention: "Planned: 365d telemetry · fault events permanent",
    coverage: 0, accuracy: 0,
    signals: [
      { l: "Assets eligible", v: "412" },
      { l: "Vendor protocols", v: "BACnet · Modbus · OEM cloud" },
      { l: "Pilot sites", v: "0" },
      { l: "Go-live target", v: "Q3" },
    ],
    topics: [
      { label: "Boiler fault codes", pct: 45 },
      { label: "Energy / efficiency", pct: 30 },
      { label: "Occupancy / usage", pct: 15 },
      { label: "Water / leak", pct: 10 },
    ],
    insights: [
      "Predictive maintenance candidate: 92 boilers across 14 sites",
      "Expected 18-25% reduction in reactive callouts once live",
      "Energy benchmarking unlocks ESG reporting for commercial clients",
    ],
    automations: [
      "Open job automatically on fault code with engineer match",
      "Suppress nuisance alarms via learned thresholds",
      "Surface efficiency trend in customer review pack",
    ],
    privacy: ["Customer opt-in per site", "Data minimisation by default"],
  },
];

function Learn() {
  const [openSource, setOpenSource] = useState<SourceDetail | null>(null);
  const sources = SOURCES;

  

  const insights = [
    { icon: AlertTriangle, tone: "warning", title: "Delayed post-visit comms", body: "37% of complaint calls in the last 14 days involve delayed communication after engineer visits.", action: "Auto-send visit summary within 30 mins" },
    { icon: TrendingUp, tone: "accent", title: "Quote → Approval bottleneck", body: "Supplier quote prep takes ~22 mins on average across 184 observations. 74% of steps are repeatable.", action: "Spin up Procurement Agent" },
    { icon: CheckCircle2, tone: "success", title: "Missed revenue detection", body: "11 callbacks last week never converted to a follow-up job. Estimated value £7,840.", action: "Add callback SLA + reminder" },
    { icon: Brain, tone: "accent", title: "Customer risk pattern", body: "ABC School · 4 frustrated calls in 6 weeks. Sentiment trending down.", action: "Flag for account manager review" },
  ];

  const workflows = [
    { name: "Supplier quote preparation", obs: 184, save: 74 },
    { name: "Engineer job sheet → invoice", obs: 412, save: 58 },
    { name: "Customer follow-up", obs: 246, save: 82 },
    { name: "PPM scheduling", obs: 96, save: 67 },
  ];


  return (
    <div className="space-y-6">
      {/* Hero / Company health */}
      <div className="grid gap-3 md:grid-cols-12">
        <div className="rounded-2xl border border-hairline bg-white p-6 md:col-span-7">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" /> Company Health · synthesised from all inputs
          </div>
          <div className="text-display mt-4 flex items-baseline gap-3 text-5xl font-bold tabular">
            87<span className="text-xl font-medium text-muted-foreground">/ 100</span>
          </div>
          <div className="mt-2 text-sm text-muted-foreground">Strong operational signal · 3 risks tracked · 12 automation candidates</div>
          <div className="mt-5 grid grid-cols-4 gap-3 text-xs">
            {[
              { l: "Ops", v: 92 },
              { l: "Finance", v: 88 },
              { l: "Customer", v: 81 },
              { l: "Compliance", v: 94 },
            ].map((x) => (
              <div key={x.l}>
                <div className="text-muted-foreground">{x.l}</div>
                <div className="mt-1 h-1 rounded-full bg-hairline">
                  <div className="h-full rounded-full bg-foreground" style={{ width: `${x.v}%` }} />
                </div>
                <div className="mt-1 font-mono tabular">{x.v}</div>
              </div>
            ))}
          </div>
        </div>


        <div className="rounded-2xl border border-hairline bg-white p-6 md:col-span-5">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Learning state</div>
          <div className="text-display mt-3 text-2xl font-semibold">Actively learning</div>
          <div className="mt-1 text-xs text-muted-foreground">Week 3 of 4 · desktop + voice + comms active</div>
          <div className="mt-5 space-y-3">
            {[
              { l: "Signals captured", v: "63,290", sub: "last 30 days" },
              { l: "Workflows reconstructed", v: "412", sub: "across 11 staff" },
              { l: "Automation candidates", v: "12", sub: "ROI > 60%" },
            ].map((x) => (
              <div key={x.l} className="flex items-baseline justify-between border-b border-hairline pb-2 last:border-0">
                <div>
                  <div className="text-sm font-medium">{x.l}</div>
                  <div className="text-[11px] text-muted-foreground">{x.sub}</div>
                </div>
                <div className="text-display text-xl font-bold tabular">{x.v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>




      {/* Inputs grid */}
      <div>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <div className="text-display text-lg font-semibold">Capture Layer · learning inputs</div>
            <div className="text-xs text-muted-foreground">Every operational signal flowing into ServiceOS</div>
          </div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{sources.length} sources</div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {sources.map((s) => (
            <button
              type="button"
              key={s.name}
              onClick={() => setOpenSource(s)}
              className="rounded-2xl border border-hairline bg-white p-4 text-left transition hover:border-foreground/30 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
            >

              <div className="flex items-start justify-between">
                <div className={cn(
                  "grid h-9 w-9 place-items-center rounded-lg",
                  s.tone === "muted" ? "bg-surface-alt text-muted-foreground" : "bg-foreground text-background",
                )}>
                  <s.icon className="h-4 w-4" />
                </div>
                <span className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                  s.tone === "success" && "bg-success/10 text-success",
                  s.tone === "warning" && "bg-warning/10 text-warning",
                  s.tone === "accent" && "bg-accent/10 text-accent",
                  s.tone === "muted" && "bg-surface-alt text-muted-foreground",
                )}>
                  {s.tone !== "muted" && <span className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    s.tone === "success" && "bg-success animate-pulse",
                    s.tone === "warning" && "bg-warning",
                    s.tone === "accent" && "bg-accent animate-pulse",
                  )} />}
                  {s.status}
                </span>
              </div>
              <div className="text-display mt-4 text-sm font-semibold">{s.name}</div>
              <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{s.desc}</div>
              <div className="mt-3 flex items-baseline justify-between border-t border-hairline pt-3">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Events 30d</span>
                <span className="font-mono text-sm tabular">{s.events}</span>
              </div>
            </button>
          ))}

        </div>
      </div>

      {/* Insights + workflows */}
      <div className="grid gap-3 md:grid-cols-12">
        <div className="md:col-span-7">
          <div className="mb-3 text-display text-lg font-semibold">What the system has learned</div>
          <div className="space-y-3">
            {insights.map((i) => (
              <div key={i.title} className="rounded-2xl border border-hairline bg-white p-5">
                <div className="flex items-start gap-3">
                  <div className={cn(
                    "grid h-9 w-9 shrink-0 place-items-center rounded-lg",
                    i.tone === "warning" && "bg-warning/10 text-warning",
                    i.tone === "accent" && "bg-accent/10 text-accent",
                    i.tone === "success" && "bg-success/10 text-success",
                  )}>
                    <i.icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{i.title}</div>
                    <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{i.body}</div>
                    <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-hairline px-2.5 py-1 text-[11px] font-medium">
                      <Sparkles className="h-3 w-3 text-accent" />
                      {i.action}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="md:col-span-5">
          <div className="mb-3 text-display text-lg font-semibold">Reconstructed workflows</div>
          <div className="space-y-3">
            {workflows.map((w) => (
              <div key={w.name} className="rounded-2xl border border-hairline bg-white p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">{w.name}</div>
                  <span className="text-display text-lg font-bold tabular text-accent">{w.save}%</span>
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">{w.obs} observations · automatable</div>
                <div className="mt-3 h-1.5 rounded-full bg-surface-alt">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${w.save}%` }} />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 rounded-2xl border border-hairline bg-surface-alt p-4">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Privacy posture</div>
            <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
              <li className="flex gap-2"><CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" /> Metadata-first capture</li>
              <li className="flex gap-2"><CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" /> Screenshots deleted after OCR</li>
              <li className="flex gap-2"><CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" /> No keystroke logging</li>
              <li className="flex gap-2"><CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" /> Learning mode · pausable</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Source detail modal */}
      <Dialog open={!!openSource} onOpenChange={(o) => !o && setOpenSource(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto bg-white">
          {openSource && (
            <>
              <DialogHeader>
                <div className="flex items-start gap-3">
                  <div className={cn(
                    "grid h-11 w-11 place-items-center rounded-xl",
                    openSource.tone === "muted" ? "bg-surface-alt text-muted-foreground" : "bg-foreground text-background",
                  )}>
                    <openSource.icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <DialogTitle className="text-display text-xl font-semibold">{openSource.name}</DialogTitle>
                    <DialogDescription className="mt-1 text-xs">{openSource.desc}</DialogDescription>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                      <span className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium uppercase tracking-wider",
                        openSource.tone === "success" && "bg-success/10 text-success",
                        openSource.tone === "warning" && "bg-warning/10 text-warning",
                        openSource.tone === "accent" && "bg-accent/10 text-accent",
                        openSource.tone === "muted" && "bg-surface-alt text-muted-foreground",
                      )}>{openSource.status}</span>
                      <span className="text-muted-foreground">· {openSource.connection}</span>
                      <span className="text-muted-foreground">· Last sync {openSource.lastSync}</span>
                    </div>
                  </div>
                </div>
              </DialogHeader>

              {/* Signal grid */}
              <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                {openSource.signals.map((sig) => (
                  <div key={sig.l} className="rounded-xl border border-hairline bg-surface-alt p-3">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{sig.l}</div>
                    <div className="text-display mt-1 text-lg font-bold tabular">{sig.v}</div>
                    {sig.sub && <div className="text-[10px] text-muted-foreground">{sig.sub}</div>}
                  </div>
                ))}
              </div>

              {/* Coverage + accuracy */}
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {[
                  { l: "Coverage", v: openSource.coverage },
                  { l: "Extraction accuracy", v: openSource.accuracy },
                ].map((m) => (
                  <div key={m.l} className="rounded-xl border border-hairline p-3">
                    <div className="flex items-baseline justify-between">
                      <div className="text-xs font-medium">{m.l}</div>
                      <div className="font-mono text-sm tabular">{m.v}%</div>
                    </div>
                    <div className="mt-2 h-1.5 rounded-full bg-hairline">
                      <div className="h-full rounded-full bg-foreground" style={{ width: `${m.v}%` }} />
                    </div>
                  </div>
                ))}
              </div>

              {/* Topics */}
              <div className="mt-4 rounded-xl border border-hairline p-4">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">What we're seeing</div>
                <div className="mt-3 space-y-2">
                  {openSource.topics.map((t) => (
                    <div key={t.label}>
                      <div className="flex items-baseline justify-between text-xs">
                        <span className="font-medium">{t.label}</span>
                        <span className="font-mono tabular text-muted-foreground">{t.pct}%</span>
                      </div>
                      <div className="mt-1 h-1 rounded-full bg-hairline">
                        <div className="h-full rounded-full bg-accent" style={{ width: `${t.pct}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Insights + automations */}
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-hairline p-4">
                  <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <Brain className="h-3 w-3" /> Intelligence learned
                  </div>
                  <ul className="mt-2 space-y-2 text-xs leading-relaxed">
                    {openSource.insights.map((i) => (
                      <li key={i} className="flex gap-2">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-foreground" />
                        <span>{i}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-xl border border-hairline bg-surface-alt p-4">
                  <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <Sparkles className="h-3 w-3 text-accent" /> Automation candidates
                  </div>
                  <ul className="mt-2 space-y-2 text-xs leading-relaxed">
                    {openSource.automations.map((a) => (
                      <li key={a} className="flex gap-2">
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                        <span>{a}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Privacy + retention */}
              <div className="mt-4 rounded-xl border border-hairline p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Privacy & retention</div>
                  <div className="text-[11px] text-muted-foreground">{openSource.retention}</div>
                </div>
                <ul className="mt-2 flex flex-wrap gap-2 text-[11px]">
                  {openSource.privacy.map((p) => (
                    <li key={p} className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-2.5 py-1">
                      <CheckCircle2 className="h-3 w-3 text-success" /> {p}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}



/* ────── INTELLIGENCE ────── */
type Pillar = "ops" | "finance" | "customer" | "compliance";

type Upgrade = {
  id: string;
  pillar: Pillar;
  title: string;
  insight: string;            // what we observed
  recommendation: string;     // what to do
  via: "Automation" | "AI Agent" | "ServiceOS Workflow" | "Voice AI" | "Process Change";
  effort: "Low" | "Med" | "High";
  confidence: number;         // 0-100
  uplift: {
    timeSaved?: string;
    profit?: string;
    turnover?: string;
    csat?: string;
    risk?: string;
  };
  sources: string[];
  status: "ready" | "draft" | "review";
};

const PILLARS: { key: Pillar; label: string; icon: typeof Brain; tone: string; desc: string }[] = [
  { key: "ops", label: "Operations", icon: Workflow, tone: "accent", desc: "Time, throughput, engineer utilisation" },
  { key: "finance", label: "Finance", icon: Banknote, tone: "success", desc: "Cash, margin, debt, forecasting" },
  { key: "customer", label: "Customer", icon: Brain, tone: "warning", desc: "Sentiment, retention, CSAT, NPS" },
  { key: "compliance", label: "Compliance", icon: ShieldCheck, tone: "muted", desc: "Certifications, audit, safety" },
];

const PILLAR_HEALTH: Record<Pillar, { score: number; trend: string; openUpgrades: number; potential: string }> = {
  ops:        { score: 81, trend: "+3 vs last wk", openUpgrades: 6, potential: "~32 hrs/wk saved" },
  finance:    { score: 88, trend: "+2 vs last wk", openUpgrades: 4, potential: "£48k cash unlocked" },
  customer:   { score: 76, trend: "−2 vs last wk", openUpgrades: 5, potential: "+8pt CSAT" },
  compliance: { score: 94, trend: "stable",         openUpgrades: 3, potential: "0 audit gaps" },
};

const UPGRADES: Upgrade[] = [
  {
    id: "u1", pillar: "ops",
    title: "Auto-triage Monday voicemail before 09:00",
    insight: "34% of Monday jobs overran > 30 mins · correlates with untriaged weekend voicemail",
    recommendation: "Reception Agent classifies + drafts callbacks at 07:30 Monday so dispatch starts from a clean board",
    via: "AI Agent", effort: "Low", confidence: 88,
    uplift: { timeSaved: "9 hrs/wk", profit: "+£4.2k/mo", csat: "+4pt" },
    sources: ["Phone Calls", "Calendar", "Commusoft"], status: "ready",
  },
  {
    id: "u2", pillar: "ops",
    title: "Procurement Agent for supplier quote prep",
    insight: "22 mins avg across 184 obs · 74% deterministic steps across 3 apps",
    recommendation: "Spin up Procurement Agent in draft mode · gather pricing, normalise SKUs, pre-fill quote",
    via: "AI Agent", effort: "Med", confidence: 91,
    uplift: { timeSaved: "14 hrs/wk", profit: "+£2.8k/mo", turnover: "+6% quote velocity" },
    sources: ["Desktop Workflow", "Email", "Drive"], status: "ready",
  },
  {
    id: "u3", pillar: "ops",
    title: "One-click 'job → invoice' across Commusoft + QuickBooks",
    insight: "Path crosses 4 apps and 11 clicks · runs 412×/month per engineer cohort",
    recommendation: "ServiceOS workflow stitches the path; engineer signs off, invoice issues automatically",
    via: "ServiceOS Workflow", effort: "Low", confidence: 95,
    uplift: { timeSaved: "11 hrs/wk", profit: "+£1.9k/mo", turnover: "Invoice day −2.4d" },
    sources: ["Commusoft", "QuickBooks", "Desktop Workflow"], status: "draft",
  },
  {
    id: "u4", pillar: "finance",
    title: "Tone-aware aged debt chase",
    insight: "Top 3 debtors = 54% of >60d debt · two unanswered chases > 14 days",
    recommendation: "Finance Agent runs personalised chase cadence; escalates after 2 ignored steps",
    via: "AI Agent", effort: "Low", confidence: 96,
    uplift: { profit: "+£26.1k cash", turnover: "DSO −9 days" },
    sources: ["QuickBooks", "Email"], status: "ready",
  },
  {
    id: "u5", pillar: "finance",
    title: "Shift invoice-send to Tue/Wed",
    insight: "Friday invoices paid 4.2d slower on average",
    recommendation: "Workflow change: schedule invoice send mid-week unless customer explicitly prefers Friday",
    via: "Process Change", effort: "Low", confidence: 84,
    uplift: { profit: "+£3.4k/mo cashflow", turnover: "DSO −2 days" },
    sources: ["QuickBooks"], status: "ready",
  },
  {
    id: "u6", pillar: "finance",
    title: "Daily 30/60/90 cash forecast",
    insight: "No live cash position · finance reviews weekly",
    recommendation: "ServiceOS auto-publishes morning cash + pipeline-weighted forecast to leadership",
    via: "ServiceOS Workflow", effort: "Low", confidence: 92,
    uplift: { profit: "Earlier decisions", risk: "−1 surprise/qtr" },
    sources: ["QuickBooks", "Commusoft"], status: "draft",
  },
  {
    id: "u7", pillar: "customer",
    title: "30-min post-visit summary SMS + email",
    insight: "37% of complaint calls in 14d involve delayed post-visit comms",
    recommendation: "Voice AI summarises engineer notes + sends visit summary within 30 mins of job close",
    via: "Voice AI", effort: "Low", confidence: 92,
    uplift: { csat: "+9pt", timeSaved: "4 hrs/wk", risk: "−40% complaint volume" },
    sources: ["Phone Calls", "Commusoft"], status: "ready",
  },
  {
    id: "u8", pillar: "customer",
    title: "Account-risk alerts for sentiment drift",
    insight: "ABC School · 4 frustrated calls in 6 wks · tone score 0.62→0.21",
    recommendation: "Customer Care Agent flags accounts on 2+ negative signals in 14d · books review call",
    via: "AI Agent", effort: "Low", confidence: 84,
    uplift: { turnover: "Protect £18k contract", csat: "+5pt" },
    sources: ["Phone Calls", "Email", "Commusoft"], status: "ready",
  },
  {
    id: "u9", pillar: "customer",
    title: "Sub-60s acknowledge for web enquiries",
    insight: "Avg first-response 4h 12m · mobile converts 28% better when replied < 30 mins",
    recommendation: "Inbox Agent auto-acknowledges + qualifies enquiry within 60s · routes to right owner",
    via: "AI Agent", effort: "Low", confidence: 90,
    uplift: { turnover: "+12% web conversion", csat: "+6pt" },
    sources: ["Website Forms", "Email"], status: "ready",
  },
  {
    id: "u10", pillar: "customer",
    title: "Missed callback recovery SLA",
    insight: "11 callbacks last wk never converted · est. £7,840 value",
    recommendation: "Auto-create callback task with 4-hour SLA + reminder · escalates after breach",
    via: "Automation", effort: "Low", confidence: 82,
    uplift: { turnover: "+£7.8k/wk recovered", csat: "+3pt" },
    sources: ["Phone Calls", "Commusoft"], status: "ready",
  },
  {
    id: "u11", pillar: "compliance",
    title: "Certification expiry → auto-scheduled renewals",
    insight: "27 customer certs expire in 60d across 19 sites · none surfaced in Commusoft",
    recommendation: "Compliance Agent watches expiry · auto-books renewal visit + notifies customer",
    via: "AI Agent", effort: "Low", confidence: 98,
    uplift: { turnover: "Renewal revenue captured", risk: "0 audit gaps" },
    sources: ["Google Drive", "Commusoft"], status: "ready",
  },
  {
    id: "u12", pillar: "compliance",
    title: "Block job-close on missing signatures",
    insight: "6% of cert PDFs missing engineer signature at close",
    recommendation: "Workflow: job cannot be marked complete until required cert + sig present",
    via: "ServiceOS Workflow", effort: "Low", confidence: 95,
    uplift: { risk: "−100% missing-sig defect", csat: "+2pt" },
    sources: ["Documents", "Commusoft"], status: "draft",
  },
  {
    id: "u13", pillar: "ops",
    title: "PPM scheduling smoothing across the month",
    insight: "PPM clusters in last week of month · capacity strain + travel reschedules",
    recommendation: "Scheduling Agent reflows PPM evenly using engineer capacity model",
    via: "AI Agent", effort: "Med", confidence: 78,
    uplift: { timeSaved: "6 hrs/wk", profit: "+£1.6k/mo utilisation", csat: "+3pt" },
    sources: ["Calendar", "Commusoft"], status: "review",
  },
];

function Intelligence() {
  const [pillar, setPillar] = useState<"all" | Pillar>("all");
  const [via, setVia] = useState<"all" | Upgrade["via"]>("all");
  const [open, setOpen] = useState<Upgrade | null>(null);

  const filtered = UPGRADES.filter(
    (u) => (pillar === "all" || u.pillar === pillar) && (via === "all" || u.via === via),
  ).sort((a, b) => b.confidence - a.confidence);

  const totals = {
    upgrades: UPGRADES.length,
    time: "44 hrs/wk",
    profit: "+£14.2k/mo",
    turnover: "+£42k/qtr",
    csat: "+8pt",
  };

  const viaOptions: ("all" | Upgrade["via"])[] = ["all", "AI Agent", "Automation", "ServiceOS Workflow", "Voice AI", "Process Change"];

  const statTiles = [
    { l: "Open upgrades", v: String(totals.upgrades), sub: "across 4 pillars", icon: Sparkles },
    { l: "Time saved", v: totals.time, sub: "if all shipped", icon: Clock },
    { l: "Profit uplift", v: totals.profit, sub: "monthly run-rate", icon: TrendingUp },
    { l: "Turnover uplift", v: totals.turnover, sub: "quarterly", icon: ArrowUpRight },
    { l: "CSAT uplift", v: totals.csat, sub: "rolling 60d", icon: Brain },
  ];

  return (
    <div className="space-y-6">
      {/* Hero · projected uplift */}
      <div className="rounded-2xl border border-hairline bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-foreground text-background">
                <Brain className="h-3 w-3" />
              </span>
              Intelligence · active recommendations
            </div>
            <h2 className="text-display mt-3 text-2xl font-semibold tracking-tight">
              Performance upgrades, synthesised from everything ServiceOS sees.
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Click any upgrade to see the full recommendation, projected impact and the path to shipping it.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-hairline bg-surface-alt px-3 py-1.5 text-[11px] font-medium">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
            Always listening · always learning
          </div>
        </div>

        {/* Aligned stat row · labels, numbers and subs sit on the same baselines */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {statTiles.map((k) => (
            <div key={k.l} className="rounded-xl border border-hairline bg-surface-alt p-4">
              <div className="flex h-5 items-center justify-between text-muted-foreground">
                <div className="text-[10px] font-medium uppercase tracking-wider">{k.l}</div>
                <k.icon className="h-3.5 w-3.5" />
              </div>
              <div className="text-display mt-3 h-8 text-2xl font-bold leading-none tabular text-foreground">{k.v}</div>
              <div className="mt-2 h-4 text-[10px] leading-none text-muted-foreground">{k.sub}</div>
            </div>
          ))}
        </div>
      </div>


      {/* Pillar score infographic */}
      <div className="rounded-2xl border border-hairline bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">How the pillar score works</div>
            <div className="text-display mt-1 text-lg font-semibold">0-100 health rating, recalculated hourly.</div>
            <p className="mt-1 text-xs text-muted-foreground">
              ServiceOS blends live signals - throughput, cash flow, sentiment, audit gaps - into one score so you can see, at a glance, where the business is strong and where upgrades will have the biggest impact.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { band: "0-49", label: "At risk", tone: "bg-destructive/10 text-destructive border-destructive/20" },
              { band: "50-69", label: "Needs work", tone: "bg-warning/10 text-warning border-warning/20" },
              { band: "70-84", label: "Healthy", tone: "bg-accent/10 text-accent border-accent/20" },
              { band: "85-100", label: "Excellent", tone: "bg-success/10 text-success border-success/20" },
            ].map((b) => (
              <div key={b.band} className={cn("rounded-lg border px-3 py-2", b.tone)}>
                <div className="text-display text-sm font-bold tabular">{b.band}</div>
                <div className="text-[10px] uppercase tracking-wider opacity-80">{b.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Spectrum bar with pillar markers */}
        <div className="mt-5">
          <div className="relative h-2 w-full rounded-full bg-gradient-to-r from-destructive/40 via-warning/40 via-accent/40 to-success/60">
            {PILLARS.map((p) => {
              const score = PILLAR_HEALTH[p.key].score;
              return (
                <div
                  key={p.key}
                  className="absolute -top-1.5 -translate-x-1/2"
                  style={{ left: `${score}%` }}
                  title={`${p.label} · ${score}`}
                >
                  <div className="h-5 w-0.5 bg-foreground" />
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
            {PILLARS.map((p) => (
              <div key={p.key} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-foreground" />
                <span className="font-medium text-foreground">{p.label}</span>
                <span className="tabular">{PILLAR_HEALTH[p.key].score}</span>
              </div>
            ))}
            <div className="ml-auto flex items-center gap-3">
              <span>Inputs:</span>
              <span>· Live telemetry</span>
              <span>· Job + finance data</span>
              <span>· Customer signals</span>
              <span>· Compliance feeds</span>
            </div>
          </div>
        </div>
      </div>

      {/* Pillar health · breathing room, consistent baselines */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PILLARS.map((p) => {
          const h = PILLAR_HEALTH[p.key];
          const active = pillar === p.key;
          return (
            <button
              key={p.key}
              onClick={() => setPillar(active ? "all" : p.key)}
              className={cn(
                "flex flex-col rounded-2xl border bg-white p-5 text-left transition hover:border-foreground/30 hover:shadow-sm",
                active ? "border-foreground" : "border-hairline",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <span className={cn(
                  "grid h-9 w-9 shrink-0 place-items-center rounded-lg",
                  p.tone === "accent" && "bg-accent/10 text-accent",
                  p.tone === "success" && "bg-success/10 text-success",
                  p.tone === "warning" && "bg-warning/10 text-warning",
                  p.tone === "muted" && "bg-surface-alt text-muted-foreground",
                )}>
                  <p.icon className="h-4 w-4" />
                </span>
                <div className="text-display text-2xl font-bold leading-none tabular">{h.score}</div>
              </div>
              <div className="mt-4 text-sm font-semibold">{p.label}</div>
              <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{p.desc}</div>
              <div className="mt-4 flex items-center justify-between border-t border-hairline pt-3 text-[11px]">
                <span className="text-muted-foreground">{h.openUpgrades} upgrades</span>
                <span className="font-medium">{h.potential}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-display text-lg font-semibold">Recommended performance upgrades</div>
          <div className="text-xs text-muted-foreground">
            Ranked by confidence · {filtered.length} matching {pillar === "all" ? "all pillars" : pillar}{via !== "all" && ` · ${via}`}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-full border border-hairline bg-white p-1 text-[11px]">
            {(["all", "ops", "finance", "customer", "compliance"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setPillar(t)}
                className={cn(
                  "rounded-full px-2.5 py-1 capitalize transition",
                  pillar === t ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="flex gap-1 rounded-full border border-hairline bg-white p-1 text-[11px]">
            {viaOptions.map((v) => (
              <button
                key={v}
                onClick={() => setVia(v)}
                className={cn(
                  "rounded-full px-2.5 py-1 transition",
                  via === v ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {v === "all" ? "All delivery" : v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Upgrade cards · compact summary, click for full detail */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((u) => {
          const pillarMeta = PILLARS.find((p) => p.key === u.pillar)!;
          const headline = u.uplift.profit
            ? { label: "Profit", value: u.uplift.profit, tone: "text-success" }
            : u.uplift.turnover
            ? { label: "Turnover", value: u.uplift.turnover, tone: "text-accent" }
            : u.uplift.timeSaved
            ? { label: "Time saved", value: u.uplift.timeSaved, tone: "text-foreground" }
            : u.uplift.csat
            ? { label: "CSAT", value: u.uplift.csat, tone: "text-warning" }
            : { label: "Risk", value: u.uplift.risk ?? "-", tone: "text-muted-foreground" };
          return (
            <button
              key={u.id}
              onClick={() => setOpen(u)}
              className="group flex flex-col rounded-2xl border border-hairline bg-white p-5 text-left transition hover:border-foreground/30 hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <span className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider",
                  pillarMeta.tone === "accent" && "bg-accent/10 text-accent",
                  pillarMeta.tone === "success" && "bg-success/10 text-success",
                  pillarMeta.tone === "warning" && "bg-warning/10 text-warning",
                  pillarMeta.tone === "muted" && "bg-surface-alt text-muted-foreground",
                )}>
                  <pillarMeta.icon className="h-3 w-3" /> {pillarMeta.label}
                </span>
                <span className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider",
                  u.status === "ready" && "bg-success/10 text-success",
                  u.status === "draft" && "bg-accent/10 text-accent",
                  u.status === "review" && "bg-surface-alt text-muted-foreground",
                )}>{u.status}</span>
              </div>

              <div className="text-display mt-4 text-base font-semibold leading-snug">{u.title}</div>
              <div className="mt-1 text-xs text-muted-foreground">via {u.via}</div>

              <div className="mt-5 flex items-end justify-between border-t border-hairline pt-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{headline.label}</div>
                  <div className={cn("text-display text-lg font-bold tabular leading-none", headline.tone)}>{headline.value}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Confidence</div>
                  <div className="font-mono text-sm font-semibold tabular leading-none">{u.confidence}%</div>
                </div>
              </div>

              <div className="mt-4 inline-flex items-center gap-1 text-[11px] font-medium text-foreground/70 group-hover:text-foreground">
                Open full recommendation <ChevronRight className="h-3 w-3" />
              </div>
            </button>
          );
        })}
      </div>

      {/* Upgrade detail modal */}
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-2xl">
          {open && (() => {
            const pillarMeta = PILLARS.find((p) => p.key === open.pillar)!;
            return (
              <div>
                <DialogHeader>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider",
                      pillarMeta.tone === "accent" && "bg-accent/10 text-accent",
                      pillarMeta.tone === "success" && "bg-success/10 text-success",
                      pillarMeta.tone === "warning" && "bg-warning/10 text-warning",
                      pillarMeta.tone === "muted" && "bg-surface-alt text-muted-foreground",
                    )}>
                      <pillarMeta.icon className="h-3 w-3" /> {pillarMeta.label}
                    </span>
                    <span className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider",
                      open.status === "ready" && "bg-success/10 text-success",
                      open.status === "draft" && "bg-accent/10 text-accent",
                      open.status === "review" && "bg-surface-alt text-muted-foreground",
                    )}>{open.status}</span>
                  </div>
                  <DialogTitle className="text-display mt-2 text-xl font-semibold leading-snug">{open.title}</DialogTitle>
                  <DialogDescription className="text-xs">Delivered via {open.via} · effort {open.effort} · confidence {open.confidence}%</DialogDescription>
                </DialogHeader>

                <div className="mt-4 space-y-4 text-sm">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">What we observed</div>
                    <p className="mt-1 leading-relaxed text-foreground/80">{open.insight}</p>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Recommendation</div>
                    <p className="mt-1 leading-relaxed">{open.recommendation}</p>
                  </div>

                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Projected uplift</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {open.uplift.timeSaved && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-surface-alt px-2 py-0.5 text-[11px]">
                          <Clock className="h-3 w-3" /> {open.uplift.timeSaved}
                        </span>
                      )}
                      {open.uplift.profit && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] text-success">
                          <Banknote className="h-3 w-3" /> Profit {open.uplift.profit}
                        </span>
                      )}
                      {open.uplift.turnover && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] text-accent">
                          <TrendingUp className="h-3 w-3" /> Turnover {open.uplift.turnover}
                        </span>
                      )}
                      {open.uplift.csat && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[11px] text-warning">
                          <Brain className="h-3 w-3" /> CSAT {open.uplift.csat}
                        </span>
                      )}
                      {open.uplift.risk && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-hairline px-2 py-0.5 text-[11px] text-muted-foreground">
                          <ShieldCheck className="h-3 w-3" /> Risk {open.uplift.risk}
                        </span>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Confidence</div>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1.5 flex-1 rounded-full bg-hairline">
                        <div className="h-full rounded-full bg-foreground" style={{ width: `${open.confidence}%` }} />
                      </div>
                      <span className="font-mono text-xs tabular">{open.confidence}%</span>
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Signal sources</div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {open.sources.map((s) => (
                        <span key={s} className="rounded-full bg-surface-alt px-2 py-0.5 text-[11px] text-muted-foreground">{s}</span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-hairline pt-4">
                  <button onClick={() => setOpen(null)} className="rounded-full border border-hairline px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
                    Close
                  </button>
                  <button className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-1.5 text-xs font-medium text-background">
                    <Sparkles className="h-3 w-3" /> Ship upgrade
                  </button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}


/* ────── AUTOMATIONS ────── */
type AutoCat = "ops" | "finance" | "customer" | "compliance" | "cross";
type AutoStatus = "live" | "draft" | "paused" | "review";
type AutoSource = "Intelligence" | "User-built" | "ServiceOS template";

type AutomationItem = {
  id: string;
  name: string;
  cat: AutoCat;
  status: AutoStatus;
  source: AutoSource;
  desc: string;
  trigger: string;
  actions: string[];
  health: number;          // 0-100
  runs7d: number;
  successRate: number;     // 0-100
  lastRun: string;
  impact: string;
  owner: string;
};

const AUTO_CATS: { key: AutoCat; label: string; icon: typeof Brain; tone: string }[] = [
  { key: "ops",        label: "Operations", icon: Workflow,    tone: "accent" },
  { key: "finance",    label: "Finance",    icon: Banknote,    tone: "success" },
  { key: "customer",   label: "Customer",   icon: MessageSquare, tone: "warning" },
  { key: "compliance", label: "Compliance", icon: ShieldCheck, tone: "muted" },
  { key: "cross",      label: "Cross-cutting", icon: Network,   tone: "muted" },
];

const AUTOMATIONS: AutomationItem[] = [
  { id: "a1", name: "Monday voicemail auto-triage", cat: "ops", status: "live", source: "Intelligence",
    desc: "Classify weekend voicemails, draft callbacks, hand dispatch a clean board by 08:00.",
    trigger: "Mon 07:30 · new voicemails", actions: ["Transcribe", "Classify", "Draft callback", "Assign to dispatch"],
    health: 96, runs7d: 18, successRate: 98, lastRun: "2h ago", impact: "9 hrs/wk saved", owner: "Reception Agent" },
  { id: "a2", name: "Job → invoice stitch (Commusoft + QuickBooks)", cat: "ops", status: "live", source: "Intelligence",
    desc: "Engineer signs off; ServiceOS issues invoice across both systems in one click.",
    trigger: "Job marked complete", actions: ["Pull line items", "Match SKU", "Issue invoice", "Notify customer"],
    health: 92, runs7d: 412, successRate: 99, lastRun: "9m ago", impact: "11 hrs/wk · DSO −2.4d", owner: "ServiceOS Workflow" },
  { id: "a3", name: "PPM month-end smoothing", cat: "ops", status: "review", source: "Intelligence",
    desc: "Reflow PPM bookings across the month using engineer capacity model.",
    trigger: "Daily 02:00", actions: ["Read PPM queue", "Score capacity", "Propose reflow", "Await approval"],
    health: 78, runs7d: 7, successRate: 86, lastRun: "yesterday", impact: "6 hrs/wk", owner: "Scheduling Agent" },
  { id: "a4", name: "Stock low → supplier RFQ", cat: "ops", status: "draft", source: "User-built",
    desc: "When part stock falls below threshold, send pre-filled RFQ to top 3 suppliers.",
    trigger: "Stock < min level", actions: ["Compose RFQ", "Email suppliers", "Log responses"],
    health: 70, runs7d: 0, successRate: 0, lastRun: "never", impact: "Pending first run", owner: "Chris D." },

  { id: "a5", name: "Aged debt tone-aware chase", cat: "finance", status: "live", source: "Intelligence",
    desc: "Personalised chase cadence on >30d invoices; escalates after 2 ignored steps.",
    trigger: "Invoice age > 30d", actions: ["Pick tone", "Send email", "Log reply", "Escalate"],
    health: 94, runs7d: 64, successRate: 91, lastRun: "23m ago", impact: "+£26.1k cash · DSO −9d", owner: "Finance Agent" },
  { id: "a6", name: "Mid-week invoice send", cat: "finance", status: "live", source: "Intelligence",
    desc: "Hold Friday invoices, batch send Tue/Wed for 4.2d faster payment.",
    trigger: "Invoice ready", actions: ["Defer", "Send Tue/Wed"],
    health: 90, runs7d: 38, successRate: 100, lastRun: "1h ago", impact: "+£3.4k/mo cashflow", owner: "ServiceOS Workflow" },
  { id: "a7", name: "Daily cash + 30/60/90 forecast", cat: "finance", status: "live", source: "Intelligence",
    desc: "Morning cash position + pipeline-weighted forecast published to leadership.",
    trigger: "Daily 07:00", actions: ["Pull QB", "Weight pipeline", "Publish brief"],
    health: 99, runs7d: 7, successRate: 100, lastRun: "today 07:00", impact: "Earlier decisions", owner: "ServiceOS Workflow" },
  { id: "a8", name: "Margin drift alert", cat: "finance", status: "paused", source: "User-built",
    desc: "Notify when job margin falls below 18% on 3 jobs in 7 days.",
    trigger: "Job closed", actions: ["Compute margin", "Notify ops"],
    health: 60, runs7d: 0, successRate: 0, lastRun: "8d ago", impact: "Paused by owner", owner: "Chris D." },

  { id: "a9", name: "30-min post-visit summary", cat: "customer", status: "live", source: "Intelligence",
    desc: "Voice AI summarises engineer notes, sends SMS + email within 30 mins of job close.",
    trigger: "Job complete", actions: ["Summarise notes", "Send SMS", "Send email", "Log to CRM"],
    health: 95, runs7d: 188, successRate: 97, lastRun: "12m ago", impact: "+9 CSAT · −40% complaints", owner: "Voice AI" },
  { id: "a10", name: "Sub-60s enquiry acknowledgement", cat: "customer", status: "live", source: "Intelligence",
    desc: "Inbox Agent qualifies + acknowledges web enquiries in under a minute.",
    trigger: "Web form submitted", actions: ["Qualify", "Reply", "Route to owner"],
    health: 91, runs7d: 73, successRate: 96, lastRun: "4m ago", impact: "+12% web conversion", owner: "Inbox Agent" },
  { id: "a11", name: "Account sentiment drift alert", cat: "customer", status: "live", source: "Intelligence",
    desc: "Flag accounts on 2+ negative signals in 14 days, book review call.",
    trigger: "Sentiment score change", actions: ["Score account", "Flag risk", "Book call"],
    health: 84, runs7d: 11, successRate: 90, lastRun: "5h ago", impact: "Protects £18k contract", owner: "Customer Care Agent" },
  { id: "a12", name: "Missed callback recovery SLA", cat: "customer", status: "draft", source: "User-built",
    desc: "Auto-create callback task with 4h SLA, escalate on breach.",
    trigger: "Missed call", actions: ["Create task", "Set SLA", "Escalate"],
    health: 72, runs7d: 0, successRate: 0, lastRun: "never", impact: "+£7.8k/wk recoverable", owner: "Chris D." },

  { id: "a13", name: "Certification expiry auto-renewal", cat: "compliance", status: "live", source: "Intelligence",
    desc: "Watch cert expiry; auto-book renewal visit + notify customer.",
    trigger: "Cert expires < 60d", actions: ["Detect expiry", "Book visit", "Notify customer"],
    health: 98, runs7d: 9, successRate: 100, lastRun: "yesterday", impact: "0 audit gaps", owner: "Compliance Agent" },
  { id: "a14", name: "Block job-close on missing signature", cat: "compliance", status: "live", source: "ServiceOS template",
    desc: "Prevent job completion until required cert + engineer signature are present.",
    trigger: "Engineer marks complete", actions: ["Check cert", "Check signature", "Hold or release"],
    health: 96, runs7d: 121, successRate: 99, lastRun: "18m ago", impact: "−100% missing-sig defect", owner: "ServiceOS Workflow" },
  { id: "a15", name: "RAMS auto-attach on PPM", cat: "compliance", status: "review", source: "ServiceOS template",
    desc: "Attach correct RAMS to PPM visits based on site profile.",
    trigger: "PPM scheduled", actions: ["Match site", "Attach RAMS", "Notify engineer"],
    health: 80, runs7d: 22, successRate: 92, lastRun: "3h ago", impact: "Audit-ready packs", owner: "Compliance Agent" },

  { id: "a16", name: "End-of-day operations brief", cat: "cross", status: "live", source: "ServiceOS template",
    desc: "Compose a single brief: jobs done, calls handled, cash in, risks open.",
    trigger: "Daily 18:00", actions: ["Aggregate", "Summarise", "Publish"],
    health: 99, runs7d: 7, successRate: 100, lastRun: "today 18:00", impact: "1 view of the day", owner: "ServiceOS Workflow" },
];

function Automations() {
  const [cat, setCat] = useState<"all" | AutoCat>("all");
  const [status, setStatus] = useState<"all" | AutoStatus>("all");
  const [source, setSource] = useState<"all" | AutoSource>("all");
  const [open, setOpen] = useState<AutomationItem | null>(null);

  const filtered = AUTOMATIONS.filter(
    (a) =>
      (cat === "all" || a.cat === cat) &&
      (status === "all" || a.status === status) &&
      (source === "all" || a.source === source),
  );

  const totals = {
    total: AUTOMATIONS.length,
    live: AUTOMATIONS.filter((a) => a.status === "live").length,
    runs7d: AUTOMATIONS.reduce((s, a) => s + a.runs7d, 0),
    avgHealth: Math.round(AUTOMATIONS.reduce((s, a) => s + a.health, 0) / AUTOMATIONS.length),
    fromIntel: AUTOMATIONS.filter((a) => a.source === "Intelligence").length,
  };

  const statusTone = (s: AutoStatus) =>
    s === "live" ? "bg-success/10 text-success border-success/20"
    : s === "draft" ? "bg-surface-alt text-muted-foreground border-hairline"
    : s === "paused" ? "bg-warning/10 text-warning border-warning/20"
    : "bg-accent/10 text-accent border-accent/20";

  const healthTone = (h: number) =>
    h >= 90 ? "text-success" : h >= 75 ? "text-accent" : h >= 60 ? "text-warning" : "text-destructive";

  const catMeta = (k: AutoCat) => AUTO_CATS.find((c) => c.key === k)!;

  const statTiles = [
    { l: "Total automations", v: String(totals.total), sub: "across 5 categories", icon: Layers },
    { l: "Live", v: String(totals.live), sub: "running on schedule", icon: Activity },
    { l: "Runs · last 7d", v: totals.runs7d.toLocaleString(), sub: "executions", icon: Zap },
    { l: "Average health", v: `${totals.avgHealth}`, sub: "0-100 across fleet", icon: Gauge },
    { l: "From Intelligence", v: String(totals.fromIntel), sub: "recommended + shipped", icon: Brain },
  ];

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="rounded-2xl border border-hairline bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-foreground text-background">
                <Zap className="h-3 w-3" />
              </span>
              Automations · live across the business
            </div>
            <h2 className="text-display mt-3 text-2xl font-semibold tracking-tight">
              Every automation in one place - shipped from Intelligence or built by your team.
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Click any automation to inspect its trigger, actions and impact, then pause, tune or promote it.
            </p>
          </div>
          <button className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-xs font-medium text-background">
            <Sparkles className="h-3.5 w-3.5" /> Build an automation
          </button>
        </div>

        {/* Aligned stat row */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {statTiles.map((k) => (
            <div key={k.l} className="rounded-xl border border-hairline bg-surface-alt p-4">
              <div className="flex h-5 items-center justify-between text-muted-foreground">
                <div className="text-[10px] font-medium uppercase tracking-wider">{k.l}</div>
                <k.icon className="h-3.5 w-3.5" />
              </div>
              <div className="text-display mt-3 h-8 text-2xl font-bold leading-none tabular text-foreground">{k.v}</div>
              <div className="mt-2 h-4 text-[10px] leading-none text-muted-foreground">{k.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Category overview · breathing room, no overflow */}
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        {AUTO_CATS.map((c) => {
          const items = AUTOMATIONS.filter((a) => a.cat === c.key);
          const live = items.filter((a) => a.status === "live").length;
          const avg = items.length ? Math.round(items.reduce((s, a) => s + a.health, 0) / items.length) : 0;
          const active = cat === c.key;
          return (
            <button
              key={c.key}
              onClick={() => setCat(active ? "all" : c.key)}
              className={cn(
                "flex flex-col rounded-2xl border bg-white p-5 text-left transition hover:border-foreground/30 hover:shadow-sm",
                active ? "border-foreground" : "border-hairline",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span className={cn(
                  "grid h-9 w-9 shrink-0 place-items-center rounded-lg",
                  c.tone === "accent" && "bg-accent/10 text-accent",
                  c.tone === "success" && "bg-success/10 text-success",
                  c.tone === "warning" && "bg-warning/10 text-warning",
                  c.tone === "muted" && "bg-surface-alt text-muted-foreground",
                )}>
                  <c.icon className="h-4 w-4" />
                </span>
                <div className={cn("text-display text-2xl font-bold leading-none tabular", healthTone(avg))}>{avg || "-"}</div>
              </div>
              <div className="mt-4 text-sm font-semibold leading-tight">{c.label}</div>
              <div className="mt-4 flex items-center justify-between border-t border-hairline pt-3 text-[11px] text-muted-foreground">
                <span>{items.length} total</span>
                <span><span className="font-medium text-success">{live}</span> live</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-display text-lg font-semibold">Automation fleet</div>
          <div className="text-xs text-muted-foreground">
            {filtered.length} matching {cat === "all" ? "all categories" : catMeta(cat as AutoCat).label}
            {status !== "all" && ` · ${status}`}{source !== "all" && ` · ${source}`}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-full border border-hairline bg-white p-1 text-[11px]">
            {(["all", "live", "review", "draft", "paused"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={cn(
                  "rounded-full px-2.5 py-1 capitalize transition",
                  status === s ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="flex gap-1 rounded-full border border-hairline bg-white p-1 text-[11px]">
            {(["all", "Intelligence", "User-built", "ServiceOS template"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSource(s)}
                className={cn(
                  "rounded-full px-2.5 py-1 transition",
                  source === s ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Automation cards · compact summary, click for detail */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((a) => {
          const c = catMeta(a.cat);
          return (
            <button
              key={a.id}
              onClick={() => setOpen(a)}
              className="group flex flex-col rounded-2xl border border-hairline bg-white p-5 text-left transition hover:border-foreground/30 hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <span className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider",
                  c.tone === "accent" && "bg-accent/10 text-accent",
                  c.tone === "success" && "bg-success/10 text-success",
                  c.tone === "warning" && "bg-warning/10 text-warning",
                  c.tone === "muted" && "bg-surface-alt text-muted-foreground",
                )}>
                  <c.icon className="h-3 w-3" /> {c.label}
                </span>
                <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider capitalize", statusTone(a.status))}>
                  <span className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    a.status === "live" && "bg-success animate-pulse",
                    a.status === "draft" && "bg-muted-foreground",
                    a.status === "paused" && "bg-warning",
                    a.status === "review" && "bg-accent",
                  )} />
                  {a.status}
                </span>
              </div>

              <div className="text-display mt-4 text-base font-semibold leading-snug">{a.name}</div>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{a.desc}</p>

              <div className="mt-5 flex items-end justify-between border-t border-hairline pt-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Health</div>
                  <div className={cn("text-display text-lg font-bold tabular leading-none", healthTone(a.health))}>{a.health}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Runs · 7d</div>
                  <div className="font-mono text-sm font-semibold tabular leading-none">{a.runs7d}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Success</div>
                  <div className="font-mono text-sm font-semibold tabular leading-none">{a.successRate}%</div>
                </div>
              </div>

              <div className="mt-4 inline-flex items-center gap-1 text-[11px] font-medium text-foreground/70 group-hover:text-foreground">
                Open automation <ChevronRight className="h-3 w-3" />
              </div>
            </button>
          );
        })}
      </div>

      {/* Automation detail modal */}
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-2xl">
          {open && (() => {
            const c = catMeta(open.cat);
            return (
              <div>
                <DialogHeader>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider",
                      c.tone === "accent" && "bg-accent/10 text-accent",
                      c.tone === "success" && "bg-success/10 text-success",
                      c.tone === "warning" && "bg-warning/10 text-warning",
                      c.tone === "muted" && "bg-surface-alt text-muted-foreground",
                    )}>
                      <c.icon className="h-3 w-3" /> {c.label}
                    </span>
                    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider capitalize", statusTone(open.status))}>
                      {open.status}
                    </span>
                    <span className="rounded-full bg-surface-alt px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">{open.source}</span>
                  </div>
                  <DialogTitle className="text-display mt-2 text-xl font-semibold leading-snug">{open.name}</DialogTitle>
                  <DialogDescription className="text-xs">{open.desc}</DialogDescription>
                </DialogHeader>

                <div className="mt-4 space-y-4 text-sm">
                  {/* Trigger → actions chain */}
                  <div className="rounded-xl border border-hairline bg-surface-alt p-3">
                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <Radio className="h-3 w-3" /> Trigger
                    </div>
                    <div className="mt-1 text-xs font-medium">{open.trigger}</div>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      {open.actions.map((act, i) => (
                        <span key={act} className="flex items-center gap-1.5">
                          <span className="rounded-md border border-hairline bg-white px-2 py-1 text-[11px]">{act}</span>
                          {i < open.actions.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Activity stats */}
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      { l: "Health", v: String(open.health), tone: healthTone(open.health) },
                      { l: "Runs · 7d", v: String(open.runs7d), tone: "text-foreground" },
                      { l: "Success", v: `${open.successRate}%`, tone: "text-foreground" },
                      { l: "Last run", v: open.lastRun, tone: "text-foreground" },
                    ].map((s) => (
                      <div key={s.l} className="rounded-lg border border-hairline bg-surface-alt p-3">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.l}</div>
                        <div className={cn("text-display mt-1 text-base font-bold tabular leading-none", s.tone)}>{s.v}</div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between rounded-lg border border-hairline px-3 py-2">
                    <div className="flex items-center gap-2 text-xs">
                      <TrendingUp className="h-3.5 w-3.5 text-success" />
                      <span className="font-medium">{open.impact}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">Owner · {open.owner}</div>
                  </div>
                </div>

                <div className="mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-hairline pt-4">
                  <button onClick={() => setOpen(null)} className="rounded-full border border-hairline px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
                    Close
                  </button>
                  <button className="rounded-full border border-hairline px-3 py-1.5 text-xs hover:text-foreground">
                    {open.status === "paused" ? "Resume" : open.status === "draft" || open.status === "review" ? "Activate" : "Pause"}
                  </button>
                  <button className="rounded-full border border-hairline px-3 py-1.5 text-xs hover:text-foreground">Tune</button>
                  <button className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-1.5 text-xs font-medium text-background">
                    <Eye className="h-3 w-3" /> Edit automation
                  </button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
