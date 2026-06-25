import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "motion/react";
import {
  LayoutDashboard, Workflow, Phone, Bot, Banknote, Settings, Briefcase,
  Search, Bell, ArrowUpRight, Activity, ChevronRight, Sparkles,
  GraduationCap, Mail, MessageSquare, Database, HardDrive, Globe,
  Monitor, FileText, Radio, Brain, TrendingUp, AlertTriangle, CheckCircle2,
  Zap, Eye, Target, Gauge, Layers, Network, ShieldCheck, Clock, Filter,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import dhIcon from "@/assets/dh-icon-blackwhite.png.asset.json";


export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [
      { title: "ServiceOS · Command Centre" },
      { name: "description", content: "Live operations, calls, finance and intelligence - in one surface." },
    ],
  }),
  component: AppShell,
});

type ViewKey = "dashboard" | "learn" | "intelligence" | "operations" | "calls" | "agents" | "finance" | "settings";

const NAV: { key: ViewKey; label: string; icon: typeof LayoutDashboard }[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "learn", label: "Learn", icon: GraduationCap },
  { key: "intelligence", label: "Intelligence", icon: Brain },
  { key: "operations", label: "Operations", icon: Briefcase },
  { key: "calls", label: "Calls", icon: Phone },
  
  { key: "agents", label: "Agents", icon: Bot },
  { key: "finance", label: "Finance", icon: Banknote },
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
            <div className="mt-2 text-xs text-muted-foreground">Deployment 001 · Drummond Heating</div>
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
          {view === "learn" && <Learn />}
          {view === "intelligence" && <Intelligence />}

          {view === "operations" && <Operations />}
          {view === "calls" && <Calls />}
          
          {view === "agents" && <Agents />}
          {view === "finance" && <Finance />}
          {view === "settings" && <SettingsView />}
        </main>
      </div>
    </div>
  );
}

