import { useState } from "react";
import {
  IdCard, Wrench, User, Building2, Phone, Mail, MapPin, ParkingCircle,
  Flame, Users2, AlertTriangle, ShieldCheck, Camera, FileText, Clock,
  CheckCircle2, XCircle, ChevronRight, Sparkles, Activity, Calendar,
  Banknote, Search, Filter, Bed, Car, PoundSterling, Gauge, History,
  PhoneCall, MessageSquare, FileSignature, Package, Image as ImageIcon,
  ClipboardList, BellRing, TrendingUp, HeartPulse,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

/* ──────────── ROLES ──────────── */
type RoleKey = "engineer" | "office" | "quotes" | "ops" | "md";

const ROLES: { key: RoleKey; label: string; person: string; icon: typeof User; tint: string }[] = [
  { key: "engineer", label: "Engineer · on-site", person: "T. Reid",  icon: Wrench,      tint: "bg-orange-500" },
  { key: "office",   label: "Office Manager",      person: "Mary",    icon: Mail,        tint: "bg-sky-500" },
  { key: "quotes",   label: "Quotations",          person: "Larne",   icon: FileSignature, tint: "bg-violet-500" },
  { key: "ops",      label: "Operations / Sched.", person: "Rudy",    icon: Calendar,    tint: "bg-emerald-600" },
  { key: "md",       label: "MD / Exec",           person: "Heidi",   icon: TrendingUp,  tint: "bg-foreground" },
];

/* ──────────── SNAPSHOT ICONS (Mary's wish list) ──────────── */
type Tag =
  | "two-hands" | "three-person" | "lpg" | "commercial" | "domestic"
  | "not-thursday" | "scaffolding" | "prison" | "rams" | "stayaway" | "parking";

const TAG_META: Record<Tag, { label: string; icon: typeof Users2; tone: string }> = {
  "two-hands":    { label: "2 engineers",  icon: Users2,         tone: "bg-sky-100 text-sky-700" },
  "three-person": { label: "3 engineers",  icon: Users2,         tone: "bg-sky-100 text-sky-700" },
  lpg:            { label: "LPG",          icon: Flame,          tone: "bg-orange-100 text-orange-700" },
  commercial:     { label: "Commercial",   icon: Building2,      tone: "bg-violet-100 text-violet-700" },
  domestic:       { label: "Domestic",     icon: User,           tone: "bg-emerald-100 text-emerald-700" },
  "not-thursday": { label: "Not Thursday", icon: Calendar,       tone: "bg-rose-100 text-rose-700" },
  scaffolding:    { label: "Scaffold",     icon: AlertTriangle,  tone: "bg-amber-100 text-amber-700" },
  prison:         { label: "Prison · RAMS",icon: ShieldCheck,    tone: "bg-slate-200 text-slate-800" },
  rams:           { label: "RAMS req.",    icon: FileSignature,  tone: "bg-slate-200 text-slate-800" },
  stayaway:       { label: "Stayaway",     icon: Bed,            tone: "bg-indigo-100 text-indigo-700" },
  parking:        { label: "Parking £",    icon: ParkingCircle,  tone: "bg-yellow-100 text-yellow-800" },
};

function TagChip({ tag }: { tag: Tag }) {
  const m = TAG_META[tag];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", m.tone)}>
      <m.icon className="h-3 w-3" /> {m.label}
    </span>
  );
}

/* ──────────── MOCK DATA ──────────── */
type Job = {
  id: string;
  title: string;
  customer: string;
  site: string;
  engineer: string;
  scheduled: string;
  urgency: "Urgent" | "Important" | "Medium" | "Low";
  health: number; // 0-100
  complaintRisk: "low" | "med" | "high";
  value: string;
  margin: string;
  tags: Tag[];
  boiler: string;
  access: string;
  parking: string;
  ramsAttached: boolean;
  photoCount: number;
  parts: { name: string; supplier: string; price: string; status: "quoted" | "awaiting" | "won" }[];
  quoteStatus: "Draft" | "With Alan" | "Sent · waiting" | "Accepted" | "Lost";
  quoteAge: number; // days
  alanApproved: boolean;
  travelChargedTwice?: boolean;
  missingSerial?: boolean;
  customerSentiment: "Positive" | "Neutral" | "Frustrated";
  lastTouch: string;
  notes: string[];
};

