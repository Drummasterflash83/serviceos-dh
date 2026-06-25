import { useState } from "react";
import {
  ShieldCheck, Clock, AlertTriangle, CheckCircle2, Phone, Mail, Inbox,
  Truck, PackageSearch, Receipt, CalendarClock, Workflow, Sparkles,
  ArrowUpRight, ChevronRight, Users, HardDrive, Activity, Filter,
  FileText, Network, Briefcase, MessageSquare, Star, Wrench, Gauge,
  TrendingUp, Layers, Package, Warehouse, ArrowDownToLine, ArrowUpFromLine,
  ScanLine, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

/* ───── Shared bits ───── */
function Hero({
  eyebrow, title, sub, icon: Icon, pill,
}: { eyebrow: string; title: string; sub: string; icon: typeof ShieldCheck; pill?: string }) {
  return (
    <div className="rounded-2xl border border-hairline bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            <span className="grid h-5 w-5 place-items-center rounded-full bg-foreground text-background">
              <Icon className="h-3 w-3" />
            </span>
            {eyebrow}
          </div>
          <h2 className="text-display mt-3 text-2xl font-semibold tracking-tight">{title}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{sub}</p>
        </div>
        {pill && (
          <div className="flex items-center gap-2 rounded-full border border-hairline bg-surface-alt px-3 py-1.5 text-[11px] font-medium">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
            {pill}
          </div>
        )}
      </div>
    </div>
  );
}

function StatTiles({ tiles }: { tiles: { l: string; v: string; sub: string; icon: typeof ShieldCheck }[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {tiles.map((k) => (
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
  );
}

/* ────── PROTOCOL ────── */
type Thread = {
  id: string; caller: string; channel: string; param: string;
  target: string; elapsed: string; owner: string; status: "Inside" | "At risk" | "Breached";
};

const PROTOCOL_PARAMS = [
  { l: "Complaint response", target: "24h", avg: "11h", pct: 94, icon: AlertTriangle },
  { l: "Quote follow-up", target: "3 days", avg: "2.1d", pct: 88, icon: FileText },
  { l: "Emergency call-back", target: "15 min", avg: "9 min", pct: 97, icon: Phone },
  { l: "Warranty callback", target: "48h", avg: "31h", pct: 91, icon: ShieldCheck },
];

const THREADS: Thread[] = [
  { id: "T-204", caller: "ABC School", channel: "Phone", param: "Emergency call-back", target: "15m", elapsed: "08:14", owner: "Heidi", status: "Inside" },
  { id: "T-203", caller: "Greenfield Care Home", channel: "Email", param: "Complaint response", target: "24h", elapsed: "18:42", owner: "Mary", status: "At risk" },
  { id: "T-202", caller: "Crestmont Apartments", channel: "Phone", param: "Warranty callback", target: "48h", elapsed: "51:00", owner: "Tony", status: "Breached" },
  { id: "T-201", caller: "Highbridge Foods", channel: "Email", param: "Quote follow-up", target: "3d", elapsed: "1d 04h", owner: "Sam", status: "Inside" },
  { id: "T-200", caller: "12 Marlborough Rd", channel: "Web form", param: "Quote follow-up", target: "3d", elapsed: "2d 11h", owner: "Sam", status: "At risk" },
  { id: "T-199", caller: "Bridgewater Homes", channel: "Phone", param: "Complaint response", target: "24h", elapsed: "04:22", owner: "Heidi", status: "Inside" },
];

const STATUS_TONE = {
  Inside: "bg-success/10 text-success border-success/20",
  "At risk": "bg-warning/10 text-warning border-warning/20",
  Breached: "bg-destructive/10 text-destructive border-destructive/20",
};

export function Protocol() {
  const [open, setOpen] = useState<Thread | null>(null);
  const inside = THREADS.filter(t => t.status === "Inside").length;

  return (
    <div className="space-y-6">
      <Hero
        eyebrow="Response Protocol · live"
        title={`Inside protocol · ${inside} of ${THREADS.length} active threads.`}
        sub="The parameters Heidi set in our discovery call - every inbound thread is timed against them. Anything drifting outside its window surfaces here, with the owner and what to do next."
        icon={ShieldCheck}
        pill="Live · streaming"
      />

      {/* Parameter tiles */}
      <div className="rounded-2xl border border-hairline bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Parameters</div>
            <div className="text-display mt-1 text-lg font-semibold">The windows we operate inside.</div>
          </div>
          <div className="text-[11px] text-muted-foreground">Defined with Heidi · 12 Mar</div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PROTOCOL_PARAMS.map((p) => (
            <div key={p.l} className="rounded-xl border border-hairline bg-surface-alt p-4">
              <div className="flex h-5 items-center justify-between text-muted-foreground">
                <div className="text-[10px] font-medium uppercase tracking-wider">{p.l}</div>
                <p.icon className="h-3.5 w-3.5" />
              </div>
              <div className="text-display mt-3 h-8 text-2xl font-bold leading-none tabular text-foreground">{p.pct}%</div>
              <div className="mt-2 flex h-4 items-center justify-between text-[10px] leading-none text-muted-foreground">
                <span>target {p.target}</span>
                <span className="font-mono tabular">avg {p.avg}</span>
              </div>
              <div className="mt-3 h-1 rounded-full bg-white">
                <div className="h-full rounded-full bg-foreground" style={{ width: `${p.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Live threads */}
      <div className="rounded-2xl border border-hairline bg-white">
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Live threads</div>
            <div className="text-display mt-0.5 text-sm font-semibold">Click any thread to see the timeline and act</div>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-success">
            <Activity className="h-3.5 w-3.5" /> streaming
          </div>
        </div>
        <div className="grid grid-cols-12 gap-x-3 border-b border-hairline px-5 py-3 text-[11px] uppercase tracking-wider text-muted-foreground">
          <div className="col-span-3 min-w-0">Caller</div>
          <div className="col-span-2 min-w-0">Channel</div>
          <div className="col-span-3 min-w-0">Parameter</div>
          <div className="col-span-2 min-w-0">Elapsed</div>
          <div className="col-span-1 min-w-0">Owner</div>
          <div className="col-span-1 text-right min-w-0">Status</div>
        </div>
        {THREADS.map((t) => (
          <button
            key={t.id}
            onClick={() => setOpen(t)}
            className="grid w-full grid-cols-12 gap-x-3 items-center border-b border-hairline px-5 py-4 text-left text-sm last:border-0 hover:bg-surface-alt"
          >
            <div className="col-span-3 font-medium min-w-0">{t.caller}</div>
            <div className="col-span-2 text-xs text-muted-foreground min-w-0">{t.channel}</div>
            <div className="col-span-3 text-xs min-w-0">{t.param} <span className="text-muted-foreground">· {t.target}</span></div>
            <div className="col-span-2 font-mono text-xs tabular min-w-0">{t.elapsed}</div>
            <div className="col-span-1 text-xs text-muted-foreground min-w-0">{t.owner}</div>
            <div className="col-span-1 flex justify-end min-w-0">
              <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium", STATUS_TONE[t.status])}>{t.status}</span>
            </div>
          </button>
        ))}
      </div>

      <Dialog open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="max-w-2xl">
          {open && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <Phone className="h-3.5 w-3.5" /> {open.channel} · {open.param}
                </div>
                <DialogTitle className="text-display text-xl font-semibold">{open.caller}</DialogTitle>
                <DialogDescription>Target window {open.target} · elapsed {open.elapsed} · owner {open.owner}</DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-3 gap-3 border-y border-hairline py-4">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</div>
                  <div className={cn("mt-1 inline-flex rounded-full border px-2.5 py-1 text-xs font-medium", STATUS_TONE[open.status])}>{open.status}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Elapsed</div>
                  <div className="text-display mt-1 text-lg font-bold tabular">{open.elapsed}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Target</div>
                  <div className="text-display mt-1 text-lg font-bold tabular">{open.target}</div>
                </div>
              </div>

              <div className="space-y-3 text-sm">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Timeline</div>
                <ol className="space-y-2 text-xs">
                  <li className="flex gap-3"><span className="w-16 font-mono text-muted-foreground">14:08</span><span>Inbound {open.channel.toLowerCase()} received · auto-classified</span></li>
                  <li className="flex gap-3"><span className="w-16 font-mono text-muted-foreground">14:09</span><span>Routed to {open.owner} · clock started</span></li>
                  <li className="flex gap-3"><span className="w-16 font-mono text-muted-foreground">14:14</span><span>Acknowledgement sent to customer</span></li>
                  <li className="flex gap-3"><span className="w-16 font-mono text-accent">now</span><span>Awaiting engineer dispatch confirmation</span></li>
                </ol>

                <div className="mt-4 rounded-lg border border-accent/30 bg-accent-soft p-3 text-xs">
                  <div className="font-semibold text-accent">Suggested next action</div>
                  <div className="mt-1 text-foreground">Confirm Tony ETA and send customer update to bring thread back inside protocol.</div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-hairline pt-4">
                <button className="rounded-full border border-hairline px-3 py-1.5 text-xs">Reassign</button>
                <button className="rounded-full border border-hairline px-3 py-1.5 text-xs">Escalate</button>
                <button className="rounded-full bg-foreground px-3 py-1.5 text-xs text-background">Mark handled</button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ────── OPERATIONS HUB (tabs) ────── */
type OpTab = "jobs" | "rota" | "inbox" | "parts" | "suppliers" | "warranty" | "ppm";
const OP_TABS: { key: OpTab; label: string; icon: typeof Briefcase }[] = [
  { key: "jobs", label: "Jobs", icon: Briefcase },
  { key: "rota", label: "On-call rota", icon: Clock },
  { key: "inbox", label: "Inbox routing", icon: Inbox },
  { key: "parts", label: "Parts & vans", icon: Truck },
  { key: "suppliers", label: "Suppliers", icon: PackageSearch },
  { key: "warranty", label: "Warranty", icon: Receipt },
  { key: "ppm", label: "PPM", icon: CalendarClock },
];

export function OperationsHub({ jobsSlot }: { jobsSlot: React.ReactNode }) {
  const [tab, setTab] = useState<OpTab>("jobs");
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-hairline bg-white p-2">
        <div className="flex flex-wrap gap-1">
          {OP_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition",
                tab === t.key
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-surface-alt hover:text-foreground",
              )}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "jobs" && jobsSlot}
      {tab === "rota" && <Rota />}
      {tab === "inbox" && <InboxRouting />}
      {tab === "parts" && <PartsStock />}
      {tab === "suppliers" && <SupplierNormaliser />}
      {tab === "warranty" && <WarrantyTracker />}
      {tab === "ppm" && <PPM />}
    </div>
  );
}

/* ────── ROTA ────── */
function Rota() {
  const [window, setWindow] = useState<"tonight" | "week" | "next">("tonight");
  const slots = {
    tonight: [
      { role: "Primary on-call", name: "Tony", phone: "07700 900181", ack: "14:02" },
      { role: "Backup 1", name: "M. Patel", phone: "07700 900244", ack: "13:58" },
      { role: "Backup 2", name: "L. Bryan", phone: "07700 900377", ack: "12:30" },
    ],
    week: [
      { role: "Primary on-call", name: "S. Walsh", phone: "07700 900412", ack: "Mon 08:00" },
      { role: "Backup 1", name: "Tony", phone: "07700 900181", ack: "Mon 08:14" },
      { role: "Backup 2", name: "M. Patel", phone: "07700 900244", ack: "Mon 09:02" },
    ],
    next: [
      { role: "Primary on-call", name: "M. Patel", phone: "07700 900244", ack: "pending" },
      { role: "Backup 1", name: "L. Bryan", phone: "07700 900377", ack: "pending" },
      { role: "Backup 2", name: "S. Walsh", phone: "07700 900412", ack: "pending" },
    ],
  } as const;

  return (
    <div className="space-y-5">
      <Hero
        eyebrow="On-call & emergency rota"
        title="No single point of failure."
        sub="Tony was the only person answering after-hours calls. Now every shift has a primary plus two named backups, with the routing tree visible so we can see exactly who'd pick up an emergency right now."
        icon={Clock}
      />

      <div className="rounded-2xl border border-hairline bg-white p-5">
        <div className="flex gap-1">
          {(["tonight", "week", "next"] as const).map((w) => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium",
                window === w ? "bg-foreground text-background" : "text-muted-foreground hover:bg-surface-alt",
              )}
            >
              {w === "tonight" ? "Tonight" : w === "week" ? "This week" : "Next week"}
            </button>
          ))}
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {slots[window].map((s) => (
            <div key={s.role} className="rounded-xl border border-hairline bg-surface-alt p-4">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.role}</div>
              <div className="mt-3 flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-full bg-foreground text-xs font-semibold text-background">
                  {s.name.split(" ").map(p => p[0]).join("")}
                </div>
                <div>
                  <div className="text-display text-sm font-semibold">{s.name}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">{s.phone}</div>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-hairline pt-3 text-[11px] text-muted-foreground">
                <span>Last ack</span>
                <span className="font-mono tabular">{s.ack}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-hairline bg-white p-5">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Emergency intake · live</div>
        <div className="text-display mt-1 text-sm font-semibold">If a call lands right now, this is who it hits.</div>
        <div className="mt-5 flex flex-wrap items-center gap-3 text-xs">
          <div className="rounded-lg border border-hairline bg-surface-alt px-3 py-2">Inbound call · 0117 ···</div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
          <div className="rounded-lg border border-hairline bg-surface-alt px-3 py-2">Reception Agent triage</div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
          <div className="rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-accent font-medium">Tony · ring 30s</div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
          <div className="rounded-lg border border-hairline bg-surface-alt px-3 py-2">M. Patel · ring 30s</div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
          <div className="rounded-lg border border-hairline bg-surface-alt px-3 py-2">L. Bryan · ring 30s</div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
          <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-warning font-medium">Owner escalation</div>
        </div>
      </div>
    </div>
  );
}

/* ────── INBOX ROUTING ────── */
function InboxRouting() {
  const mailboxes = [
    { addr: "office@drummondheating.co.uk", owner: "Mary", unread: 12, oldest: "2h", avg: "47m", routed: 96 },
    { addr: "invoicing@drummondheating.co.uk", owner: "Heidi", unread: 4, oldest: "31m", avg: "22m", routed: 99 },
    { addr: "scheduling@drummondheating.co.uk", owner: "Sam", unread: 7, oldest: "1h 12m", avg: "33m", routed: 92 },
    { addr: "Website quote form", owner: "Quote Agent", unread: 3, oldest: "18m", avg: "12m", routed: 100 },
    { addr: "Main phone line", owner: "Reception Agent", unread: 0, oldest: "-", avg: "9s", routed: 98 },
  ];
  const mis = [
    { from: "Greenfield Care Home", landed: "office@", should: "scheduling@", subj: "Re: visit Thursday?" },
    { from: "Wolseley", landed: "office@", should: "invoicing@", subj: "Statement attached" },
    { from: "P. Hughes", landed: "scheduling@", should: "office@", subj: "Complaint about callback" },
  ];
  return (
    <div className="space-y-5">
      <Hero
        eyebrow="Inbox & comms routing"
        title="Every channel, mapped to an owner."
        sub="Five inboxes, one rule: every message has a named owner and an SLA. The routing map makes drift visible - misrouted items get one-click re-routed below."
        icon={Inbox}
      />

      <div className="rounded-2xl border border-hairline bg-white">
        <div className="border-b border-hairline px-5 py-3 text-[11px] uppercase tracking-wider text-muted-foreground">Mailbox health</div>
        <div className="grid grid-cols-12 gap-x-3 border-b border-hairline px-5 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          <div className="col-span-5 min-w-0">Address</div>
          <div className="col-span-2 min-w-0">Owner</div>
          <div className="col-span-1 text-right min-w-0">Unread</div>
          <div className="col-span-1 text-right min-w-0">Oldest</div>
          <div className="col-span-2 text-right min-w-0">Avg resp</div>
          <div className="col-span-1 text-right min-w-0">Routed</div>
        </div>
        {mailboxes.map((m) => (
          <div key={m.addr} className="grid grid-cols-12 gap-x-3 items-center border-b border-hairline px-5 py-3 text-sm last:border-0">
            <div className="col-span-5 min-w-0 truncate font-medium">{m.addr}</div>
            <div className="col-span-2 min-w-0 truncate text-xs text-muted-foreground">{m.owner}</div>
            <div className="col-span-1 text-right font-mono text-xs tabular min-w-0">{m.unread}</div>
            <div className="col-span-1 text-right font-mono text-xs tabular text-muted-foreground min-w-0">{m.oldest}</div>
            <div className="col-span-2 text-right font-mono text-xs tabular min-w-0">{m.avg}</div>
            <div className="col-span-1 text-right font-mono text-xs tabular text-success min-w-0">{m.routed}%</div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-hairline bg-white">
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Misrouted queue</div>
            <div className="text-display mt-0.5 text-sm font-semibold">3 items landed in the wrong inbox</div>
          </div>
          <span className="rounded-full border border-warning/20 bg-warning/10 px-2.5 py-1 text-[10px] font-medium text-warning">Needs attention</span>
        </div>
        {mis.map((m, i) => (
          <div key={i} className="grid grid-cols-12 gap-x-3 items-center border-b border-hairline px-5 py-3 text-sm last:border-0">
            <div className="col-span-3 font-medium min-w-0">{m.from}</div>
            <div className="col-span-5 text-xs text-muted-foreground truncate min-w-0">{m.subj}</div>
            <div className="col-span-3 text-xs min-w-0"><span className="font-mono text-muted-foreground">{m.landed}</span> → <span className="font-mono text-accent">{m.should}</span></div>
            <div className="col-span-1 flex justify-end min-w-0">
              <button className="rounded-full border border-hairline px-2.5 py-1 text-[11px]">Re-route</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ────── PARTS & VAN STOCK ────── */
function PartsStock() {
  const [tab, setTab] = useState<"store" | "vans" | "reorder" | "moves">("store");

  // Store / warehouse inventory
  const store = [
    { sku: "CU-22-3M",   name: "22mm copper pipe (3m)",        bin: "A1-04", onHand: 48, reserved: 6, min: 30, max: 80, value: "£820",   counted: "2d ago",      supplier: "Wolseley" },
    { sku: "WB-30-PCB",  name: "Worcester 30kW PCB",           bin: "C3-12", onHand: 4,  reserved: 1, min: 5,  max: 10, value: "£612",   counted: "1w ago",      supplier: "Plumb Base" },
    { sku: "GR-UPS2-CT", name: "Pump cartridge (Grundfos UPS2)", bin: "B2-08", onHand: 12, reserved: 2, min: 8,  max: 20, value: "£348",   counted: "3d ago",      supplier: "BSS" },
    { sku: "FL-EXT-1M",  name: "Flue extension 1m",            bin: "D1-02", onHand: 22, reserved: 0, min: 10, max: 30, value: "£264",   counted: "2d ago",      supplier: "Wolseley" },
    { sku: "MF-1-BSP",   name: "Magnetic filter MF1 (1\" BSP)", bin: "B4-01", onHand: 7,  reserved: 3, min: 6,  max: 15, value: "£546",   counted: "yesterday",   supplier: "Plumbase" },
    { sku: "EV-12L",     name: "Expansion vessel 12L",         bin: "A3-06", onHand: 2,  reserved: 1, min: 4,  max: 8,  value: "£190",   counted: "4d ago",      supplier: "BSS" },
    { sku: "TRV-15",     name: "TRV 15mm angled",              bin: "B1-03", onHand: 36, reserved: 4, min: 20, max: 60, value: "£198",   counted: "today",       supplier: "City Plumbing" },
  ];

  // Each van: fixed target stock list per vehicle, current on-van counts
  const vans = [
    {
      reg: "BD21 PRX", driver: "Tony Reid", role: "Senior engineer", lastSync: "12m ago",
      stock: [
        { name: "22mm copper (3m)",     have: 6, target: 6, unit: "lengths" },
        { name: "PCB (Worcester 30kW)", have: 2, target: 2, unit: "units" },
        { name: "Magnetic filter MF1",  have: 1, target: 2, unit: "units" },
        { name: "Pump cartridge UPS2",  have: 1, target: 1, unit: "units" },
        { name: "TRV 15mm",             have: 8, target: 8, unit: "units" },
      ],
    },
    {
      reg: "BG22 ZTM", driver: "M. Patel", role: "Engineer", lastSync: "1h ago",
      stock: [
        { name: "22mm copper (3m)",     have: 2, target: 6, unit: "lengths" },
        { name: "PCB (Worcester 30kW)", have: 0, target: 1, unit: "units" },
        { name: "Magnetic filter MF1",  have: 0, target: 2, unit: "units" },
        { name: "Pump cartridge UPS2",  have: 1, target: 1, unit: "units" },
        { name: "TRV 15mm",             have: 3, target: 8, unit: "units" },
      ],
    },
    {
      reg: "BV21 WHK", driver: "S. Walsh", role: "Engineer", lastSync: "28m ago",
      stock: [
        { name: "22mm copper (3m)",     have: 5, target: 6, unit: "lengths" },
        { name: "PCB (Worcester 30kW)", have: 1, target: 1, unit: "units" },
        { name: "Flue extension 1m",    have: 2, target: 2, unit: "units" },
        { name: "Pump cartridge UPS2",  have: 1, target: 1, unit: "units" },
        { name: "TRV 15mm",             have: 6, target: 8, unit: "units" },
      ],
    },
    {
      reg: "BJ23 LDM", driver: "L. Bryan", role: "Apprentice", lastSync: "yesterday",
      stock: [
        { name: "22mm copper (3m)",     have: 1, target: 4, unit: "lengths" },
        { name: "PCB (Worcester 30kW)", have: 0, target: 0, unit: "units" },
        { name: "Magnetic filter MF1",  have: 0, target: 1, unit: "units" },
        { name: "Pump cartridge UPS2",  have: 0, target: 1, unit: "units" },
        { name: "TRV 15mm",             have: 2, target: 6, unit: "units" },
      ],
    },
  ];

  const vanFill = (s: { have: number; target: number }[]) => {
    const have = s.reduce((a, b) => a + b.have, 0);
    const target = s.reduce((a, b) => a + b.target, 0) || 1;
    return Math.round((have / target) * 100);
  };
  const vanShorts = (s: { have: number; target: number }[]) => s.filter((p) => p.have < p.target).length;

  // Replenishment suggestions (auto-built from store min/max + van gaps)
  const reorder = [
    { part: "Worcester 30kW PCB",       from: "Plumb Base",    qty: 6, reason: "Store below min (4 < 5) + 1 van empty", eta: "Tomorrow am", cost: "£1,836" },
    { part: "Expansion vessel 12L",     from: "BSS",           qty: 6, reason: "Store below min (2 < 4)",               eta: "2 days",     cost: "£570" },
    { part: "Magnetic filter MF1",      from: "Plumbase",      qty: 5, reason: "Two vans empty + reserved 3 of 7",      eta: "Tomorrow am", cost: "£390" },
    { part: "22mm copper (3m)",         from: "Wolseley",      qty: 12,reason: "BG22 + BJ23 vans below target",         eta: "Same-day",   cost: "£221" },
  ];

  // Movements ledger
  const moves = [
    { t: "14:08", who: "Tony Reid",      part: "PCB x1",                dir: "out" as const, from: "Van BD21 PRX",  to: "Job J-3402",     job: "J-3402" },
    { t: "13:51", who: "Heidi (store)",  part: "22mm copper x12",       dir: "in"  as const, from: "PO-882 Wolseley", to: "Store A1-04",   job: "PO-882" },
    { t: "13:22", who: "Auto restock",   part: "Magnetic filter x2",    dir: "transfer" as const, from: "Store B4-01",    to: "Van BG22 ZTM",  job: "RST-104" },
    { t: "12:30", who: "M. Patel",       part: "Magnetic filter x1",    dir: "out" as const, from: "Van BG22 ZTM",  to: "Job J-3401",     job: "J-3401" },
    { t: "11:14", who: "L. Bryan",       part: "Pump cart. x1",         dir: "out" as const, from: "Van BJ23 LDM",  to: "Job J-3399",     job: "J-3399" },
    { t: "10:02", who: "Heidi (store)",  part: "TRV 15mm x20",          dir: "in"  as const, from: "PO-881 City Plumbing", to: "Store B1-03", job: "PO-881" },
  ];

  // Top KPIs
  const totalSkus = store.length;
  const storeValue = "£2,978";
  const belowMin = store.filter((s) => s.onHand < s.min).length;
  const vansNeedingRestock = vans.filter((v) => vanFill(v.stock) < 80).length;
  const openPOs = 3;

  const kpis = [
    { l: "SKUs tracked",        v: String(totalSkus),         sub: "store + vans",        icon: PackageSearch },
    { l: "Store value",         v: storeValue,                sub: "at cost",             icon: Warehouse },
    { l: "Below min",           v: String(belowMin),          sub: "needs reorder",       icon: AlertTriangle, tone: "warning" as const },
    { l: "Vans to restock",     v: `${vansNeedingRestock}/${vans.length}`, sub: "< 80% of target", icon: Truck,    tone: "warning" as const },
    { l: "Open POs",            v: String(openPOs),           sub: "arriving this week",  icon: ArrowDownToLine },
  ];

  return (
    <div className="space-y-5">
      <Hero
        eyebrow="Stock control · store + vans"
        title="One ledger across the store and every engineer's van."
        sub="Set min/max in the store, set per-van target kit, and let restock chips fire when any location drops below threshold. Every scan, fit and transfer lands here."
        icon={Warehouse}
        pill={`${belowMin + vansNeedingRestock} alerts open`}
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {kpis.map((k) => (
          <div key={k.l} className="flex flex-col rounded-2xl border border-hairline bg-white p-4">
            <div className="flex items-start justify-between gap-2 text-muted-foreground">
              <div className="text-[10px] font-medium uppercase tracking-wider leading-tight">{k.l}</div>
              <k.icon className={cn("h-3.5 w-3.5 shrink-0", k.tone === "warning" && "text-warning")} />
            </div>
            <div className={cn("text-display mt-3 text-xl font-bold leading-tight tabular", k.tone === "warning" ? "text-warning" : "text-foreground")}>{k.v}</div>
            <div className="mt-2 text-[10px] leading-tight text-muted-foreground">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-hairline bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1">
            {(["store", "vans", "reorder", "moves"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={cn("rounded-full px-3 py-1.5 text-xs font-medium", tab === k ? "bg-foreground text-background" : "text-muted-foreground hover:bg-surface-alt")}
              >
                {k === "store" ? "Store (warehouse)" : k === "vans" ? "Engineer vans" : k === "reorder" ? "Reorder queue" : "Movements"}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button className="flex items-center gap-1.5 rounded-full border border-hairline px-3 py-1.5 text-[11px] font-medium hover:bg-surface-alt">
              <ScanLine className="h-3.5 w-3.5" /> Scan barcode
            </button>
            <button className="flex items-center gap-1.5 rounded-full border border-hairline px-3 py-1.5 text-[11px] font-medium hover:bg-surface-alt">
              <RefreshCw className="h-3.5 w-3.5" /> Sync vans
            </button>
          </div>
        </div>

        {/* STORE */}
        {tab === "store" && (
          <div className="mt-5 divide-y divide-hairline">
            <div className="grid grid-cols-12 gap-x-3 pb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              <div className="col-span-4 min-w-0">Part</div>
              <div className="col-span-2 min-w-0">Bin / supplier</div>
              <div className="col-span-1 text-right min-w-0">On hand</div>
              <div className="col-span-1 text-right min-w-0">Reserved</div>
              <div className="col-span-2 text-right min-w-0">Min / max</div>
              <div className="col-span-1 text-right min-w-0">Value</div>
              <div className="col-span-1 text-right min-w-0">Counted</div>
            </div>
            {store.map((p) => {
              const low = p.onHand < p.min;
              return (
                <div key={p.sku} className={cn("grid grid-cols-12 gap-x-3 items-center py-3 text-sm", low && "bg-warning/5")}>
                  <div className="col-span-4 min-w-0">
                    <div className="font-medium truncate">{p.name}</div>
                    <div className="text-[10px] font-mono text-muted-foreground">{p.sku}</div>
                  </div>
                  <div className="col-span-2 min-w-0">
                    <div className="font-mono text-xs">{p.bin}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{p.supplier}</div>
                  </div>
                  <div className={cn("col-span-1 text-right font-mono tabular", low && "text-warning font-semibold")}>{p.onHand}</div>
                  <div className="col-span-1 text-right font-mono text-xs tabular text-muted-foreground">{p.reserved}</div>
                  <div className="col-span-2 text-right font-mono text-[11px] tabular text-muted-foreground">{p.min} / {p.max}</div>
                  <div className="col-span-1 text-right font-mono text-[11px] tabular text-muted-foreground">{p.value}</div>
                  <div className="col-span-1 text-right text-[10px] text-muted-foreground truncate">{p.counted}</div>
                </div>
              );
            })}
          </div>
        )}

        {/* VANS */}
        {tab === "vans" && (
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {vans.map((v) => {
              const fill = vanFill(v.stock);
              const shorts = vanShorts(v.stock);
              return (
                <div key={v.reg} className="rounded-xl border border-hairline bg-surface-alt p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Truck className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="font-mono text-xs text-muted-foreground">{v.reg}</span>
                      </div>
                      <div className="text-display mt-1 text-sm font-semibold truncate">{v.driver}</div>
                      <div className="text-[10px] text-muted-foreground">{v.role} · synced {v.lastSync}</div>
                    </div>
                    {shorts > 0 ? (
                      <span className="rounded-full border border-warning/20 bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning shrink-0">
                        {shorts} short
                      </span>
                    ) : (
                      <span className="rounded-full border border-success/20 bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success shrink-0">
                        Fully kitted
                      </span>
                    )}
                  </div>

                  <div className="mt-3 h-1.5 rounded-full bg-white">
                    <div className={cn("h-full rounded-full", fill < 60 ? "bg-warning" : fill < 90 ? "bg-foreground/60" : "bg-success")} style={{ width: `${fill}%` }} />
                  </div>
                  <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
                    <span>Kit completeness</span><span className="font-mono tabular">{fill}%</span>
                  </div>

                  <div className="mt-3 divide-y divide-hairline border-t border-hairline">
                    {v.stock.map((p) => {
                      const short = p.have < p.target;
                      return (
                        <div key={p.name} className="flex items-center justify-between py-1.5 text-[11px]">
                          <span className={cn("truncate", short && "text-warning font-medium")}>{p.name}</span>
                          <span className={cn("font-mono tabular shrink-0 ml-2", short ? "text-warning" : "text-muted-foreground")}>
                            {p.have}/{p.target} {p.unit}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {shorts > 0 && (
                    <button className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-[11px] font-medium text-background hover:opacity-90">
                      <ArrowUpFromLine className="h-3 w-3" /> Build restock list from store
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* REORDER */}
        {tab === "reorder" && (
          <div className="mt-5 divide-y divide-hairline">
            <div className="grid grid-cols-12 gap-x-3 pb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              <div className="col-span-3 min-w-0">Part</div>
              <div className="col-span-2 min-w-0">Supplier</div>
              <div className="col-span-1 text-right min-w-0">Qty</div>
              <div className="col-span-3 min-w-0">Why</div>
              <div className="col-span-1 text-right min-w-0">Cost</div>
              <div className="col-span-2 text-right min-w-0">Action</div>
            </div>
            {reorder.map((r) => (
              <div key={r.part} className="grid grid-cols-12 gap-x-3 items-center py-3 text-sm">
                <div className="col-span-3 font-medium min-w-0 truncate">{r.part}</div>
                <div className="col-span-2 text-xs text-muted-foreground min-w-0 truncate">{r.from}</div>
                <div className="col-span-1 text-right font-mono tabular">{r.qty}</div>
                <div className="col-span-3 text-[11px] text-muted-foreground min-w-0 truncate">{r.reason} · ETA {r.eta}</div>
                <div className="col-span-1 text-right font-mono text-xs tabular">{r.cost}</div>
                <div className="col-span-2 flex justify-end gap-1.5 min-w-0">
                  <button className="rounded-full border border-hairline px-2.5 py-1 text-[11px] hover:bg-surface-alt">Edit</button>
                  <button className="rounded-full bg-foreground px-2.5 py-1 text-[11px] text-background hover:opacity-90">Raise PO</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* MOVEMENTS */}
        {tab === "moves" && (
          <div className="mt-5 divide-y divide-hairline">
            <div className="grid grid-cols-12 gap-x-3 pb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              <div className="col-span-1 min-w-0">Time</div>
              <div className="col-span-2 min-w-0">Who</div>
              <div className="col-span-3 min-w-0">Part</div>
              <div className="col-span-2 min-w-0">From</div>
              <div className="col-span-2 min-w-0">To</div>
              <div className="col-span-1 min-w-0">Type</div>
              <div className="col-span-1 text-right min-w-0">Ref</div>
            </div>
            {moves.map((m, i) => (
              <div key={i} className="grid grid-cols-12 gap-x-3 items-center py-3 text-sm">
                <div className="col-span-1 font-mono text-xs text-muted-foreground min-w-0">{m.t}</div>
                <div className="col-span-2 font-medium min-w-0 truncate">{m.who}</div>
                <div className="col-span-3 min-w-0 truncate">{m.part}</div>
                <div className="col-span-2 text-[11px] text-muted-foreground min-w-0 truncate">{m.from}</div>
                <div className="col-span-2 text-[11px] text-muted-foreground min-w-0 truncate">{m.to}</div>
                <div className="col-span-1 min-w-0">
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-medium",
                    m.dir === "in" ? "bg-success/10 text-success" :
                    m.dir === "out" ? "bg-accent/10 text-accent" :
                    "bg-foreground/10 text-foreground"
                  )}>
                    {m.dir === "in" ? "In" : m.dir === "out" ? "Fitted" : "Transfer"}
                  </span>
                </div>
                <div className="col-span-1 text-right font-mono text-[11px] text-muted-foreground min-w-0 truncate">{m.job}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ────── SUPPLIER HUB ────── */
function SupplierNormaliser() {
  const [tab, setTab] = useState<"overview" | "directory" | "compare" | "jobs" | "conflicts">("overview");

  // Supplier directory - port of truth
  const suppliers = [
    {
      name: "Wolseley", tier: "Primary", rating: 4.6, onTime: 96, accountMgr: "Dan Wright",
      phone: "0345 762 4321", email: "trade.romford@wolseley.co.uk",
      bestFor: ["Copper & fittings", "Flue components", "TRVs"],
      spend30d: "£4,820", openPOs: 2, lastDelivery: "today",
    },
    {
      name: "City Plumbing", tier: "Primary", rating: 4.4, onTime: 94, accountMgr: "Asha Patel",
      phone: "0203 818 1100", email: "romford@cityplumbing.co.uk",
      bestFor: ["Heat exchangers", "Vaillant spares", "Cylinders"],
      spend30d: "£3,140", openPOs: 1, lastDelivery: "yesterday",
    },
    {
      name: "Plumbase", tier: "Secondary", rating: 4.1, onTime: 89, accountMgr: "Mark Ellis",
      phone: "0208 553 9090", email: "trade@plumbase.com",
      bestFor: ["Magnetic filters", "Pump cartridges", "LPG fittings"],
      spend30d: "£1,960", openPOs: 0, lastDelivery: "3d ago",
    },
    {
      name: "BSS", tier: "Specialist", rating: 4.7, onTime: 92, accountMgr: "Karen Doyle",
      phone: "0345 070 2425", email: "ilford@bssgroup.com",
      bestFor: ["Commercial valves", "Expansion vessels", "Plant parts"],
      spend30d: "£2,440", openPOs: 1, lastDelivery: "2d ago",
    },
  ];

  // Cross-supplier price matrix per canonical part (best highlighted)
  const matrix = [
    {
      canon: "22mm copper pipe (3m)", sku: "CU-22-3M", inStock: 48, min: 30,
      quotes: [
        { sup: "Wolseley",      name: "Copper Pipe 22mm 3M",   price: 18.40, lead: "Same-day" },
        { sup: "City Plumbing", name: "22MM Copper Tube 3m",   price: 19.20, lead: "Next-day" },
        { sup: "Plumbase",      name: "Cu pipe 22 x 3000",     price: 19.95, lead: "Next-day" },
      ],
    },
    {
      canon: "Worcester 30kW PCB", sku: "WB-30-PCB", inStock: 4, min: 5,
      quotes: [
        { sup: "Wolseley",      name: "Worcester 30CDi PCB",   price: 312.00, lead: "Next-day" },
        { sup: "City Plumbing", name: "PCB Worcester 30kW",    price: 298.50, lead: "Next-day" },
        { sup: "Plumb Base",    name: "Worcester PCB 30",      price: 306.00, lead: "2 days" },
      ],
    },
    {
      canon: "Magnetic filter MF1 (1\" BSP)", sku: "MF-1-BSP", inStock: 7, min: 6,
      quotes: [
        { sup: "Wolseley",      name: "MagnaClean Professional 1\"", price: 82.00, lead: "Same-day" },
        { sup: "Plumbase",      name: "Magnetic Filter 1in",         price: 78.00, lead: "Next-day" },
        { sup: "City Plumbing", name: "Magnetic filter 1 BSP",       price: 84.50, lead: "Same-day" },
      ],
    },
    {
      canon: "Expansion vessel 12L", sku: "EV-12L", inStock: 2, min: 4,
      quotes: [
        { sup: "BSS",      name: "Zilmet 12L vessel",  price: 91.00, lead: "Next-day" },
        { sup: "Wolseley", name: "Reliance 12L EV",    price: 95.40, lead: "Same-day" },
      ],
    },
  ];

  // Parts required by upcoming jobs - matched to stock + best supplier
  const jobsNeeds = [
    { job: "J-3402", cust: "Highbridge Foods",  when: "Tomorrow 08:30", part: "Worcester 30kW PCB",   need: 1, inStock: 4, status: "ok" as const },
    { job: "J-3404", cust: "Greenfield Care",   when: "Tomorrow 11:00", part: "Magnetic filter MF1",  need: 2, inStock: 7, status: "ok" as const },
    { job: "J-3407", cust: "Crestmont Apts",    when: "Thu 09:00",      part: "Expansion vessel 12L", need: 2, inStock: 2, status: "short" as const,  bestSup: "BSS",      bestPrice: "£91.00" },
    { job: "J-3411", cust: "ABC School",        when: "Thu 13:30",      part: "Worcester 30kW PCB",   need: 2, inStock: 4, status: "watch" as const,  bestSup: "City Plumbing", bestPrice: "£298.50" },
    { job: "J-3415", cust: "Riverside Hotel",   when: "Fri 08:00",      part: "22mm copper (3m) x8",  need: 8, inStock: 48, status: "ok" as const },
    { job: "J-3418", cust: "Northgate Flats",   when: "Fri 14:00",      part: "Pump cart. UPS2",      need: 3, inStock: 12, status: "ok" as const },
  ];

  // Conflict queue (price-list normalisation)
  const conflicts = [
    { items: ["Boiler thermostat WR-30", "Thermostat Worcester 30"], conf: 78 },
    { items: ["Flue 60/100 1m", "Concentric flue 60/100 1000mm"], conf: 64 },
  ];

  // Overview KPIs
  const kpis = [
    { l: "Active suppliers", v: String(suppliers.length), sub: "incl. 2 primary",       icon: Truck },
    { l: "Spend · 30d",      v: "£12.4k",                  sub: "across all suppliers",  icon: Receipt },
    { l: "On-time average",  v: "93%",                     sub: "rolling 30d",           icon: CheckCircle2 },
    { l: "Open POs",         v: String(suppliers.reduce((a, s) => a + s.openPOs, 0)), sub: "arriving this week", icon: ArrowDownToLine },
    { l: "Parts short for jobs", v: String(jobsNeeds.filter(j => j.status === "short").length), sub: "needs ordering now", icon: AlertTriangle, tone: "warning" as const },
  ];

  return (
    <div className="space-y-5">
      <Hero
        eyebrow="Supplier hub · port of truth"
        title="Every supplier, every part, every price - linked to stock and jobs."
        sub="Who's best for what, who to ring, latest prices side-by-side, what each upcoming job needs and whether the store can cover it. Drop a price file to refresh everything."
        icon={Truck}
        pill="Synced with Parts & Vans"
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {kpis.map((k) => (
          <div key={k.l} className="flex flex-col rounded-2xl border border-hairline bg-white p-4">
            <div className="flex items-start justify-between gap-2 text-muted-foreground">
              <div className="text-[10px] font-medium uppercase tracking-wider leading-tight">{k.l}</div>
              <k.icon className={cn("h-3.5 w-3.5 shrink-0", k.tone === "warning" && "text-warning")} />
            </div>
            <div className={cn("text-display mt-3 text-xl font-bold leading-tight tabular", k.tone === "warning" ? "text-warning" : "text-foreground")}>{k.v}</div>
            <div className="mt-2 text-[10px] leading-tight text-muted-foreground">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Drop zone */}
      <div className="rounded-2xl border border-dashed border-hairline bg-white p-6 text-center">
        <PackageSearch className="mx-auto h-6 w-6 text-muted-foreground" />
        <div className="mt-3 text-sm font-medium">Drop a supplier price file here</div>
        <div className="mt-1 text-xs text-muted-foreground">CSV, XLSX, PDF, DOCX, TXT or images · or click to browse</div>
        <div className="mt-1 text-[11px] text-muted-foreground">Last upload: Wolseley · 14 Jun · 412 SKUs matched, 6 conflicts</div>
      </div>

      {/* Tabs */}
      <div className="rounded-2xl border border-hairline bg-white p-5">
        <div className="flex flex-wrap gap-1">
          {(["overview", "directory", "compare", "jobs", "conflicts"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={cn("rounded-full px-3 py-1.5 text-xs font-medium", tab === k ? "bg-foreground text-background" : "text-muted-foreground hover:bg-surface-alt")}
            >
              {k === "overview" ? "Best for what" :
               k === "directory" ? "Directory & contacts" :
               k === "compare" ? "Price comparison" :
               k === "jobs" ? "Job needs" :
               `Conflicts · ${conflicts.length}`}
            </button>
          ))}
        </div>

        {/* OVERVIEW - best-for matrix */}
        {tab === "overview" && (
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {suppliers.map((s) => (
              <div key={s.name} className="rounded-xl border border-hairline bg-surface-alt p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-display text-sm font-semibold truncate">{s.name}</div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">{s.tier}</div>
                  </div>
                  <div className="flex items-center gap-1 text-[11px] font-mono tabular text-muted-foreground shrink-0">
                    <Star className="h-3 w-3 fill-warning text-warning" /> {s.rating}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {s.bestFor.map((b) => (
                    <span key={b} className="rounded-full bg-white border border-hairline px-2 py-0.5 text-[10px] font-medium">{b}</span>
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-hairline pt-3 text-[10px] text-muted-foreground">
                  <div><div className="font-mono tabular text-sm text-foreground">{s.onTime}%</div>on-time</div>
                  <div><div className="font-mono tabular text-sm text-foreground">{s.spend30d}</div>spend 30d</div>
                  <div><div className="font-mono tabular text-sm text-foreground">{s.openPOs}</div>open POs</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* DIRECTORY */}
        {tab === "directory" && (
          <div className="mt-5 divide-y divide-hairline">
            <div className="grid grid-cols-12 gap-x-3 pb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              <div className="col-span-3 min-w-0">Supplier</div>
              <div className="col-span-3 min-w-0">Account manager</div>
              <div className="col-span-4 min-w-0">Contact</div>
              <div className="col-span-2 text-right min-w-0">Last delivery</div>
            </div>
            {suppliers.map((s) => (
              <div key={s.name} className="grid grid-cols-12 gap-x-3 items-center py-3 text-sm">
                <div className="col-span-3 min-w-0">
                  <div className="font-medium truncate">{s.name}</div>
                  <div className="text-[10px] text-muted-foreground">{s.tier} · {s.rating}★</div>
                </div>
                <div className="col-span-3 text-xs min-w-0 truncate">{s.accountMgr}</div>
                <div className="col-span-4 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground truncate">
                    <Phone className="h-3 w-3 shrink-0" /><span className="font-mono">{s.phone}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground truncate">
                    <Mail className="h-3 w-3 shrink-0" /><span className="truncate">{s.email}</span>
                  </div>
                </div>
                <div className="col-span-2 text-right text-[11px] text-muted-foreground">{s.lastDelivery}</div>
              </div>
            ))}
          </div>
        )}

        {/* PRICE COMPARISON */}
        {tab === "compare" && (
          <div className="mt-5 space-y-4">
            {matrix.map((m) => {
              const best = Math.min(...m.quotes.map((q) => q.price));
              const lowStock = m.inStock < m.min;
              return (
                <div key={m.sku} className="rounded-xl border border-hairline overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline bg-surface-alt px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="text-display text-sm font-semibold truncate">{m.canon}</div>
                      <div className="text-[10px] font-mono text-muted-foreground">{m.sku}</div>
                    </div>
                    <span className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-medium",
                      lowStock ? "bg-warning/10 text-warning border border-warning/20" : "bg-success/10 text-success border border-success/20"
                    )}>
                      Stock {m.inStock} / min {m.min}{lowStock ? " · reorder" : ""}
                    </span>
                  </div>
                  <div className="divide-y divide-hairline">
                    {m.quotes.map((q, i) => (
                      <div key={i} className={cn("grid grid-cols-12 gap-x-3 items-center px-4 py-2 text-xs", q.price === best && "bg-success/5")}>
                        <div className="col-span-3 font-medium min-w-0 truncate">{q.sup}</div>
                        <div className="col-span-4 text-muted-foreground min-w-0 truncate">{q.name}</div>
                        <div className="col-span-2 text-[11px] text-muted-foreground min-w-0">{q.lead}</div>
                        <div className="col-span-2 text-right font-mono tabular">£{q.price.toFixed(2)}</div>
                        <div className="col-span-1 text-right min-w-0">
                          {q.price === best && <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">Best</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* JOB NEEDS */}
        {tab === "jobs" && (
          <div className="mt-5 divide-y divide-hairline">
            <div className="grid grid-cols-12 gap-x-3 pb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              <div className="col-span-1 min-w-0">Job</div>
              <div className="col-span-3 min-w-0">Customer · when</div>
              <div className="col-span-3 min-w-0">Part required</div>
              <div className="col-span-1 text-right min-w-0">Need</div>
              <div className="col-span-1 text-right min-w-0">Stock</div>
              <div className="col-span-2 min-w-0">Best supplier</div>
              <div className="col-span-1 text-right min-w-0">Action</div>
            </div>
            {jobsNeeds.map((j) => (
              <div key={j.job} className={cn("grid grid-cols-12 gap-x-3 items-center py-3 text-sm", j.status === "short" && "bg-warning/5")}>
                <div className="col-span-1 font-mono text-xs text-muted-foreground min-w-0 truncate">{j.job}</div>
                <div className="col-span-3 min-w-0">
                  <div className="font-medium truncate">{j.cust}</div>
                  <div className="text-[10px] text-muted-foreground">{j.when}</div>
                </div>
                <div className="col-span-3 min-w-0 truncate text-xs">{j.part}</div>
                <div className="col-span-1 text-right font-mono tabular">{j.need}</div>
                <div className={cn(
                  "col-span-1 text-right font-mono tabular",
                  j.status === "short" ? "text-warning font-semibold" : j.status === "watch" ? "text-warning" : "text-muted-foreground"
                )}>{j.inStock}</div>
                <div className="col-span-2 min-w-0 text-[11px]">
                  {j.bestSup ? (
                    <><span className="font-medium">{j.bestSup}</span><span className="text-muted-foreground"> · {j.bestPrice}</span></>
                  ) : (
                    <span className="text-muted-foreground">Covered by store</span>
                  )}
                </div>
                <div className="col-span-1 flex justify-end min-w-0">
                  {j.status === "short" ? (
                    <button className="rounded-full bg-foreground px-2.5 py-1 text-[10px] font-medium text-background hover:opacity-90">Raise PO</button>
                  ) : (
                    <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">OK</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* CONFLICTS */}
        {tab === "conflicts" && (
          <div className="mt-5 divide-y divide-hairline">
            {conflicts.map((c, i) => (
              <div key={i} className="grid grid-cols-12 gap-x-3 items-center gap-3 py-3 text-sm">
                <div className="col-span-8 text-xs min-w-0">
                  <span className="font-mono">{c.items[0]}</span>
                  <span className="text-muted-foreground"> vs </span>
                  <span className="font-mono">{c.items[1]}</span>
                </div>
                <div className="col-span-2 font-mono text-xs tabular text-muted-foreground min-w-0">{c.conf}% conf.</div>
                <div className="col-span-2 flex justify-end gap-1.5 min-w-0">
                  <button className="rounded-full border border-hairline px-2.5 py-1 text-[11px] hover:bg-surface-alt">Keep separate</button>
                  <button className="rounded-full bg-foreground px-2.5 py-1 text-[11px] text-background hover:opacity-90">Merge</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ────── WARRANTY TRACKER ────── */
function WarrantyTracker() {
  const assets = [
    { id: "A-104", cust: "ABC School", asset: "Worcester 30CDi", install: "12 Mar 2022", end: "12 Mar 2027", mfr: "Worcester", status: "In warranty" as const },
    { id: "A-103", cust: "Greenfield Care", asset: "Vaillant ecoTEC 38", install: "04 Feb 2021", end: "04 Feb 2026", mfr: "Vaillant", status: "Expiring 90d" as const },
    { id: "A-102", cust: "Highbridge Foods", asset: "Ideal Evomax 80", install: "22 Jun 2020", end: "22 Jun 2025", mfr: "Ideal", status: "Expired" as const },
    { id: "A-101", cust: "Crestmont Apts", asset: "Worcester 42CDi", install: "11 Nov 2023", end: "11 Nov 2028", mfr: "Worcester", status: "In warranty" as const },
  ];
  const tone: Record<typeof assets[number]["status"], string> = {
    "In warranty": "bg-success/10 text-success",
    "Expiring 90d": "bg-warning/10 text-warning",
    Expired: "bg-muted/40 text-muted-foreground",
  };
  return (
    <div className="space-y-5">
      <Hero
        eyebrow="Warranty tracker"
        title="Stop paying for work the manufacturer owes us."
        sub="Every installed asset, its warranty window, and the £ value of callbacks we should be claiming back from manufacturers rather than absorbing."
        icon={Receipt}
      />
      <StatTiles tiles={[
        { l: "Assets tracked", v: "1,840", sub: "across 312 customers", icon: HardDrive },
        { l: "In warranty", v: "612", sub: "claimable callbacks", icon: ShieldCheck },
        { l: "Expiring 90d", v: "47", sub: "renewal opportunities", icon: AlertTriangle },
        { l: "Recoverable £ (YTD)", v: "£18.4k", sub: "manufacturer claims", icon: TrendingUp },
      ]} />

      <div className="rounded-2xl border border-hairline bg-white">
        <div className="grid grid-cols-12 gap-x-3 border-b border-hairline px-5 py-3 text-[10px] uppercase tracking-wider text-muted-foreground">
          <div className="col-span-3 min-w-0">Customer</div>
          <div className="col-span-3 min-w-0">Asset</div>
          <div className="col-span-2 min-w-0">Installed</div>
          <div className="col-span-2 min-w-0">Warranty ends</div>
          <div className="col-span-1 min-w-0">Mfr</div>
          <div className="col-span-1 text-right min-w-0">Status</div>
        </div>
        {assets.map((a) => (
          <div key={a.id} className="grid grid-cols-12 gap-x-3 items-center border-b border-hairline px-5 py-3 text-sm last:border-0 hover:bg-surface-alt">
            <div className="col-span-3 font-medium min-w-0">{a.cust}</div>
            <div className="col-span-3 text-xs min-w-0">{a.asset}</div>
            <div className="col-span-2 font-mono text-xs text-muted-foreground min-w-0">{a.install}</div>
            <div className="col-span-2 font-mono text-xs min-w-0">{a.end}</div>
            <div className="col-span-1 text-xs text-muted-foreground min-w-0">{a.mfr}</div>
            <div className="col-span-1 flex justify-end min-w-0">
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", tone[a.status])}>{a.status}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ────── PPM ────── */
function PPM() {
  const contracts = [
    { cust: "ABC School", assets: 8, renews: "12 Mar 2027", value: "£4,800/yr", status: "Active" },
    { cust: "Greenfield Care Home", assets: 4, renews: "04 Feb 2026", value: "£2,400/yr", status: "Renewing" },
    { cust: "Highbridge Foods Ltd", assets: 12, renews: "01 Sep 2026", value: "£7,200/yr", status: "Active" },
    { cust: "Crestmont Apartments", assets: 22, renews: "expired", value: "£9,600/yr", status: "Lapsed" },
  ];
  const prompts = [
    { cust: "ABC School", asset: "Boiler #1", due: "in 8 days" },
    { cust: "Greenfield Care", asset: "Plant room pumps", due: "in 14 days" },
    { cust: "Highbridge Foods", asset: "Conveyor heater", due: "in 21 days" },
  ];
  return (
    <div className="space-y-5">
      <Hero
        eyebrow="PPM & service reminders"
        title="Recurring revenue, on schedule."
        sub="Every contract, every service due in the next 90 days, every auto-prompt waiting for a human to send. This is where the predictable money lives."
        icon={CalendarClock}
      />
      <StatTiles tiles={[
        { l: "Active contracts", v: "47", sub: "across 312 customers", icon: FileText },
        { l: "Annual value", v: "£148k", sub: "recurring revenue", icon: TrendingUp },
        { l: "Due · next 90d", v: "62", sub: "services to book", icon: CalendarClock },
        { l: "Renewals · 60d", v: "8", sub: "£28k at risk", icon: AlertTriangle },
      ]} />

      <div className="rounded-2xl border border-hairline bg-white p-5">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Next 90 days</div>
        <div className="text-display mt-1 text-sm font-semibold">Service load by week</div>
        <div className="mt-5 flex h-20 items-end gap-1">
          {Array.from({ length: 13 }).map((_, i) => {
            const h = 25 + ((i * 17) % 55);
            return <div key={i} className="flex-1 rounded-sm bg-foreground/70" style={{ height: `${h}px` }} />;
          })}
        </div>
        <div className="mt-3 flex justify-between font-mono text-[10px] text-muted-foreground">
          <span>W1</span><span>W4</span><span>W8</span><span>W13</span>
        </div>
      </div>

      <div className="rounded-2xl border border-hairline bg-white">
        <div className="border-b border-hairline px-5 py-3 text-[11px] uppercase tracking-wider text-muted-foreground">Contracts</div>
        <div className="grid grid-cols-12 gap-x-3 border-b border-hairline px-5 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          <div className="col-span-4 min-w-0">Customer</div>
          <div className="col-span-2 text-right min-w-0">Assets</div>
          <div className="col-span-3 min-w-0">Renews</div>
          <div className="col-span-2 text-right min-w-0">Value</div>
          <div className="col-span-1 text-right min-w-0">Status</div>
        </div>
        {contracts.map((c) => (
          <div key={c.cust} className="grid grid-cols-12 gap-x-3 items-center border-b border-hairline px-5 py-3 text-sm last:border-0">
            <div className="col-span-4 font-medium min-w-0">{c.cust}</div>
            <div className="col-span-2 text-right font-mono text-xs tabular min-w-0">{c.assets}</div>
            <div className="col-span-3 font-mono text-xs min-w-0">{c.renews}</div>
            <div className="col-span-2 text-right font-mono text-xs tabular min-w-0">{c.value}</div>
            <div className="col-span-1 flex justify-end min-w-0">
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium",
                c.status === "Active" && "bg-success/10 text-success",
                c.status === "Renewing" && "bg-accent/10 text-accent",
                c.status === "Lapsed" && "bg-destructive/10 text-destructive",
              )}>{c.status}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-hairline bg-white">
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Auto-prompt queue</div>
            <div className="text-display mt-0.5 text-sm font-semibold">3-month service cycles · awaiting trigger</div>
          </div>
          <span className="rounded-full border border-accent/20 bg-accent/10 px-2.5 py-1 text-[10px] font-medium text-accent">{prompts.length} ready</span>
        </div>
        {prompts.map((p, i) => (
          <div key={i} className="grid grid-cols-12 gap-x-3 items-center border-b border-hairline px-5 py-3 text-sm last:border-0">
            <div className="col-span-4 font-medium min-w-0">{p.cust}</div>
            <div className="col-span-4 text-xs text-muted-foreground min-w-0">{p.asset}</div>
            <div className="col-span-2 font-mono text-xs min-w-0">{p.due}</div>
            <div className="col-span-2 flex justify-end gap-1.5 min-w-0">
              <button className="rounded-full border border-hairline px-2.5 py-1 text-[11px]">Snooze</button>
              <button className="rounded-full bg-foreground px-2.5 py-1 text-[11px] text-background">Approve send</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ────── CUSTOMERS (5-year asset visual + wraparound) ────── */
type CustomerCard = {
  id: string; name: string; assets: number; plant: number;
  next: string; value: string;
};
const CUSTOMERS: CustomerCard[] = [
  { id: "C-01", name: "ABC School", assets: 8, plant: 84, next: "Boiler #1 service · 8d", value: "£4,800/yr" },
  { id: "C-02", name: "Greenfield Care Home", assets: 4, plant: 71, next: "Pump replacement · 30d", value: "£2,400/yr" },
  { id: "C-03", name: "Highbridge Foods Ltd", assets: 12, plant: 92, next: "Conveyor service · 21d", value: "£7,200/yr" },
  { id: "C-04", name: "Crestmont Apartments", assets: 22, plant: 58, next: "5 boilers nearing EOL · 6m", value: "£9,600/yr" },
];

export function Customers() {
  const [tab, setTab] = useState<"health" | "wraparound">("health");
  const [open, setOpen] = useState<CustomerCard | null>(null);

  const reviews = [
    { cust: "ABC School", job: "J-3390 · emergency call-out", status: "Received", rating: 5 },
    { cust: "Greenfield Care", job: "J-3388 · annual service", status: "Sent", rating: null },
    { cust: "12 Marlborough Rd", job: "J-3385 · install", status: "Not sent", rating: null, flag: "Big job - Mary to send" },
    { cust: "Highbridge Foods", job: "J-3380 · plant room", status: "Flagged", rating: 2, flag: "Sentiment risk" },
  ];

  return (
    <div className="space-y-5">
      <Hero
        eyebrow="Customers"
        title="The full picture, per customer."
        sub="5-year asset health on one side, the human wraparound on the other. Every big or problem job is auto-flagged so Mary or Heidi can add the personal touch."
        icon={Users}
      />

      <div className="flex gap-1">
        {(["health", "wraparound"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cn("rounded-full px-3 py-1.5 text-xs font-medium", tab === k ? "bg-foreground text-background" : "text-muted-foreground hover:bg-surface-alt")}
          >
            {k === "health" ? "Asset health · 5-year" : "Wraparound & reviews"}
          </button>
        ))}
      </div>

      {tab === "health" && (
        <div className="grid gap-3 md:grid-cols-2">
          {CUSTOMERS.map((c) => (
            <button key={c.id} onClick={() => setOpen(c)} className="rounded-2xl border border-hairline bg-white p-5 text-left hover:border-foreground/40">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Customer</div>
                  <div className="text-display text-sm font-semibold">{c.name}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Plant room</div>
                  <div className="text-display text-lg font-bold tabular">{c.plant}</div>
                </div>
              </div>

              <div className="mt-4 flex h-1.5 overflow-hidden rounded-full bg-surface-alt">
                <div className="bg-success/60" style={{ width: "40%" }} />
                <div className="bg-warning/60" style={{ width: "20%" }} />
                <div className="bg-destructive/40" style={{ width: "15%" }} />
              </div>
              <div className="mt-2 flex justify-between font-mono text-[10px] text-muted-foreground">
                <span>Y1</span><span>Y2</span><span>Y3</span><span>Y4</span><span>Y5</span>
              </div>

              <div className="mt-4 border-t border-hairline pt-3 text-[11px]">
                <div className="flex justify-between"><span className="text-muted-foreground">Assets</span><span className="font-mono tabular">{c.assets}</span></div>
                <div className="mt-1 flex justify-between"><span className="text-muted-foreground">Contract</span><span className="font-mono tabular">{c.value}</span></div>
                <div className="mt-1 flex justify-between"><span className="text-muted-foreground">Next</span><span>{c.next}</span></div>
              </div>
            </button>
          ))}
        </div>
      )}

      {tab === "wraparound" && (
        <div className="rounded-2xl border border-hairline bg-white">
          <div className="border-b border-hairline px-5 py-3 text-[11px] uppercase tracking-wider text-muted-foreground">Completed jobs · review status</div>
          {reviews.map((r, i) => (
            <div key={i} className="grid grid-cols-12 gap-x-3 items-center border-b border-hairline px-5 py-3 text-sm last:border-0">
              <div className="col-span-3 font-medium min-w-0">{r.cust}</div>
              <div className="col-span-4 text-xs text-muted-foreground min-w-0">{r.job}</div>
              <div className="col-span-2 min-w-0">
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium",
                  r.status === "Received" && "bg-success/10 text-success",
                  r.status === "Sent" && "bg-accent/10 text-accent",
                  r.status === "Not sent" && "bg-muted/40 text-muted-foreground",
                  r.status === "Flagged" && "bg-destructive/10 text-destructive",
                )}>{r.status}</span>
              </div>
              <div className="col-span-2 flex items-center gap-0.5 min-w-0">
                {r.rating && Array.from({ length: 5 }).map((_, j) => (
                  <Star key={j} className={cn("h-3 w-3", j < r.rating! ? "fill-warning text-warning" : "text-muted-foreground/30")} />
                ))}
                {r.flag && <span className="ml-2 text-[10px] text-warning">{r.flag}</span>}
              </div>
              <div className="col-span-1 flex justify-end min-w-0">
                <button className="rounded-full border border-hairline px-2.5 py-1 text-[11px]">Send</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="max-w-2xl">
          {open && (
            <>
              <DialogHeader>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Customer · plant room health {open.plant}</div>
                <DialogTitle className="text-display text-xl font-semibold">{open.name}</DialogTitle>
                <DialogDescription>5-year asset timeline · service, likely failure and break-even-to-replace markers.</DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2">
                {["Boiler #1 · Worcester 30CDi", "Boiler #2 · Worcester 30CDi", "Plant room pumps · Grundfos UPS2"].map((a, i) => (
                  <div key={a} className="rounded-xl border border-hairline bg-surface-alt p-4">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">{a}</span>
                      <span className="text-muted-foreground font-mono">installed {2020 + i}</span>
                    </div>
                    <div className="relative mt-4 h-8 rounded-md bg-white">
                      {[15, 45, 70].map((p, j) => (
                        <span key={j} className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full bg-success px-1.5 py-0.5 text-[9px] font-medium text-white" style={{ left: `${p}%` }}>service</span>
                      ))}
                      <span className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full bg-warning px-1.5 py-0.5 text-[9px] font-medium text-white" style={{ left: "82%" }}>likely failure</span>
                      <span className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full bg-destructive px-1.5 py-0.5 text-[9px] font-medium text-white" style={{ left: "95%" }}>replace</span>
                    </div>
                    <div className="mt-2 flex justify-between font-mono text-[10px] text-muted-foreground">
                      <span>now</span><span>Y1</span><span>Y2</span><span>Y3</span><span>Y4</span><span>Y5</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-hairline pt-4">
                <button className="rounded-full border border-hairline px-3 py-1.5 text-xs">Open customer record</button>
                <button className="rounded-full bg-foreground px-3 py-1.5 text-xs text-background">Generate customer report</button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ────── APPROVAL QUEUE (panel, used inside Agents) ────── */
export function ApprovalQueuePanel() {
  const queue = [
    { agent: "Quote Agent", action: "Send quote PDF", target: "Highbridge Foods · £2,120", conf: 88 },
    { agent: "Inbox Agent", action: "Reply to complaint", target: "Greenfield Care Home", conf: 79 },
    { agent: "Customer Care Agent", action: "Follow-up SMS", target: "M. Greene", conf: 94 },
    { agent: "Finance Agent", action: "Send chase letter", target: "ABC School · INV-3361", conf: 91 },
    { agent: "Procurement Agent", action: "Switch supplier on order", target: "PO-883 · save £42", conf: 86 },
  ];
  return (
    <div className="rounded-2xl border border-hairline bg-white">
      <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Approval queue</div>
          <div className="text-display mt-0.5 text-sm font-semibold">Agent actions awaiting a human</div>
        </div>
        <span className="rounded-full border border-accent/20 bg-accent/10 px-2.5 py-1 text-[10px] font-medium text-accent">{queue.length} pending</span>
      </div>
      {queue.map((q, i) => (
        <div key={i} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline px-5 py-3 text-sm last:border-0">
          <div className="flex min-w-0 flex-1 basis-[180px] items-center gap-2">
            <span className="truncate font-medium">{q.agent}</span>
          </div>
          <div className="min-w-0 flex-1 basis-[160px] truncate text-xs">{q.action}</div>
          <div className="min-w-0 flex-1 basis-[180px] truncate text-xs text-muted-foreground">{q.target}</div>
          <div className="shrink-0 rounded-full border border-hairline bg-surface-alt px-2 py-0.5 font-mono text-[11px] tabular text-muted-foreground">{q.conf}%</div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button className="rounded-full border border-hairline px-2.5 py-1 text-[11px] hover:bg-surface-alt">Reject</button>
            <button className="rounded-full border border-hairline px-2.5 py-1 text-[11px] hover:bg-surface-alt">Edit</button>
            <button className="rounded-full bg-foreground px-2.5 py-1 text-[11px] text-background hover:opacity-90">Approve</button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ────── RECURRING ISSUES (panel, used inside Calls) ────── */
export function RecurringIssuesPanel() {
  const issues = [
    { issue: "No heating · cold-snap spike", count: 22, trend: "+8 vs last mo" },
    { issue: "Boiler lockout · F22 fault", count: 14, trend: "+3" },
    { issue: "Pump noise · plant rooms", count: 9, trend: "−1" },
    { issue: "Pressure loss · domestic", count: 8, trend: "+2" },
    { issue: "Hot water intermittent", count: 6, trend: "flat" },
  ];
  return (
    <div className="rounded-2xl border border-hairline bg-white">
      <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Recurring issues · this month</div>
          <div className="text-display mt-0.5 text-sm font-semibold">What customers keep ringing about</div>
        </div>
        <span className="rounded-full border border-warning/20 bg-warning/10 px-2.5 py-1 text-[10px] font-medium text-warning">Top 5</span>
      </div>
      {issues.map((x, i) => (
        <div key={i} className="grid grid-cols-12 gap-x-3 items-center border-b border-hairline px-5 py-3 text-sm last:border-0 hover:bg-surface-alt">
          <div className="col-span-1 text-display text-lg font-bold tabular text-muted-foreground min-w-0">{i + 1}</div>
          <div className="col-span-7 font-medium min-w-0">{x.issue}</div>
          <div className="col-span-2 font-mono text-xs tabular min-w-0">{x.count} calls</div>
          <div className="col-span-2 text-right text-[11px] text-muted-foreground min-w-0">{x.trend}</div>
        </div>
      ))}
    </div>
  );
}

/* ────── SYSTEMS INVENTORY (panel, used inside Settings) ────── */
export function SystemsInventoryPanel() {
  const rows = [
    { sys: "Commusoft", owner: "Sam", purpose: "Jobs, scheduling, invoicing", status: "In use" as const },
    { sys: "QuickBooks", owner: "Heidi", purpose: "Books & VAT", status: "In use" as const },
    { sys: "Google Drive", owner: "All", purpose: "Docs, photos, RAMS", status: "In use" as const },
    { sys: "Perplexity", owner: "Heidi", purpose: "Research", status: "In use" as const },
    { sys: "Trello", owner: "Mary", purpose: "Office tasks", status: "Sunset" as const },
    { sys: "Slack", owner: "All", purpose: "Internal comms", status: "In use" as const },
    { sys: "Notion", owner: "Heidi", purpose: "SOPs & playbooks", status: "Pilot" as const },
  ];
  return (
    <div className="rounded-2xl border border-hairline bg-white">
      <div className="border-b border-hairline px-5 py-3">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Systems inventory</div>
        <div className="text-display mt-0.5 text-sm font-semibold">What we actually use, who owns it, why it exists</div>
      </div>
      <div className="grid grid-cols-12 gap-x-3 border-b border-hairline px-5 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <div className="col-span-3 min-w-0">System</div>
        <div className="col-span-2 min-w-0">Owner</div>
        <div className="col-span-5 min-w-0">Purpose</div>
        <div className="col-span-2 text-right min-w-0">Status</div>
      </div>
      {rows.map((r) => (
        <div key={r.sys} className="grid grid-cols-12 gap-x-3 items-center border-b border-hairline px-5 py-3 text-sm last:border-0">
          <div className="col-span-3 font-medium min-w-0">{r.sys}</div>
          <div className="col-span-2 text-xs text-muted-foreground min-w-0">{r.owner}</div>
          <div className="col-span-5 text-xs min-w-0">{r.purpose}</div>
          <div className="col-span-2 flex justify-end min-w-0">
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium",
              r.status === "In use" && "bg-success/10 text-success",
              r.status === "Sunset" && "bg-muted/40 text-muted-foreground",
              r.status === "Pilot" && "bg-accent/10 text-accent",
            )}>{r.status}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