/* ────── DASHBOARD ────── */
function Dashboard() {
  const stats = [
    { label: "Live Jobs", value: "42", sub: "Active", trend: "+6" },
    { label: "Calls Waiting", value: "8", sub: "Pending", tone: "warning" as const, trend: "−2" },
    { label: "Engineers Available", value: "11", sub: "On shift", trend: "+1" },
    { label: "Revenue Today", value: "£18,400", sub: "+12% vs wk avg", tone: "accent" as const },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-hairline bg-white p-5">
            <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground">
              <span>{s.label}</span>
              {s.trend && <span className="font-mono text-success">{s.trend}</span>}
            </div>
            <div className={cn(
              "text-display mt-4 text-3xl font-bold tabular",
              s.tone === "accent" && "text-accent",
              s.tone === "warning" && "text-warning",
            )}>{s.value}</div>
            <div className="mt-1 text-xs text-muted-foreground">{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-hairline bg-white p-5 md:col-span-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">Complaint Risk · last 24 windows</div>
            <span className="text-xs font-medium text-success">Low</span>
          </div>
          <div className="mt-4 flex gap-1">
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
            <div className="text-sm font-semibold">AI Insights</div>
            <Sparkles className="h-4 w-4 text-accent" />
          </div>
          <div className="mt-4 space-y-2">
            {[
              { tone: "warning", text: "Supplier delay affecting 3 jobs" },
              { tone: "accent", text: "Quote follow-up overdue ×7" },
              { tone: "destructive", text: "Complaint risk · ABC School" },
            ].map((x) => (
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

      <div className="rounded-2xl border border-hairline bg-white">
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
          <div className="text-sm font-semibold">Live activity</div>
          <div className="flex items-center gap-1.5 text-[11px] text-success">
            <Activity className="h-3.5 w-3.5" /> streaming
          </div>
        </div>
        <div className="divide-y divide-hairline">
          {[
            { t: "14:22", who: "Reception Agent", what: "Inbound call · ABC School routed to dispatch" },
            { t: "14:19", who: "Procurement Agent", what: "Compared 3 supplier quotes · saved £214" },
            { t: "14:15", who: "Scheduling Agent", what: "Re-routed Engineer 04 · saved 28 mins" },
            { t: "14:11", who: "Finance Agent", what: "Reconciled invoice INV-3387 · matched" },
            { t: "14:04", who: "Workflow Intelligence", what: "New automation candidate detected (74% time saving)" },
          ].map((row) => (
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
  );
}




/* ────── AGENTS ────── */
function Agents() {
  const list = [
    { name: "Reception Agent", task: "Handling 2 calls", confidence: 96 },
    { name: "Scheduling Agent", task: "Optimising 11 routes", confidence: 92 },
    { name: "Finance Agent", task: "Reconciling 47 invoices", confidence: 88 },
    { name: "Procurement Agent", task: "Comparing 3 quotes", confidence: 91 },
  ];
  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
      {list.map((a, i) => (
        <div key={a.name} className="rounded-2xl border border-hairline bg-white p-5">
          <div className="flex items-center justify-between">
            <Sparkles className="h-5 w-5 text-accent" />
            <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" /> active
            </span>
          </div>
          <div className="text-display mt-8 text-base font-semibold">{a.name}</div>
          <div className="mt-1 text-xs text-muted-foreground">{a.task}</div>
          <div className="mt-5 flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">Confidence</span>
            <span className="font-mono tabular">{a.confidence}%</span>
          </div>
          <div className="mt-1.5 h-1 rounded-full bg-surface-alt">
            <motion.div initial={{ width: 0 }} animate={{ width: `${a.confidence}%` }} transition={{ duration: 1, delay: i * 0.1 }} className="h-full rounded-full bg-accent" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ────── FINANCE ────── */
function Finance() {
  const pts = [12, 18, 14, 22, 19, 28, 24, 31, 27, 35, 32, 40, 36, 44];
  const max = Math.max(...pts);
  const path = pts
    .map((p, i) => {
      const x = (i / (pts.length - 1)) * 600;
      const y = 200 - (p / max) * 180;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-4">
        {[
          { l: "Revenue MTD", v: "£312k", t: "+18%" },
          { l: "Margin", v: "34.2%", t: "+2.1pp" },
          { l: "Outstanding", v: "£48k", t: "−£6k" },
          { l: "Avg invoice", v: "£642", t: "+£44" },
        ].map((x) => (
          <div key={x.l} className="rounded-2xl border border-hairline bg-white p-5">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{x.l}</div>
            <div className="text-display mt-3 text-2xl font-bold tabular">{x.v}</div>
            <div className="mt-1 font-mono text-xs text-success flex items-center gap-1"><ArrowUpRight className="h-3 w-3" /> {x.t}</div>
          </div>
        ))}
      </div>
      <div className="rounded-2xl border border-hairline bg-white p-5">
        <div className="text-sm font-semibold">Revenue · last 14 days</div>
        <svg viewBox="0 0 600 220" className="mt-4 w-full">
          <defs>
            <linearGradient id="g" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#2563eb" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${path} L600,200 L0,200 Z`} fill="url(#g)" />
          <path d={path} fill="none" stroke="#2563eb" strokeWidth="2" />
        </svg>
      </div>
    </div>
  );
}

/* ────── SETTINGS ────── */
function SettingsView() {
  return (
    <div className="max-w-2xl space-y-3">
      {["Workspace", "Members & roles", "Integrations", "Security & audit", "Billing"].map((s) => (
        <div key={s} className="flex items-center justify-between rounded-2xl border border-hairline bg-white px-5 py-4 hover:bg-surface-alt">
          <div className="text-sm font-medium">{s}</div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      ))}
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
      "63 escalations in #ops-dispatch last 30d — 22% lacked owner assignment",
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
      "PPM scheduling clusters in last week of month — capacity strain",
      "Engineer utilisation 71% — 14% lost to travel reschedules",
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
      "PPM customers pay 11 days faster than reactive — bias mix upward",
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
      "Internal meeting load peaked Wed 10–12 — automation candidates",
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
      "27 customer certificates expire within 60 days — none currently surfaced",
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
      "Upcoming F-gas guidance change — affects 14 PPM contracts",
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
      "Avg time-to-first-response from form submit: 4h 12m — target 1h",
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
    name: "IoT Telemetry", icon: Radio, status: "Planned", events: "—", tone: "muted",
    desc: "Boilers · sensors · fault codes · energy",
    connection: "Not yet connected", lastSync: "—",
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
      "Expected 18–25% reduction in reactive callouts once live",
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
              Each card below is an upgrade ServiceOS can ship — via automation, an AI agent, or a workflow change — with projected impact on time, profit, turnover, customer satisfaction and risk.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-hairline bg-surface-alt px-3 py-1.5 text-[11px] font-medium">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
            Always listening · always learning
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            { l: "Open upgrades", v: String(totals.upgrades), sub: "across 4 pillars", icon: Sparkles },
            { l: "Time saved", v: totals.time, sub: "if all shipped", icon: Clock },
            { l: "Profit uplift", v: totals.profit, sub: "monthly run-rate", icon: TrendingUp },
            { l: "Turnover uplift", v: totals.turnover, sub: "quarterly", icon: ArrowUpRight },
            { l: "CSAT uplift", v: totals.csat, sub: "rolling 60d", icon: Brain },
          ].map((k) => (
            <div key={k.l} className="rounded-xl border border-hairline bg-surface-alt p-4">
              <div className="flex items-center justify-between text-muted-foreground">
                <div className="text-[10px] uppercase tracking-wider">{k.l}</div>
                <k.icon className="h-3.5 w-3.5" />
              </div>
              <div className="text-display mt-1.5 text-xl font-bold tabular text-foreground">{k.v}</div>
              <div className="text-[10px] text-muted-foreground">{k.sub}</div>
            </div>
          ))}
        </div>
      </div>


      {/* Pillar score infographic */}
      <div className="rounded-2xl border border-hairline bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">How the pillar score works</div>
            <div className="text-display mt-1 text-lg font-semibold">A 0–100 health rating per pillar, recalculated hourly.</div>
            <p className="mt-1 text-xs text-muted-foreground">
              ServiceOS blends live signals — throughput, cash flow, sentiment, audit gaps — into one score so you can see, at a glance, where the business is strong and where upgrades will have the biggest impact.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { band: "0–49", label: "At risk", tone: "bg-destructive/10 text-destructive border-destructive/20" },
              { band: "50–69", label: "Needs work", tone: "bg-warning/10 text-warning border-warning/20" },
              { band: "70–84", label: "Healthy", tone: "bg-accent/10 text-accent border-accent/20" },
              { band: "85–100", label: "Excellent", tone: "bg-success/10 text-success border-success/20" },
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

      {/* Pillar health */}

      <div className="grid gap-3 md:grid-cols-4">
        {PILLARS.map((p) => {
          const h = PILLAR_HEALTH[p.key];
          const active = pillar === p.key;
          return (
            <button
              key={p.key}
              onClick={() => setPillar(active ? "all" : p.key)}
              className={cn(
                "rounded-2xl border bg-white p-5 text-left transition hover:border-foreground/30 hover:shadow-sm",
                active ? "border-foreground" : "border-hairline",
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "grid h-7 w-7 place-items-center rounded-lg",
                    p.tone === "accent" && "bg-accent/10 text-accent",
                    p.tone === "success" && "bg-success/10 text-success",
                    p.tone === "warning" && "bg-warning/10 text-warning",
                    p.tone === "muted" && "bg-surface-alt text-muted-foreground",
                  )}>
                    <p.icon className="h-3.5 w-3.5" />
                  </span>
                  <div className="text-sm font-semibold">{p.label}</div>
                </div>
                <div className="text-display text-xl font-bold tabular">{h.score}</div>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">{p.desc}</div>
              <div className="mt-3 flex items-center justify-between border-t border-hairline pt-2 text-[11px]">
                <span className="text-muted-foreground">{h.openUpgrades} upgrades</span>
                <span className="font-medium">{h.potential}</span>
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">{h.trend}</div>
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

      {/* Upgrade cards */}
      <div className="grid gap-3 md:grid-cols-2">
        {filtered.map((u) => {
          const pillarMeta = PILLARS.find((p) => p.key === u.pillar)!;
          return (
            <div key={u.id} className="flex flex-col rounded-2xl border border-hairline bg-white p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "grid h-8 w-8 place-items-center rounded-lg",
                    pillarMeta.tone === "accent" && "bg-accent/10 text-accent",
                    pillarMeta.tone === "success" && "bg-success/10 text-success",
                    pillarMeta.tone === "warning" && "bg-warning/10 text-warning",
                    pillarMeta.tone === "muted" && "bg-surface-alt text-muted-foreground",
                  )}>
                    <pillarMeta.icon className="h-4 w-4" />
                  </span>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{pillarMeta.label}</div>
                    <div className="text-sm font-semibold leading-tight">{u.title}</div>
                  </div>
                </div>
                <span className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider",
                  u.status === "ready" && "bg-success/10 text-success",
                  u.status === "draft" && "bg-accent/10 text-accent",
                  u.status === "review" && "bg-surface-alt text-muted-foreground",
                )}>{u.status}</span>
              </div>

              <div className="mt-4 space-y-2 text-xs">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">What we observed</div>
                  <div className="mt-0.5 leading-relaxed text-foreground/80">{u.insight}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Recommendation</div>
                  <div className="mt-0.5 leading-relaxed">{u.recommendation}</div>
                </div>
              </div>

              {/* Uplift chips */}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {u.uplift.timeSaved && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-surface-alt px-2 py-0.5 text-[10px]">
                    <Clock className="h-3 w-3" /> {u.uplift.timeSaved}
                  </span>
                )}
                {u.uplift.profit && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10px] text-success">
                    <Banknote className="h-3 w-3" /> Profit {u.uplift.profit}
                  </span>
                )}
                {u.uplift.turnover && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] text-accent">
                    <TrendingUp className="h-3 w-3" /> Turnover {u.uplift.turnover}
                  </span>
                )}
                {u.uplift.csat && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[10px] text-warning">
                    <Brain className="h-3 w-3" /> CSAT {u.uplift.csat}
                  </span>
                )}
                {u.uplift.risk && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-hairline px-2 py-0.5 text-[10px] text-muted-foreground">
                    <ShieldCheck className="h-3 w-3" /> Risk {u.uplift.risk}
                  </span>
                )}
              </div>

              {/* Meta row */}
              <div className="mt-4 grid grid-cols-3 gap-3 border-t border-hairline pt-3 text-[11px]">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Delivered via</div>
                  <div className="mt-0.5 font-medium">{u.via}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Effort</div>
                  <div className="mt-0.5 font-medium">{u.effort}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Confidence</div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <div className="h-1 flex-1 rounded-full bg-hairline">
                      <div className="h-full rounded-full bg-foreground" style={{ width: `${u.confidence}%` }} />
                    </div>
                    <span className="font-mono tabular">{u.confidence}%</span>
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1">
                  {u.sources.map((s) => (
                    <span key={s} className="rounded-full bg-surface-alt px-2 py-0.5 text-[10px] text-muted-foreground">{s}</span>
                  ))}
                </div>
                <div className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1 text-[11px] font-medium text-background">
                  <Sparkles className="h-3 w-3" /> Ship upgrade
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