const JOBS: Job[] = [
  {
    id: "J-3402", title: "Boiler replacement · 60kW", customer: "ABC School", site: "ABC School, Romsey SO51",
    engineer: "T. Reid", scheduled: "Wed 26 Jun · 08:00", urgency: "Urgent", health: 62,
    complaintRisk: "high", value: "£12,840", margin: "27%",
    tags: ["two-hands", "commercial", "scaffolding"],
    boiler: "Vaillant ecoTEC plus 615 · S/N: missing",
    access: "Site office sign-in · escort required from 08:00",
    parking: "Visitor bay 4 · £12/day · gate code 4471",
    ramsAttached: false, photoCount: 6,
    parts: [
      { name: "Heat exchanger", supplier: "Heaton Spares", price: "£640", status: "won" },
      { name: "Flue kit 1m",    supplier: "Plumb Base",    price: "£182", status: "quoted" },
      { name: "Expansion vessel", supplier: "BSS",         price: "£94",  status: "awaiting" },
    ],
    quoteStatus: "With Alan", quoteAge: 4, alanApproved: false,
    missingSerial: true,
    customerSentiment: "Frustrated", lastTouch: "2d ago · no callback",
    notes: ["Engineer mentioned plant-room access tight — confirm trolley route", "RAMS not yet copied back into Commusoft"],
  },
  {
    id: "J-3401", title: "Annual service · plant room", customer: "Greenfield Care Home", site: "Greenfield, Eastleigh",
    engineer: "M. Patel", scheduled: "Today · 13:30", urgency: "Important", health: 88,
    complaintRisk: "low", value: "£640", margin: "41%",
    tags: ["commercial", "two-hands"],
    boiler: "Worcester GB162 50kW · S/N: WB2-77A013",
    access: "Reception · ask for Janet", parking: "On-street free 1–4pm",
    ramsAttached: true, photoCount: 14,
    parts: [
      { name: "Service kit", supplier: "BSS", price: "£42", status: "won" },
      { name: "Pump seal",   supplier: "Heaton Spares", price: "£18", status: "won" },
    ],
    quoteStatus: "Accepted", quoteAge: 12, alanApproved: true,
    customerSentiment: "Positive", lastTouch: "Confirmation sent · pricing pulled through",
    notes: ["Plant room serviced 2 months ago — Ryan, 3.2h actual"],
  },
  {
    id: "J-3400", title: "Combi swap · domestic", customer: "12 Marlborough Rd", site: "Southampton SO15",
    engineer: "S. Walsh", scheduled: "Thu 27 Jun · 09:30", urgency: "Medium", health: 74,
    complaintRisk: "low", value: "£3,320", margin: "32%",
    tags: ["domestic", "not-thursday"],
    boiler: "Ideal Logic+ 30 · existing: Vaillant ecoTEC pro 28",
    access: "Front door · Mrs Greene retired, in all day", parking: "Driveway",
    ramsAttached: true, photoCount: 9,
    parts: [
      { name: "Ideal Logic+ 30", supplier: "Plumb Base", price: "£1,180", status: "won" },
      { name: "System filter",   supplier: "BSS",        price: "£89",   status: "won" },
    ],
    quoteStatus: "Sent · waiting", quoteAge: 18, alanApproved: true,
    customerSentiment: "Neutral", lastTouch: "Day 18 · nudge due day 20",
    notes: ["Customer hates Thursdays — diary tag added"],
  },
  {
    id: "J-3399", title: "LPG flue rework · prison wing", customer: "HMP Winchester", site: "HMP Winchester · C wing",
    engineer: "Rob", scheduled: "Fri 28 Jun · 07:00", urgency: "Urgent", health: 41,
    complaintRisk: "high", value: "£8,420", margin: "19%",
    tags: ["prison", "lpg", "three-person", "rams", "stayaway", "parking"],
    boiler: "Remeha P520 · LPG · S/N: pending",
    access: "Gatehouse, no phones, no iPad — paper job sheet only",
    parking: "Staff car park C · permit on dash",
    ramsAttached: false, photoCount: 0,
    parts: [
      { name: "Flue 80/125 1.5m", supplier: "Heaton Spares", price: "£320", status: "quoted" },
      { name: "LPG regulator",    supplier: "Plumb Base",    price: "£145", status: "awaiting" },
    ],
    quoteStatus: "Draft", quoteAge: 2, alanApproved: false,
    missingSerial: true,
    customerSentiment: "Neutral", lastTouch: "Waiting on Rob to call back · 3 chases",
    notes: ["No photos on file — engineer had no iPad", "Airbnb booked: 2 nights · Lance's account"],
  },
  {
    id: "J-3398", title: "Cylinder replacement", customer: "Crestmont Apartments", site: "Crestmont, Winchester",
    engineer: "L. Bryan", scheduled: "Mon 24 Jun · 10:00", urgency: "Low", health: 95,
    complaintRisk: "low", value: "£1,480", margin: "38%",
    tags: ["commercial"],
    boiler: "Megaflo HE 250L · S/N: MG250-44Z",
    access: "Concierge desk · key code 8821",
    parking: "Loading bay 09:00-11:00 only",
    ramsAttached: true, photoCount: 22,
    parts: [{ name: "Megaflo HE 250L", supplier: "BSS", price: "£820", status: "won" }],
    quoteStatus: "Accepted", quoteAge: 6, alanApproved: true,
    customerSentiment: "Positive", lastTouch: "Wraparound review sent",
    notes: ["Back-to-back job at same address tomorrow — don't double-charge travel"],
    travelChargedTwice: true,
  },
];

type Customer = {
  id: string;
  name: string;
  type: "Commercial" | "Domestic" | "Public sector";
  contact: string;
  phone: string;
  address: string;
  plantHealth: number; // 0-100
  servicePlan: "Active" | "Lapsed" | "None";
  servicePlanRate?: string;
  lifetimeValue: string;
  openJobs: number;
  lastService: string;
  nextService: string;
  recallCount: number;
  complaints: number;
  sentiment: "Positive" | "Neutral" | "Frustrated";
  certificates: number;
  assets: { name: string; age: string; condition: "Good" | "Watch" | "Replace" }[];
  notes: string[];
};

