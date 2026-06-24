import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "motion/react";
import {
  LayoutDashboard, Workflow, Phone, Bot, Banknote, Settings, Briefcase,
  Search, Bell, ArrowUpRight, Activity, ChevronRight, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [
      { title: "ServiceOS · Command Centre" },
      { name: "description", content: "Live operations, calls, finance and intelligence - in one surface." },
    ],
  }),
  component: AppShell,
});

type ViewKey = "dashboard" | "operations" | "calls" | "workflow" | "agents" | "finance" | "settings";

const NAV: { key: ViewKey; label: string; icon: typeof LayoutDashboard }[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "operations", label: "Operations", icon: Briefcase },
  { key: "calls", label: "Calls", icon: Phone },
  { key: "workflow", label: "Workflow Intelligence", icon: Workflow },
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
          <span className="grid h-6 w-6 place-items-center rounded-md bg-foreground text-background text-[10px] font-bold">S</span>
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
          {view === "operations" && <Operations />}
          {view === "calls" && <Calls />}
          {view === "workflow" && <WorkflowView />}
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

/* ────── WORKFLOW ────── */
function WorkflowView() {
  const flows = [
    { name: "Quote → Approval", obs: 184, save: "74%" },
    { name: "Supplier Reconciliation", obs: 92, save: "61%" },
    { name: "Engineer Job Sheet → Invoice", obs: 412, save: "58%" },
    { name: "Customer Follow-up", obs: 246, save: "82%" },
  ];
  return (
    <div className="space-y-3">
      {flows.map((f) => (
        <div key={f.name} className="rounded-2xl border border-hairline bg-white p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-display text-lg font-semibold">{f.name}</div>
              <div className="text-xs text-muted-foreground">{f.obs} observations · last 30 days</div>
            </div>
            <div className="text-right">
              <div className="text-display text-3xl font-bold tabular text-accent">{f.save}</div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Automatable</div>
            </div>
          </div>
          <div className="mt-4 flex gap-1">
            {Array.from({ length: 40 }).map((_, i) => (
              <div key={i} className={cn("h-1.5 flex-1 rounded-full", i < parseInt(f.save) / 2.5 ? "bg-accent" : "bg-surface-alt")} />
            ))}
          </div>
        </div>
      ))}
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