const CUSTOMERS: Customer[] = [
  {
    id: "C-104", name: "ABC School", type: "Public sector",
    contact: "Janet Holcombe (Estates)", phone: "01794 555 014",
    address: "ABC School, Romsey SO51 7XY",
    plantHealth: 58, servicePlan: "Active", servicePlanRate: "£88/hr",
    lifetimeValue: "£84,200", openJobs: 2, lastService: "12 Apr 2025",
    nextService: "Overdue · 14 days", recallCount: 3, complaints: 1, sentiment: "Frustrated",
    certificates: 18,
    assets: [
      { name: "Vaillant ecoTEC 615 · House #1", age: "7y", condition: "Replace" },
      { name: "Vaillant ecoTEC 615 · House #2", age: "7y", condition: "Watch" },
      { name: "Megaflo unvented 300L",          age: "4y", condition: "Good" },
    ],
    notes: ["Access via site office only", "Escort required during term time"],
  },
  {
    id: "C-088", name: "Greenfield Care Home", type: "Commercial",
    contact: "Janet (manager)", phone: "02380 555 882",
    address: "Greenfield, Eastleigh SO50",
    plantHealth: 86, servicePlan: "Active", servicePlanRate: "£95/hr",
    lifetimeValue: "£42,140", openJobs: 1, lastService: "20 May 2025",
    nextService: "12 Nov 2025", recallCount: 0, complaints: 0, sentiment: "Positive",
    certificates: 9,
    assets: [
      { name: "Worcester GB162 50kW", age: "3y", condition: "Good" },
      { name: "Indirect cyl 200L",    age: "3y", condition: "Good" },
    ],
    notes: ["Reception · ask for Janet", "Parking free 1–4pm"],
  },
  {
    id: "C-201", name: "Peter Simmons Estate", type: "Commercial",
    contact: "Peter Simmons", phone: "020 7555 8810",
    address: "Mayfair, London W1",
    plantHealth: 72, servicePlan: "Active", servicePlanRate: "£88/hr (locked)",
    lifetimeValue: "£128,900", openJobs: 0, lastService: "02 Jun 2025",
    nextService: "02 Dec 2025", recallCount: 1, complaints: 0, sentiment: "Neutral",
    certificates: 14,
    assets: [
      { name: "Plant room · 4× cascade boilers", age: "5y", condition: "Watch" },
      { name: "Cylinder bank 3×500L",            age: "5y", condition: "Good" },
    ],
    notes: ["London parking — undercharged historically", "Service-plan rate sits in Larne's head"],
  },
  {
    id: "C-310", name: "HMP Winchester", type: "Public sector",
    contact: "Works Dept", phone: "01962 555 000",
    address: "Romsey Rd, Winchester SO22",
    plantHealth: 44, servicePlan: "None",
    lifetimeValue: "£212,000", openJobs: 1, lastService: "08 Jan 2025",
    nextService: "TBC · awaiting RAMS",
    recallCount: 4, complaints: 2, sentiment: "Frustrated", certificates: 6,
    assets: [
      { name: "Remeha P520 LPG · C wing", age: "6y", condition: "Replace" },
      { name: "Remeha P520 LPG · A wing", age: "6y", condition: "Watch" },
    ],
    notes: ["No phones / iPads on site", "RAMS required every visit", "Outreach admin growing"],
  },
];

/* ──────────── HELPERS ──────────── */
function HealthBar({ value, label }: { value: number; label?: string }) {
  const tone = value >= 75 ? "bg-success" : value >= 50 ? "bg-warning" : "bg-destructive";
  return (
    <div>
      {label && (
        <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>{label}</span>
          <span className="tabular font-mono">{value}</span>
        </div>
      )}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-alt">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function SentimentDot({ s }: { s: "Positive" | "Neutral" | "Frustrated" }) {
  const tone = s === "Positive" ? "bg-success" : s === "Neutral" ? "bg-muted-foreground/50" : "bg-destructive";
  return <span className={cn("inline-block h-1.5 w-1.5 rounded-full", tone)} />;
}

function UrgencyPill({ u }: { u: Job["urgency"] }) {
  const tone =
    u === "Urgent" ? "bg-destructive/10 text-destructive" :
    u === "Important" ? "bg-warning/10 text-warning" :
    u === "Medium" ? "bg-accent/10 text-accent" :
    "bg-surface-alt text-muted-foreground";
  return <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", tone)}>{u}</span>;
}

/* ──────────── ROLE SWITCHER ──────────── */
function RoleSwitcher({ role, setRole }: { role: RoleKey; setRole: (r: RoleKey) => void }) {
  return (
    <div className="rounded-2xl border border-hairline bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Viewing as</div>
          <div className="text-display mt-1 text-base font-semibold">
            Same card · different lens · zero retraining
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Every team member sees the data they need — and none of the data they don't. Switch a role to demo.
          </p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {ROLES.map((r) => {
          const active = r.key === role;
          return (
            <button
              key={r.key}
              onClick={() => setRole(r.key)}
              className={cn(
                "group flex items-center gap-3 rounded-xl border p-3 text-left transition",
                active ? "border-foreground bg-foreground text-background" : "border-hairline bg-surface-alt hover:border-foreground/30",
              )}
            >
              <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white", r.tint, active && "ring-2 ring-background/30")}>
                <r.icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{r.person}</span>
                <span className={cn("block truncate text-[10px]", active ? "text-background/70" : "text-muted-foreground")}>{r.label}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ──────────── JOB CARD (compact) ──────────── */
/* Fixed layout: every card has the same slots in the same place.
   Empty slots stay as blank space so nothing jumps between cards. */
function JobCardCompact({ job, onOpen }: { job: Job; role: RoleKey; onOpen: () => void }) {
  // Up to two critical flags surface on the face; rest live in detail view
  const flags: { icon: typeof AlertTriangle; label: string; tone: string }[] = [];
  if (job.missingSerial)        flags.push({ icon: AlertTriangle, label: "Serial missing",  tone: "bg-destructive/10 text-destructive" });
  if (!job.ramsAttached)        flags.push({ icon: ShieldCheck,   label: "RAMS missing",    tone: "bg-destructive/10 text-destructive" });
  if (job.travelChargedTwice)   flags.push({ icon: Car,           label: "Travel × 2 risk", tone: "bg-warning/10 text-warning" });
  if (job.customerSentiment === "Frustrated") flags.push({ icon: HeartPulse, label: "Customer frustrated", tone: "bg-warning/10 text-warning" });

  return (
    <button
      onClick={onOpen}
      className="group relative flex h-[200px] w-full flex-col overflow-hidden rounded-2xl border border-hairline bg-white p-4 text-left transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-soft)]"
    >
      {/* Slot 1: id + schedule + urgency (fixed) */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
          <span>{job.id}</span>
          <span>·</span>
          <span className="truncate">{job.scheduled}</span>
        </div>
        <UrgencyPill u={job.urgency} />
      </div>

      {/* Slot 2: title + customer (fixed two-line block) */}
      <div className="mt-2 min-h-[44px]">
        <div className="text-display truncate text-sm font-semibold">{job.title}</div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{job.customer}</div>
      </div>

      {/* Slot 3: at-a-glance flags (fixed height, blank if none) */}
      <div className="mt-auto min-h-[22px]">
        {flags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {flags.slice(0, 2).map((f) => (
              <span key={f.label} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", f.tone)}>
                <f.icon className="h-3 w-3" /> {f.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Slot 4: open affordance (fixed) */}
      <div className="mt-3 flex items-center justify-between border-t border-hairline pt-2 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <SentimentDot s={job.customerSentiment} />
          <span>{job.tags.length} tag{job.tags.length === 1 ? "" : "s"}</span>
        </span>
        <span className="inline-flex items-center gap-1 font-medium text-foreground">
          Open card <ChevronRight className="h-3 w-3" />
        </span>
      </div>
    </button>
  );
}

/* ──────────── JOB CARD (open) — role-aware body ──────────── */
function JobDetail({ job, role }: { job: Job; role: RoleKey }) {
  const Section = ({ title, icon: Icon, children }: { title: string; icon: typeof User; children: React.ReactNode }) => (
    <div className="rounded-xl border border-hairline bg-white p-4">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" /> {title}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );

  // Common header
  const Header = (
    <div className="rounded-2xl border border-hairline bg-gradient-to-br from-white to-surface-alt p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
            <span>{job.id}</span><span>·</span><span>{job.scheduled}</span>
          </div>
          <div className="text-display mt-1 text-xl font-semibold">{job.title}</div>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <Building2 className="h-3.5 w-3.5" /> {job.customer}
            <span>·</span>
            <MapPin className="h-3.5 w-3.5" /> {job.site}
          </div>
          <div className="mt-3 flex flex-wrap gap-1">
            {job.tags.map((t) => <TagChip key={t} tag={t} />)}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <UrgencyPill u={job.urgency} />
          <div className="rounded-lg border border-hairline bg-white px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Job health</div>
            <div className="text-display mt-0.5 text-lg font-bold tabular">{job.health}</div>
          </div>
        </div>
      </div>
    </div>
  );

  // ROLE-SPECIFIC BODIES
  const bodies: Record<RoleKey, React.ReactNode> = {
    engineer: (
      <div className="grid gap-3 md:grid-cols-2">
        <Section title="On-site essentials" icon={MapPin}>
          <ul className="space-y-2 text-sm">
            <li className="flex items-start gap-2"><MapPin className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" /> {job.access}</li>
            <li className="flex items-start gap-2"><ParkingCircle className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" /> {job.parking}</li>
            <li className="flex items-start gap-2"><Flame className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" /> {job.boiler}</li>
          </ul>
        </Section>
        <Section title="Photo checklist" icon={Camera}>
          <ul className="space-y-1.5 text-xs">
            {["Data plate (close-up)", "Front-on boiler", "Side-on boiler", "Position in plant room", "Access route", "Any defects"].map((p, i) => (
              <li key={p} className="flex items-center gap-2">
                {i < Math.min(job.photoCount, 6) ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <XCircle className="h-3.5 w-3.5 text-destructive" />}
                <span className={i < Math.min(job.photoCount, 6) ? "" : "text-muted-foreground"}>{p}</span>
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Parts to fit" icon={Package}>
          <ul className="space-y-1.5 text-xs">
            {job.parts.map((p) => (
              <li key={p.name} className="flex items-center justify-between rounded-md bg-surface-alt px-2 py-1.5">
                <span className="font-medium">{p.name}</span>
                <span className="font-mono text-muted-foreground">{p.supplier}</span>
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Voice-to-card" icon={MessageSquare}>
          <div className="rounded-md border border-dashed border-hairline p-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-2 font-medium text-foreground"><Activity className="h-3.5 w-3.5 text-success" /> Recording clip armed</div>
            <p className="mt-1">Talk through findings — it'll match to job by GPS + time, even if you don't finish the sheet on site.</p>
          </div>
        </Section>
      </div>
    ),
    office: (
      <div className="grid gap-3 md:grid-cols-2">
        <Section title="Confirmation email (auto-priced)" icon={Mail}>
          <div className="rounded-md border border-hairline bg-surface-alt p-3 text-xs">
            <div className="text-muted-foreground">To: {job.customer}</div>
            <div className="mt-2 font-medium">Following up our call — booking confirmed.</div>
            <div className="mt-1">Date: {job.scheduled}</div>
            <div className="mt-1">Price: <span className="font-mono font-semibold text-foreground">{job.value}</span> <span className="text-success">· pulled through ✓</span></div>
            {job.tags.includes("prison") && <div className="mt-2 text-warning">RAMS attached automatically (prison)</div>}
          </div>
        </Section>
        <Section title="Comms history · sentiment" icon={PhoneCall}>
          <ul className="space-y-1.5 text-xs">
            <li className="flex items-center justify-between"><span>Inbound call · 2d ago</span><SentimentDot s="Frustrated" /></li>
            <li className="flex items-center justify-between"><span>Email · 3d ago</span><SentimentDot s="Neutral" /></li>
            <li className="flex items-center justify-between"><span>Slack thread #abc-school</span><SentimentDot s="Neutral" /></li>
          </ul>
          <div className="mt-3 text-[11px] text-muted-foreground">{job.lastTouch}</div>
        </Section>
        <Section title="Paperwork" icon={FileSignature}>
          <ul className="space-y-1.5 text-xs">
            <li className="flex items-center gap-2">{job.ramsAttached ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <XCircle className="h-3.5 w-3.5 text-destructive" />} RAMS</li>
            <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-success" /> Cert template ready</li>
            <li className="flex items-center gap-2">{job.tags.includes("stayaway") ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <XCircle className="h-3.5 w-3.5 text-muted-foreground" />} Airbnb invoice</li>
            <li className="flex items-center gap-2">{job.tags.includes("parking") ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <XCircle className="h-3.5 w-3.5 text-muted-foreground" />} Parking receipt → GP costing</li>
          </ul>
        </Section>
        <Section title="Reminders Mary normally chases" icon={BellRing}>
          <ul className="space-y-1.5 text-xs text-muted-foreground">
            <li>• Boiler registration (Julie) — hashtag created</li>
            <li>• Confirmation 24h before visit</li>
            <li>• Annual service reminder · {job.tags.includes("commercial") ? "Nov 2025" : "next April"}</li>
          </ul>
        </Section>
      </div>
    ),
    quotes: (
      <div className="grid gap-3 md:grid-cols-2">
        <Section title="Supplier comparison" icon={Package}>
          <ul className="space-y-1.5 text-xs">
            {job.parts.map((p) => (
              <li key={p.name} className="grid grid-cols-12 items-center gap-2 rounded-md bg-surface-alt px-2 py-1.5">
                <span className="col-span-5 truncate font-medium">{p.name}</span>
                <span className="col-span-4 truncate text-muted-foreground">{p.supplier}</span>
                <span className="col-span-2 text-right font-mono tabular">{p.price}</span>
                <span className={cn(
                  "col-span-1 text-right text-[10px] font-medium",
                  p.status === "won" && "text-success",
                  p.status === "quoted" && "text-accent",
                  p.status === "awaiting" && "text-warning",
                )}>{p.status === "won" ? "✓" : p.status === "awaiting" ? "…" : "•"}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2 text-[10px] text-muted-foreground">Part-name normaliser reconciled 3 SKUs across Heaton/Plumb Base/BSS.</div>
        </Section>
        <Section title="Quote status · Alan oversight" icon={FileSignature}>
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between"><span>Status</span><span className="font-medium">{job.quoteStatus}</span></div>
            <div className="flex items-center justify-between"><span>Age</span><span className="font-mono">day {job.quoteAge} of 30</span></div>
            <div className="flex items-center justify-between"><span>Alan approved</span>{job.alanApproved ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <XCircle className="h-3.5 w-3.5 text-warning" />}</div>
            <div className="flex items-center justify-between"><span>Markup applied</span><span>+25% parts · +30% London labour</span></div>
            <div className="flex items-center justify-between"><span>Nudge at</span><span>day 20 — automated</span></div>
          </div>
        </Section>
        <Section title="Good / Better / Best" icon={Sparkles}>
          <div className="grid grid-cols-3 gap-2 text-[11px]">
            {["Good", "Better", "Best"].map((t, i) => (
              <div key={t} className={cn("rounded-md border p-2", i === 1 ? "border-accent bg-accent/5" : "border-hairline")}>
                <div className="font-semibold">{t}</div>
                <div className="mt-1 font-mono tabular">£{(parseInt(job.value.replace(/[^\d]/g, "")) * (i === 0 ? 0.82 : i === 1 ? 1 : 1.34) | 0).toLocaleString()}</div>
                {i === 1 && <div className="mt-1 text-accent">~70% choose</div>}
              </div>
            ))}
          </div>
        </Section>
        <Section title="Life-stat justification" icon={Gauge}>
          <p className="text-xs text-muted-foreground">
            Last similar job: <span className="text-foreground">9.2h actual · we charge 7h</span>.
            Ryan averages <span className="text-foreground">3.2h</span> on a 60kW service in plant rooms like this.
          </p>
        </Section>
      </div>
    ),
    ops: (
      <div className="grid gap-3 md:grid-cols-2">
        <Section title="Engineer fit" icon={Wrench}>
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between"><span>Assigned</span><span className="font-medium">{job.engineer}</span></div>
            <div className="flex items-center justify-between"><span>Skill match</span><span className="text-success">98%</span></div>
            <div className="flex items-center justify-between"><span>Travel from prev job</span><span>22 min</span></div>
            <div className="flex items-center justify-between"><span>Cert valid</span><CheckCircle2 className="h-3.5 w-3.5 text-success" /></div>
          </div>
        </Section>
        <Section title="Scheduling intelligence" icon={Calendar}>
          <ul className="space-y-1.5 text-xs">
            {job.tags.includes("two-hands") && <li className="flex items-center gap-2"><Users2 className="h-3.5 w-3.5 text-warning" /> 2nd pair of hands flagged — placeholder auto-paired</li>}
            {job.tags.includes("three-person") && <li className="flex items-center gap-2"><Users2 className="h-3.5 w-3.5 text-warning" /> 3 engineers required</li>}
            {job.tags.includes("not-thursday") && <li className="flex items-center gap-2"><Calendar className="h-3.5 w-3.5 text-rose-600" /> Customer rule: not Thursdays</li>}
            {job.travelChargedTwice && <li className="flex items-center gap-2"><Car className="h-3.5 w-3.5 text-warning" /> Same address tomorrow — single travel charge</li>}
            <li className="flex items-center gap-2"><Activity className="h-3.5 w-3.5 text-success" /> Diary ↔ Job description in two-way sync</li>
          </ul>
        </Section>
        <Section title="Stayaway / parking auto-handled" icon={Bed}>
          <ul className="space-y-1.5 text-xs">
            <li className="flex items-center justify-between"><span>Airbnb (Lance's account)</span>{job.tags.includes("stayaway") ? <span className="text-success">Booked · 2 nights</span> : <span className="text-muted-foreground">N/A</span>}</li>
            <li className="flex items-center justify-between"><span>Parking</span>{job.tags.includes("parking") ? <span className="text-success">Paid · invoice in GP cost</span> : <span className="text-muted-foreground">Free / driveway</span>}</li>
          </ul>
        </Section>
        <Section title="Placeholder hygiene" icon={ClipboardList}>
          <p className="text-xs text-muted-foreground">No duplicate apprentice placeholders. Group-delete enabled on this job's holds.</p>
        </Section>
      </div>
    ),
    md: (
      <div className="grid gap-3 md:grid-cols-2">
        <Section title="Commercials" icon={Banknote}>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { l: "Value", v: job.value },
              { l: "Margin", v: job.margin },
              { l: "Hours est.", v: "7h" },
            ].map((x) => (
              <div key={x.l} className="rounded-md bg-surface-alt p-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{x.l}</div>
                <div className="text-display mt-1 text-base font-bold tabular">{x.v}</div>
              </div>
            ))}
          </div>
        </Section>
        <Section title="Customer happiness signal" icon={HeartPulse}>
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2"><SentimentDot s={job.customerSentiment} /> {job.customerSentiment}</span>
            <span className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium",
              job.complaintRisk === "high" && "bg-destructive/10 text-destructive",
              job.complaintRisk === "med" && "bg-warning/10 text-warning",
              job.complaintRisk === "low" && "bg-success/10 text-success",
            )}>complaint risk · {job.complaintRisk}</span>
          </div>
        </Section>
        <Section title="Process exposures on this job" icon={AlertTriangle}>
          <ul className="space-y-1.5 text-xs">
            {job.missingSerial && <li className="text-destructive">• Serial / data-plate missing</li>}
            {!job.ramsAttached && <li className="text-warning">• RAMS not yet on file</li>}
            {job.travelChargedTwice && <li className="text-warning">• Travel double-charge risk</li>}
            {!job.alanApproved && <li className="text-warning">• Awaiting Alan's review (bottleneck)</li>}
            {job.missingSerial === undefined && job.ramsAttached && job.alanApproved && !job.travelChargedTwice && <li className="text-success">• None detected</li>}
          </ul>
        </Section>
        <Section title="Pattern recognition" icon={Sparkles}>
          <p className="text-xs text-muted-foreground">
            Similar jobs run a median <span className="text-foreground">8.4h</span> at <span className="text-foreground">31% margin</span>.
            This one is tracking <span className={cn(parseInt(job.margin) < 30 ? "text-warning" : "text-success", "font-medium")}>{job.margin}</span> — adjust for next quote of this shape.
          </p>
        </Section>
      </div>
    ),
  };

  return (
    <div className="space-y-3">
      {Header}
      {bodies[role]}
      <div className="rounded-2xl border border-hairline bg-white p-4">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Notes from the loop</div>
        <ul className="mt-2 space-y-1 text-xs">
          {job.notes.map((n) => <li key={n} className="flex items-start gap-2"><span className="mt-1.5 h-1 w-1 rounded-full bg-foreground/60" />{n}</li>)}
        </ul>
      </div>
    </div>
  );
}

/* ──────────── CUSTOMER CARD ──────────── */
function CustomerCardCompact({ c, role, onOpen }: { c: Customer; role: RoleKey; onOpen: () => void }) {
  const primary = (() => {
    switch (role) {
      case "engineer": return { l: "Site access", v: c.notes[0] ?? "—", icon: MapPin };
      case "office":   return { l: "Open / Recall", v: `${c.openJobs} open · ${c.recallCount} recalls`, icon: History };
      case "quotes":   return { l: "Plan rate", v: c.servicePlanRate ?? "—", icon: PoundSterling };
      case "ops":      return { l: "Next service", v: c.nextService, icon: Calendar };
      case "md":       return { l: "Lifetime value", v: c.lifetimeValue, icon: TrendingUp };
    }
  })();

  return (
    <button
      onClick={onOpen}
      className="group w-full rounded-2xl border border-hairline bg-white p-4 text-left transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-soft)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-mono text-muted-foreground">{c.id} · {c.type}</div>
          <div className="text-display mt-1 truncate text-sm font-semibold">{c.name}</div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{c.address}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Plant room</div>
          <div className="text-display text-lg font-bold tabular">{c.plantHealth}</div>
        </div>
      </div>

      <div className="mt-3"><HealthBar value={c.plantHealth} /></div>

      <div className="mt-3 rounded-lg border border-hairline bg-surface-alt p-2.5">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          <primary.icon className="h-3 w-3" /> {primary.l}
        </div>
        <div className="mt-1 line-clamp-2 text-xs font-medium">{primary.v}</div>
      </div>

      <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1"><SentimentDot s={c.sentiment} /> {c.sentiment}</span>
          <span>·</span>
          <span>{c.complaints} complaints</span>
        </div>
        <span className={cn(
          "rounded-full px-2 py-0.5 font-medium",
          c.servicePlan === "Active" && "bg-success/10 text-success",
          c.servicePlan === "Lapsed" && "bg-warning/10 text-warning",
          c.servicePlan === "None"   && "bg-surface-alt text-muted-foreground",
        )}>{c.servicePlan}</span>
      </div>
    </button>
  );
}

function CustomerDetail({ c, role }: { c: Customer; role: RoleKey }) {
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-hairline bg-gradient-to-br from-white to-surface-alt p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-mono text-muted-foreground">{c.id} · {c.type}</div>
            <div className="text-display mt-1 text-xl font-semibold">{c.name}</div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><User className="h-3.5 w-3.5" /> {c.contact}</span>
              <span className="inline-flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" /> {c.phone}</span>
              <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> {c.address}</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="rounded-lg border border-hairline bg-white px-3 py-2 text-right">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Plant Room Health</div>
              <div className="text-display mt-0.5 text-2xl font-bold tabular">{c.plantHealth}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-hairline bg-white p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Lifetime value</div>
          <div className="text-display mt-1 text-lg font-bold tabular">{c.lifetimeValue}</div>
          <div className="mt-1 text-[10px] text-muted-foreground">Plan rate: {c.servicePlanRate ?? "—"}</div>
        </div>
        <div className="rounded-xl border border-hairline bg-white p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Recall · Complaints</div>
          <div className="text-display mt-1 text-lg font-bold tabular">{c.recallCount} · {c.complaints}</div>
          <div className="mt-1 text-[10px] text-muted-foreground">Last service: {c.lastService}</div>
        </div>
        <div className="rounded-xl border border-hairline bg-white p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Next service</div>
          <div className="text-display mt-1 text-lg font-bold tabular">{c.nextService}</div>
          <div className="mt-1 text-[10px] text-muted-foreground">{c.certificates} certificates on file</div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-hairline bg-white p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Asset register · 5-year health</div>
          <ul className="mt-3 space-y-2">
            {c.assets.map((a) => (
              <li key={a.name} className="flex items-center justify-between rounded-md bg-surface-alt px-3 py-2 text-xs">
                <span className="min-w-0 truncate font-medium">{a.name}</span>
                <span className="ml-3 flex shrink-0 items-center gap-2">
                  <span className="font-mono text-muted-foreground">{a.age}</span>
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-medium",
                    a.condition === "Good" && "bg-success/10 text-success",
                    a.condition === "Watch" && "bg-warning/10 text-warning",
                    a.condition === "Replace" && "bg-destructive/10 text-destructive",
                  )}>{a.condition}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-hairline bg-white p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {role === "office" && "Comms Mary owns"}
            {role === "engineer" && "Site notes"}
            {role === "quotes" && "Pricing memory"}
            {role === "ops" && "Scheduling rules"}
            {role === "md" && "Relationship signal"}
          </div>
          <ul className="mt-3 space-y-2 text-xs">
            {role === "office" && (
              <>
                <li>• Confirmation email template — auto-prices ✓</li>
                <li>• RAMS auto-attach for prison visits</li>
                <li>• Service-reminder schedule rebuilt (no longer "never correct")</li>
                <li>• No threads — comms surface on the card</li>
              </>
            )}
            {role === "engineer" && c.notes.map((n) => <li key={n}>• {n}</li>)}
            {role === "quotes" && (
              <>
                <li>• Plan rate: <span className="font-mono">{c.servicePlanRate ?? "rate card"}</span></li>
                <li>• Last 3 quotes: 2 won, 1 lost (price-sensitive)</li>
                <li>• "Spam drift" follow-up line: 70% reply rate</li>
                <li>• London labour +30% applies</li>
              </>
            )}
            {role === "ops" && (
              <>
                <li>• Tags from history: {c.notes[0]}</li>
                <li>• Preferred days inferred from past bookings</li>
                <li>• Single travel charge on back-to-back visits</li>
              </>
            )}
            {role === "md" && (
              <>
                <li className="flex items-center gap-2"><SentimentDot s={c.sentiment} /> Sentiment: {c.sentiment}</li>
                <li>• Wraparound review pending</li>
                <li>• Customer portal access: not yet provisioned</li>
              </>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ──────────── PAGE ──────────── */
export function CardsView() {
  const [role, setRole] = useState<RoleKey>("engineer");
  const [tab, setTab] = useState<"jobs" | "customers">("jobs");
  const [openJob, setOpenJob] = useState<Job | null>(null);
  const [openCust, setOpenCust] = useState<Customer | null>(null);
  const [q, setQ] = useState("");

  const filteredJobs = JOBS.filter(
    (j) => !q || [j.id, j.title, j.customer, j.engineer].some((s) => s.toLowerCase().includes(q.toLowerCase())),
  );
  const filteredCust = CUSTOMERS.filter(
    (c) => !q || [c.id, c.name, c.address, c.contact].some((s) => s.toLowerCase().includes(q.toLowerCase())),
  );

  return (
    <div className="space-y-5">
      {/* Hero */}
      <div className="rounded-2xl border border-hairline bg-gradient-to-br from-white to-surface-alt p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-foreground text-background">
                <IdCard className="h-3 w-3" />
              </span>
              Cards · the operating surface
            </div>
            <h2 className="text-display mt-3 text-2xl font-semibold tracking-tight">
              One card per job. One card per customer. Ten ways to read it.
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Mary sees confirmation pricing and RAMS. Larne sees supplier quotes and Alan's approval. Engineers see access, parking, and the photo checklist.
              Rudy sees the second-pair-of-hands flag. Heidi sees margin and complaint risk. Same source of truth — different lens.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { l: "Job cards live", v: "42" },
              { l: "Customer cards", v: "318" },
              { l: "Avg open time", v: "1.4s" },
            ].map((s) => (
              <div key={s.l} className="rounded-xl border border-hairline bg-white px-4 py-3">
                <div className="text-display text-lg font-bold tabular">{s.v}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <RoleSwitcher role={role} setRole={setRole} />

      {/* Tabs + search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-full border border-hairline bg-white p-1">
          {([
            { k: "jobs", l: "Job cards", c: JOBS.length },
            { k: "customers", l: "Customer cards", c: CUSTOMERS.length },
          ] as const).map((t) => (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              className={cn(
                "rounded-full px-4 py-1.5 text-xs font-medium transition",
                tab === t.k ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.l} <span className="ml-1 opacity-60">{t.c}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={tab === "jobs" ? "Search jobs, engineers…" : "Search customers, sites…"}
              className="w-64 rounded-full border border-hairline bg-white py-1.5 pl-9 pr-3 text-sm outline-none focus:border-accent"
            />
          </div>
          <button className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-white px-3 py-1.5 text-xs text-muted-foreground">
            <Filter className="h-3.5 w-3.5" /> Filter
          </button>
        </div>
      </div>

      {/* Grid */}
      {tab === "jobs" ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filteredJobs.map((j) => <JobCardCompact key={j.id} job={j} role={role} onOpen={() => setOpenJob(j)} />)}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filteredCust.map((c) => <CustomerCardCompact key={c.id} c={c} role={role} onOpen={() => setOpenCust(c)} />)}
        </div>
      )}

      {/* Footer note */}
      <div className="rounded-2xl border border-dashed border-hairline bg-white p-4 text-xs text-muted-foreground">
        Built from Larne & Mary's discovery: snapshot icons (2-hands, LPG, prison), Plant Room Health, supplier-name normalisation,
        confirmation-price pull-through, parking → GP cost, single travel on back-to-back, engineer voice-to-card, Alan's approval gate,
        day-20 quote nudge, and the wraparound feedback loop.
      </div>

      {/* Job modal */}
      <Dialog open={!!openJob} onOpenChange={(o) => !o && setOpenJob(null)}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-display">{openJob?.title}</DialogTitle>
            <DialogDescription>
              Viewing as <span className="font-medium text-foreground">{ROLES.find((r) => r.key === role)?.person}</span> · {ROLES.find((r) => r.key === role)?.label}
            </DialogDescription>
          </DialogHeader>
          {openJob && <JobDetail job={openJob} role={role} />}
        </DialogContent>
      </Dialog>

      {/* Customer modal */}
      <Dialog open={!!openCust} onOpenChange={(o) => !o && setOpenCust(null)}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-display">{openCust?.name}</DialogTitle>
            <DialogDescription>
              Viewing as <span className="font-medium text-foreground">{ROLES.find((r) => r.key === role)?.person}</span> · {ROLES.find((r) => r.key === role)?.label}
            </DialogDescription>
          </DialogHeader>
          {openCust && <CustomerDetail c={openCust} role={role} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
