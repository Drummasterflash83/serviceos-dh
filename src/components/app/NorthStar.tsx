import { useState } from "react";
import {
  Target, TrendingUp, AlertTriangle, ArrowUpRight, ArrowDownRight, CheckCircle2,
  Clock, Sparkles, Building2, CalendarClock, Compass, Timer, Gauge, Workflow,
  FileText, Layers, ShieldCheck, Cpu, Activity, Phone, Mail, MessageSquare,
  Inbox, Users, Wrench, PoundSterling, Briefcase, Package, ListChecks,
  ChevronRight, Star, Flame, ArrowRight, Calculator, Boxes, ScanLine,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ───────── Shared primitives ───────── */

type Tone = "success" | "warning" | "destructive" | "accent" | "muted";

const toneText: Record<Tone, string> = {
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  accent: "text-accent",
  muted: "text-muted-foreground",
};

const tonePill: Record<Tone, string> = {
  success: "bg-success/10 text-success border-success/20",
  warning: "bg-warning/10 text-warning border-warning/20",
  destructive: "bg-destructive/10 text-destructive border-destructive/20",
  accent: "bg-accent/10 text-accent border-accent/20",
  muted: "bg-surface-alt text-muted-foreground border-hairline",
};

function SectionHero({
  eyebrow, title, sub, icon: Icon, pill, pillTone = "accent",
}: {
  eyebrow: string; title: string; sub: string;
  icon: typeof Target; pill?: string; pillTone?: Tone;
}) {
  return (
    <div className="rounded-2xl border border-hairline bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
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
          <div className={cn("rounded-full border px-3 py-1.5 text-[11px] font-medium", tonePill[pillTone])}>
            {pill}
          </div>
        )}
      </div>
    </div>
  );
}

function KPI({
  label, value, target, delta, tone = "muted", sub,
}: {
  label: string; value: string; target?: string; delta?: string; tone?: Tone; sub?: string;
}) {
  return (
    <div className="rounded-xl border border-hairline bg-white p-4">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>{label}</span>
        {target && <span className="font-mono">target {target}</span>}
      </div>
      <div className="text-display mt-3 text-2xl font-bold tabular">{value}</div>
      <div className="mt-2 flex items-center justify-between text-[11px]">
        <span className={cn("font-medium", toneText[tone])}>{delta ?? " "}</span>
        <span className="text-muted-foreground">{sub ?? " "}</span>
      </div>
    </div>
  );
}

function Sparkbar({ pct, tone = "accent" }: { pct: number; tone?: Tone }) {
  const bar =
    tone === "success" ? "bg-success" :
    tone === "warning" ? "bg-warning" :
    tone === "destructive" ? "bg-destructive" :
    tone === "muted" ? "bg-muted-foreground/40" : "bg-accent";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-alt">
      <div className={cn("h-full rounded-full", bar)} style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
    </div>
  );
}

function MockTag() {
  return (
    <span className="rounded-full border border-hairline bg-surface-alt px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
      mock
    </span>
  );
}

/* ───────── 1. NORTH STAR (replaces Dashboard) ───────── */

export function NorthStar() {
  // Distance to £1.26M GP by Mar-28 · today 412k of 1,260k
  const gpToday = 412_000;
  const gpTarget = 1_260_000;
  const pct = Math.round((gpToday / gpTarget) * 100);

  // 24-month glide path (Jul-26 → Mar-28)
  const glide = [
    { m: "Jul 26", a: 412 },
    { m: "Sep 26", a: 470 },
    { m: "Nov 26", a: 540 },
    { m: "Jan 27", a: 605 },
    { m: "Mar 27", a: 690 },
    { m: "Jun 27", a: 805 },
    { m: "Sep 27", a: 935 },
    { m: "Dec 27", a: 1085 },
    { m: "Mar 28", a: 1260 },
  ];
  const maxA = Math.max(...glide.map((g) => g.a));

  const kpis: { label: string; value: string; target: string; delta: string; tone: Tone; sub: string }[] = [
    { label: "GP £ (TTM)",            value: "£412k",    target: "£1.26M Mar-28", delta: "▲ 6.2% MoM",  tone: "success",     sub: "33% of goal" },
    { label: "ARR £",                 value: "£249k",    target: "£700k Mar-28",  delta: "▲ £14k QoQ",  tone: "success",     sub: "next: £360k Mar-27" },
    { label: "PPM share of income",   value: "34%",      target: "≥ 45%",         delta: "▼ vs target", tone: "warning",     sub: "+11pp to land" },
    { label: "HMP concentration",     value: "63%",      target: "< 40%",         delta: "RISK",        tone: "destructive", sub: "Feb-27 renewal" },
    { label: "FW : ARR ratio",        value: "2.8x",     target: "~1.2x",         delta: "ratio trap",  tone: "destructive", sub: "FW running hot" },
    { label: "Avg order value",       value: "£1,940",   target: "£2,566",        delta: "▼ £626",      tone: "warning",     sub: "good/better/best lift" },
    { label: "SLT admin hrs / wk",    value: "18.4",     target: "< 5 (Rudi, Heidi)", delta: "trending ▼", tone: "accent",  sub: "coordinator hire pending" },
  ];

  return (
    <div className="space-y-6">
      {/* Distance to target hero */}
      <div className="overflow-hidden rounded-2xl border border-hairline bg-gradient-to-br from-white to-surface-alt p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-xl">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-foreground text-background">
                <Target className="h-3 w-3" />
              </span>
              North Star · distance to £1.26M GP
            </div>
            <div className="mt-4 flex items-end gap-4">
              <div className="text-display text-6xl font-bold tabular">£848k</div>
              <div className="pb-2 text-sm text-muted-foreground">to go by Mar 28</div>
            </div>
            <div className="mt-4">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>£412k today</span>
                <span>{pct}% of goal</span>
                <span>£1.26M target</span>
              </div>
              <div className="mt-1.5"><Sparkbar pct={pct} /></div>
            </div>
          </div>

          {/* Glide path */}
          <div className="min-w-[320px] flex-1 rounded-xl border border-hairline bg-white p-4">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>24-month glide path</span>
              <span className="font-mono">£k GP</span>
            </div>
            <div className="mt-3 flex h-28 items-end gap-1">
              {glide.map((g, i) => {
                const h = Math.round((g.a / maxA) * 100);
                const last = i === glide.length - 1;
                return (
                  <div key={g.m} className="flex flex-1 flex-col items-center gap-1">
                    <div
                      className={cn("w-full rounded-t", last ? "bg-accent" : i <= 0 ? "bg-foreground" : "bg-foreground/30")}
                      style={{ height: `${h}%` }}
                      title={`${g.m} · £${g.a}k`}
                    />
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex justify-between text-[9px] text-muted-foreground">
              <span>Jul 26</span><span>Mar 27</span><span>Mar 28</span>
            </div>
          </div>
        </div>
      </div>

      {/* Ratio Trap banner */}
      <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
        <div className="flex-1 text-sm">
          <div className="font-semibold text-destructive">Ratio Trap detected · FW:ARR running 2.8x (target 1.2x)</div>
          <div className="mt-1 text-muted-foreground">
            Further Works income is outpacing ARR growth. Hitting £700k ARR while FW runs hot leaves PPM stuck at 34%
            and the £1.26M goal slips by 7 months. The fix lives in the ARR Growth view: 6 to 8 new PPM contracts this year.
          </div>
        </div>
        <button className="shrink-0 rounded-full bg-destructive px-3 py-1.5 text-xs font-semibold text-destructive-foreground">
          Open ARR Growth <ArrowRight className="ml-1 inline h-3 w-3" />
        </button>
      </div>

      {/* 7 Key Numbers */}
      <div>
        <div className="mb-2 flex items-end justify-between">
          <h3 className="text-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            7 Key Numbers
          </h3>
          <span className="text-[10px] text-muted-foreground"><MockTag /> calibrated to New Dawn targets</span>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {kpis.map((k) => (
            <KPI key={k.label} {...k} />
          ))}
          {/* Next highest-leverage move card */}
          <div className="rounded-xl border border-accent/30 bg-accent/5 p-4">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-accent">
              <span>Next highest-leverage move</span>
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            <div className="text-display mt-3 text-base font-semibold leading-tight">
              Clear FW conversion backlog (12 quotes &gt; 48h)
            </div>
            <div className="mt-2 text-[11px] text-muted-foreground">
              Forecast +£21k GP this month. Owner: Larne · gated at 43% margin floor.
            </div>
            <button className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-accent">
              Open Further Works <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────── 2. ARR GROWTH ───────── */

export function ARRGrowth() {
  const segments = [
    { name: "Independent schools",   accounts: ["Godolphin", "Elevate Multi-Academy"],     status: "Live nurture",  pipe: "£42k ARR", tone: "success" as Tone },
    { name: "Yacht clubs",            accounts: ["Royal Lymington YC", "Hamble River SC"], status: "Discovery",      pipe: "£28k ARR", tone: "accent"  as Tone },
    { name: "Care groups",            accounts: ["White Horse", "Bridgewater Homes"],      status: "Quoted",         pipe: "£35k ARR", tone: "accent"  as Tone },
    { name: "Prison framework (MoJ)", accounts: ["HMP renewal", "HMP Winchester"],         status: "RISK · renewal", pipe: "£157k ARR",tone: "destructive" as Tone },
    { name: "Heritage estates",       accounts: ["Bramshill", "Highclere"],                status: "Cold outreach",  pipe: "£18k ARR", tone: "muted"   as Tone },
    { name: "Independent hospitals",  accounts: ["Spire Southampton"],                     status: "Survey scheduled", pipe: "£24k ARR", tone: "accent" as Tone },
    { name: "Boutique hotels",        accounts: ["The Pig Group"],                          status: "Cold outreach",  pipe: "£15k ARR", tone: "muted"   as Tone },
  ];

  const renewals = [
    { account: "HMP Winchester",     date: "Feb 2027",  arr: "£157k", pct: 63, risk: "Critical · 63% of ARR",       tone: "destructive" as Tone },
    { account: "Greenfield Care",    date: "Sep 2026",  arr: "£18k",  pct: 7,  risk: "Mary nurturing · sentiment +", tone: "success" as Tone },
    { account: "ABC School",         date: "Dec 2026",  arr: "£14k",  pct: 6,  risk: "Complaint risk live",          tone: "warning" as Tone },
    { account: "12 Marlborough Rd",  date: "Mar 2027",  arr: "£8k",   pct: 3,  risk: "Stable",                       tone: "muted" as Tone },
  ];

  const nurture: { day: 0 | 30 | 60 | 90; items: string[] }[] = [
    { day: 0,  items: ["Godolphin · intro call booked", "Spire · survey confirmed Wed"] },
    { day: 30, items: ["Royal Lymington YC · second touch", "White Horse · proposal revision"] },
    { day: 60, items: ["The Pig Group · case study send", "Bramshill · re-engage after silence"] },
    { day: 90, items: ["Hamble River SC · loop-close call", "Elevate · contract draft"] },
  ];

  return (
    <div className="space-y-5">
      <SectionHero
        eyebrow="ARR Growth · front of the funnel"
        title="Grow ARR. It surfaces the rest."
        sub="Seven Blue Ocean segments, named target accounts, every renewal date, and Mary's 90-day nurture cycle on one surface. The single highest-leverage action available."
        icon={TrendingUp}
        pill="£249k → £700k by Mar 28"
      />

      <div className="grid gap-3 md:grid-cols-4">
        <KPI label="ARR today"          value="£249k"   target="£700k" delta="▲ £14k QoQ" tone="success" sub="Mar-27 milestone: £360k" />
        <KPI label="PPM contracts"      value="14"      target="20–22" delta="6 to 8 to add" tone="accent" sub="this year" />
        <KPI label="HMP concentration"  value="63%"     target="< 40%" delta="diversify"   tone="destructive" sub="Feb-27 renewal" />
        <KPI label="Pipeline value"     value="£319k"   target="£450k" delta="weighted"    tone="accent" sub="7 segments live" />
      </div>

      {/* Blue Ocean board */}
      <div className="rounded-2xl border border-hairline bg-white">
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
          <div className="text-display text-sm font-semibold">Blue Ocean segments</div>
          <span className="text-[10px] text-muted-foreground">Owner: Mary · review weekly</span>
        </div>
        <div className="divide-y divide-hairline">
          {segments.map((s) => (
            <div key={s.name} className="grid grid-cols-12 items-center gap-3 px-5 py-3 text-sm hover:bg-surface-alt">
              <div className="col-span-3 font-medium">{s.name}</div>
              <div className="col-span-5 text-xs text-muted-foreground">{s.accounts.join(" · ")}</div>
              <div className="col-span-2">
                <span className={cn("rounded-full border px-2 py-0.5 text-[10px]", tonePill[s.tone])}>{s.status}</span>
              </div>
              <div className="col-span-2 text-right font-mono tabular text-xs">{s.pipe}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Renewal calendar */}
        <div className="rounded-2xl border border-hairline bg-white">
          <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
            <div className="text-display text-sm font-semibold">Renewal calendar</div>
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="divide-y divide-hairline">
            {renewals.map((r) => (
              <div key={r.account} className="px-5 py-3">
                <div className="flex items-center justify-between text-sm">
                  <div className="font-medium">{r.account}</div>
                  <div className="font-mono tabular text-xs text-muted-foreground">{r.date} · {r.arr}</div>
                </div>
                <div className="mt-2"><Sparkbar pct={r.pct * 1.5 + 5} tone={r.tone} /></div>
                <div className={cn("mt-1.5 text-[11px]", toneText[r.tone])}>{r.risk}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 90-day nurture */}
        <div className="rounded-2xl border border-hairline bg-white">
          <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
            <div className="text-display text-sm font-semibold">Mary's 90-day nurture</div>
            <Compass className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="grid grid-cols-4 gap-px bg-hairline">
            {nurture.map((c) => (
              <div key={c.day} className="bg-white p-3">
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Day {c.day}</div>
                <ul className="mt-2 space-y-2 text-[11px]">
                  {c.items.map((i) => (
                    <li key={i} className="rounded-md border border-hairline bg-surface-alt p-2 leading-snug">{i}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────── 3. FURTHER WORKS COCKPIT (the 48-hour clock) ───────── */

export function FurtherWorks() {
  type FWStatus = "identified" | "quoted" | "chasing" | "won" | "lost";
  type Row = {
    id: string; site: string; engineer: string; value: number; gp: number;
    surfaced: string; clock: string; status: FWStatus; reason?: string;
  };

  const rows: Row[] = [
    { id: "FW-217", site: "Royal Lymington YC", engineer: "Sam",  value: 4_200, gp: 48, surfaced: "14:08 today",  clock: "33h left",    status: "identified" },
    { id: "FW-216", site: "Godolphin · plant",  engineer: "Aaron", value: 8_900, gp: 41, surfaced: "Yesterday",    clock: "9h left",     status: "quoted" },
    { id: "FW-215", site: "HMP wing 4",         engineer: "Larne", value: 12_400, gp: 38, surfaced: "Yesterday",   clock: "BLOCKED",     status: "identified", reason: "Below 43% GP floor · escalated" },
    { id: "FW-214", site: "ABC School",         engineer: "Mary",  value: 2_750, gp: 52, surfaced: "Mon",          clock: "chasing d6",  status: "chasing" },
    { id: "FW-213", site: "Greenfield Care",    engineer: "Tony",  value: 5_600, gp: 47, surfaced: "Mon",          clock: "complete",    status: "won" },
    { id: "FW-212", site: "Highbridge Foods",   engineer: "Sam",   value: 3_300, gp: 30, surfaced: "Last wk",      clock: "complete",    status: "lost",  reason: "Below floor · declined" },
  ];

  const statusTone: Record<FWStatus, Tone> = {
    identified: "accent", quoted: "warning", chasing: "warning", won: "success", lost: "muted",
  };

  return (
    <div className="space-y-5">
      <SectionHero
        eyebrow="Further Works · 48-hour cockpit"
        title="Identification isn't the gap. Conversion is."
        sub="Engineers already surface £700k of FW on PPM visits. The quote-to-close step is unmanaged. Every opportunity here has an owner, a clock, and a margin gate."
        icon={Timer}
        pill="+£98k recoverable GP on existing volume"
        pillTone="success"
      />

      <div className="grid gap-3 md:grid-cols-4">
        <KPI label="FW conversion rate" value="38%"  target="≥ 60%"  delta="▲ 4pp WoW"     tone="warning" sub="quote-to-won" />
        <KPI label="Avg quote turnaround" value="62h" target="< 48h" delta="▼ 14h vs Apr"  tone="warning" sub="from job-close" />
        <KPI label="GP captured (MTD)"  value="£34.2k" target="£55k" delta="on glide path" tone="success" sub="margin floor held" />
        <KPI label="FW : ARR ratio"     value="2.8x" target="~1.2x" delta="ratio trap"    tone="destructive" sub="grow ARR base" />
      </div>

      <div className="rounded-2xl border border-hairline bg-white">
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
          <div className="text-display text-sm font-semibold">Live opportunity queue</div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <Clock className="h-3.5 w-3.5" /> 15-min Slack alert · 48-hour quote clock
          </div>
        </div>
        <div className="divide-y divide-hairline">
          {rows.map((r) => (
            <div key={r.id} className="grid grid-cols-12 items-center gap-3 px-5 py-3 text-sm hover:bg-surface-alt">
              <div className="col-span-2 font-mono text-xs">{r.id}</div>
              <div className="col-span-3">
                <div className="font-medium">{r.site}</div>
                <div className="text-[11px] text-muted-foreground">{r.engineer} · surfaced {r.surfaced}</div>
              </div>
              <div className="col-span-2 font-mono tabular text-xs">£{r.value.toLocaleString()}</div>
              <div className="col-span-2">
                <span className={cn("rounded-full border px-2 py-0.5 text-[10px]", r.gp >= 43 ? tonePill.success : tonePill.destructive)}>
                  {r.gp}% GP {r.gp < 43 ? "· blocked" : ""}
                </span>
              </div>
              <div className="col-span-2 text-[11px]">
                <div className={cn("font-medium", r.clock.includes("BLOCKED") ? "text-destructive" : r.clock.includes("complete") ? "text-muted-foreground" : "text-foreground")}>
                  {r.clock}
                </div>
                {r.reason && <div className="text-[10px] text-muted-foreground">{r.reason}</div>}
              </div>
              <div className="col-span-1 text-right">
                <span className={cn("rounded-full border px-2 py-0.5 text-[10px] capitalize", tonePill[statusTone[r.status]])}>{r.status}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ───────── 4. QUOTE ENGINE (Larne's Jarvis) ───────── */

export function QuoteEngine() {
  const draft = {
    job: "FW-216 · Godolphin plant-room valve replacement",
    engineerWhy: "Existing 22mm ball valves seized. Recommended brass DZR upgrade. Customer aware of cost.",
    lines: [
      { part: "22mm DZR ball valve", qty: 4, wolseley: 12.40, plumbBase: 11.80, edmundson: 13.10, best: "Plumb Base" },
      { part: "Copper pipe 22mm × 3m", qty: 2, wolseley: 18.20, plumbBase: 19.00, edmundson: 17.60, best: "Edmundson" },
      { part: "Soldered elbow 22mm",   qty: 8, wolseley: 1.20, plumbBase: 1.10, edmundson: 1.30, best: "Plumb Base" },
    ],
    labour: 380,
    options: [
      { tier: "Good",   total: 612, gp: 44, desc: "Replace failed valves only" },
      { tier: "Better", total: 890, gp: 47, desc: "Replace valves + 2 sections suspect pipe" },
      { tier: "Best",   total: 1240, gp: 51, desc: "Full isolation overhaul + 12-month warranty" },
    ],
  };

  const normaliser = [
    { raw: "Cylinder 210L Gledhill StainlessLite",  matched: "Hot water cylinder 210L (Gledhill)", conf: 96 },
    { raw: "22mm copper pipe",                       matched: "Copper pipe 22mm",                   conf: 99 },
    { raw: "Pipe 22mm copper",                       matched: "Copper pipe 22mm",                   conf: 97 },
    { raw: "DZR valve 22",                           matched: "22mm DZR ball valve",                conf: 88 },
    { raw: "Megaflo unvented 250",                   matched: "Unvented cylinder 250L (Megaflo)",   conf: 92 },
  ];

  return (
    <div className="space-y-5">
      <SectionHero
        eyebrow="Quote Engine · Larne's Jarvis"
        title="Drop a job sheet. Get a quote, three options, three suppliers compared."
        sub="The single point of failure, instrumented. Part-name normalisation, three-supplier price compare, good/better/best with the engineer's why, GP-floor enforced at draft."
        icon={Calculator}
        pill="Margin floor: 43% enforced"
        pillTone="success"
      />

      {/* Drop zone */}
      <div className="rounded-2xl border-2 border-dashed border-hairline bg-surface-alt/50 p-8 text-center">
        <Inbox className="mx-auto h-8 w-8 text-muted-foreground" />
        <div className="text-display mt-3 text-base font-semibold">Drop a job sheet or supplier price file</div>
        <div className="mt-1 text-xs text-muted-foreground">CSV, XLSX, PDF, DOCX, TXT or images · or click to browse · auto-pickup from Resend inbox</div>
        <div className="mt-2 text-[10px] text-muted-foreground">Last upload: Wolseley price list · 14 Jun</div>
      </div>

      {/* Approval pop-up style banner */}
      <div className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/5 p-4">
        <Sparkles className="h-5 w-5 shrink-0 text-accent" />
        <div className="flex-1 text-sm">
          <div className="font-semibold">Opportunity 41 is ready to approve</div>
          <div className="text-[11px] text-muted-foreground">FW-216 · auto-drafted in 1m 12s · 3 suppliers compared · margin floor cleared</div>
        </div>
        <button className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground">
          Review &amp; send
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Auto-draft preview + supplier compare */}
        <div className="rounded-2xl border border-hairline bg-white lg:col-span-2">
          <div className="border-b border-hairline px-5 py-3">
            <div className="text-display text-sm font-semibold">{draft.job}</div>
            <div className="mt-1 text-[11px] italic text-muted-foreground">"{draft.engineerWhy}"</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-hairline bg-surface-alt text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-2 text-left">Part</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Wolseley</th>
                  <th className="px-3 py-2 text-right">Plumb Base</th>
                  <th className="px-3 py-2 text-right">Edmundson</th>
                  <th className="px-5 py-2 text-right">Best</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline font-mono tabular text-xs">
                {draft.lines.map((l) => (
                  <tr key={l.part} className="hover:bg-surface-alt">
                    <td className="px-5 py-2 font-sans">{l.part}</td>
                    <td className="px-3 py-2 text-right">{l.qty}</td>
                    <td className={cn("px-3 py-2 text-right", l.best === "Wolseley" && "font-bold text-success")}>£{l.wolseley.toFixed(2)}</td>
                    <td className={cn("px-3 py-2 text-right", l.best === "Plumb Base" && "font-bold text-success")}>£{l.plumbBase.toFixed(2)}</td>
                    <td className={cn("px-3 py-2 text-right", l.best === "Edmundson" && "font-bold text-success")}>£{l.edmundson.toFixed(2)}</td>
                    <td className="px-5 py-2 text-right font-sans text-success">{l.best}</td>
                  </tr>
                ))}
                <tr className="bg-surface-alt">
                  <td className="px-5 py-2 font-sans font-medium">Labour (estimated)</td>
                  <td colSpan={4} />
                  <td className="px-5 py-2 text-right">£{draft.labour.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Good / Better / Best */}
          <div className="grid grid-cols-3 gap-px border-t border-hairline bg-hairline">
            {draft.options.map((o, i) => (
              <div key={o.tier} className={cn("bg-white p-4", i === 1 && "bg-accent/5")}>
                <div className="flex items-center justify-between">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{o.tier}</div>
                  {i === 1 && <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[9px] font-semibold text-accent">recommended</span>}
                </div>
                <div className="text-display mt-2 text-xl font-bold tabular">£{o.total.toLocaleString()}</div>
                <div className="mt-1 text-[11px] text-muted-foreground">{o.desc}</div>
                <div className="mt-2">
                  <span className={cn("rounded-full border px-2 py-0.5 text-[10px]", o.gp >= 43 ? tonePill.success : tonePill.destructive)}>{o.gp}% GP</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Part-name normaliser */}
        <div className="rounded-2xl border border-hairline bg-white">
          <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
            <div className="text-display text-sm font-semibold">Part-name normaliser</div>
            <ScanLine className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="divide-y divide-hairline">
            {normaliser.map((n) => (
              <div key={n.raw} className="px-5 py-3">
                <div className="text-[11px] font-mono text-muted-foreground">"{n.raw}"</div>
                <div className="mt-1 flex items-center justify-between text-xs">
                  <span className="font-medium">→ {n.matched}</span>
                  <span className={cn("font-mono", n.conf >= 95 ? "text-success" : n.conf >= 90 ? "text-accent" : "text-warning")}>{n.conf}%</span>
                </div>
                {n.conf < 90 && (
                  <div className="mt-2 flex gap-1.5">
                    <button className="rounded-full border border-hairline px-2 py-0.5 text-[10px]">Keep separate</button>
                    <button className="rounded-full bg-foreground px-2 py-0.5 text-[10px] text-background">Merge</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────── 5. COORDINATOR COCKPIT ───────── */

export function CoordinatorCockpit() {
  const queues = [
    { name: "Commusoft job processing",     count: 23, owner: "→ Coordinator (Mary today)", icon: Workflow, tone: "warning" as Tone },
    { name: "Timesheet & GPS reconciliation", count: 14, owner: "→ Coordinator (Rudi today)", icon: Activity, tone: "warning" as Tone },
    { name: "Compliance chasing",            count: 8,  owner: "→ Coordinator (Heidi today)", icon: ShieldCheck, tone: "accent" as Tone },
    { name: "FW quote production",           count: 12, owner: "→ Coordinator (Larne today)", icon: FileText, tone: "destructive" as Tone },
    { name: "Tender assembly",               count: 3,  owner: "→ Coordinator (Heidi today)", icon: Briefcase, tone: "muted" as Tone },
  ];

  // SLT admin-hours trend
  const trend = [
    { who: "Rudi",  series: [24, 23, 22, 20, 19, 18, 17, 16], target: 5 },
    { who: "Larne", series: [28, 28, 27, 27, 26, 25, 24, 23], target: 8 },
    { who: "Mary",  series: [22, 22, 21, 20, 19, 18, 17, 16], target: 5 },
    { who: "Heidi", series: [30, 30, 29, 28, 27, 26, 25, 24], target: 5 },
  ];

  return (
    <div className="space-y-5">
      <SectionHero
        eyebrow="Coordinator Cockpit · the structural unlock"
        title="The one hire that makes everything else compound."
        sub="Without the Finance & Ops Coordinator, the SLT never goes outward and no financial KPI lands. This screen instruments the unlock instead of assuming it."
        icon={Users}
        pill="SLT admin target: < 5 hrs / wk"
      />

      <div className="grid gap-3 lg:grid-cols-3">
        {/* What the coordinator absorbs */}
        <div className="rounded-2xl border border-hairline bg-white lg:col-span-2">
          <div className="border-b border-hairline px-5 py-3 text-display text-sm font-semibold">
            What the coordinator absorbs today
          </div>
          <div className="divide-y divide-hairline">
            {queues.map((q) => (
              <div key={q.name} className="flex items-center justify-between px-5 py-3 text-sm hover:bg-surface-alt">
                <div className="flex items-center gap-3">
                  <q.icon className={cn("h-4 w-4", toneText[q.tone])} />
                  <div>
                    <div className="font-medium">{q.name}</div>
                    <div className="text-[11px] text-muted-foreground">{q.owner}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-display text-lg font-bold tabular">{q.count}</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* SLT admin hours trend */}
        <div className="rounded-2xl border border-hairline bg-white">
          <div className="border-b border-hairline px-5 py-3">
            <div className="text-display text-sm font-semibold">SLT admin hrs / wk</div>
            <div className="text-[10px] text-muted-foreground">8-week trend · trending toward target</div>
          </div>
          <div className="space-y-3 p-5">
            {trend.map((t) => {
              const latest = t.series[t.series.length - 1];
              const max = Math.max(...t.series);
              return (
                <div key={t.who}>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-medium">{t.who}</span>
                    <span className="font-mono tabular text-muted-foreground">{latest} / target {t.target}</span>
                  </div>
                  <div className="mt-1.5 flex h-6 items-end gap-0.5">
                    {t.series.map((v, i) => (
                      <div key={i} className="flex-1 rounded-sm bg-accent/60" style={{ height: `${(v / max) * 100}%`, opacity: 0.4 + (i / t.series.length) * 0.6 }} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────── 6. ASSETS · PLANT-ROOM 360 ───────── */

export function Assets() {
  const sites = [
    { name: "Royal Lymington YC", assets: 12, nextFail: "Pump P2 · ~Aug",   warranty: "3 active", iot: "live",  surveyValue: "£3,500", install: "£28k" },
    { name: "Godolphin School",   assets: 24, nextFail: "Boiler 2 · ~Oct",  warranty: "5 active", iot: "live",  surveyValue: "£3,500", install: "£42k" },
    { name: "Greenfield Care",    assets: 9,  nextFail: "Valve cluster · ~Jul", warranty: "2 active", iot: "scheduled", surveyValue: "£3,500", install: "£18k" },
    { name: "ABC School",         assets: 7,  nextFail: "Cylinder · Y4",    warranty: "1 active", iot: "—",     surveyValue: "£3,500", install: "—" },
  ];

  return (
    <div className="space-y-5">
      <SectionHero
        eyebrow="Assets · Plant-Room 360"
        title="From reactive contractor to captive asset lifecycle partner."
        sub="Asset Focused surveys (£3,500 at 60% GM) generate the £900k–£1.8M install pipeline and deepen the relationships that become ARR. Predictive failure means we contact the customer before they ring us."
        icon={Layers}
        pill="Survey pipeline: 11 booked"
        pillTone="success"
      />

      <div className="grid gap-3 md:grid-cols-4">
        <KPI label="Surveys booked (90d)" value="11"   target="14" delta="▲ 3 MoM"     tone="accent" sub="£3,500 × 60% GM" />
        <KPI label="Install pipeline"     value="£148k" target="£300k" delta="▲ £24k" tone="success" sub="from survey → install" />
        <KPI label="Predictive flags"     value="6"     target="—"    delta="3 new"   tone="warning" sub="contact before failure" />
        <KPI label="Warranty recovery"    value="£4.2k" target="£8k"  delta="▲ vs Apr" tone="success" sub="tied to install date" />
      </div>

      <div className="rounded-2xl border border-hairline bg-white">
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
          <div className="text-display text-sm font-semibold">Plant-Room register</div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground"><Cpu className="h-3.5 w-3.5" /> IoT clip data from Chris's device</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-hairline bg-surface-alt text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-2 text-left">Site</th>
                <th className="px-3 py-2 text-right">Assets</th>
                <th className="px-3 py-2 text-left">Predicted failure</th>
                <th className="px-3 py-2 text-left">Warranty</th>
                <th className="px-3 py-2 text-left">IoT</th>
                <th className="px-3 py-2 text-right">Survey</th>
                <th className="px-5 py-2 text-right">Install pipe</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {sites.map((s) => (
                <tr key={s.name} className="hover:bg-surface-alt">
                  <td className="px-5 py-2 font-medium">{s.name}</td>
                  <td className="px-3 py-2 text-right font-mono tabular">{s.assets}</td>
                  <td className="px-3 py-2 text-warning">{s.nextFail}</td>
                  <td className="px-3 py-2 text-muted-foreground">{s.warranty}</td>
                  <td className="px-3 py-2">
                    <span className={cn("rounded-full border px-2 py-0.5 text-[10px]", s.iot === "live" ? tonePill.success : s.iot === "scheduled" ? tonePill.accent : tonePill.muted)}>{s.iot}</span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular text-success">{s.surveyValue}</td>
                  <td className="px-5 py-2 text-right font-mono tabular">{s.install}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-hairline bg-white p-5">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            <FileText className="h-3.5 w-3.5" /> Written condition report · sample
          </div>
          <div className="text-display mt-2 text-base font-semibold">Royal Lymington YC · Plant-Room A</div>
          <div className="mt-3 space-y-2 text-[11px]">
            <div className="flex justify-between border-b border-hairline pb-1.5"><span>Boiler 1 (Worcester 32kW)</span><span className="text-success">Good · serviced Apr 26</span></div>
            <div className="flex justify-between border-b border-hairline pb-1.5"><span>Pump P2</span><span className="text-warning">Watch · vibration up 14%</span></div>
            <div className="flex justify-between border-b border-hairline pb-1.5"><span>Cylinder (250L Megaflo)</span><span className="text-success">Good · 6 yrs of 15</span></div>
            <div className="flex justify-between"><span>Isolation valves</span><span className="text-destructive">Replace · 4 of 8 seized</span></div>
          </div>
          <button className="mt-4 inline-flex items-center gap-1 text-[11px] font-semibold text-accent">
            Open full report (PDF) <ArrowRight className="h-3 w-3" />
          </button>
        </div>

        <div className="rounded-2xl border border-hairline bg-white p-5">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" /> Failure precedes call
          </div>
          <div className="text-display mt-2 text-base font-semibold">3 customers to contact this week</div>
          <ul className="mt-3 space-y-2 text-xs">
            <li className="rounded-md border border-hairline bg-surface-alt p-2.5">
              <div className="font-medium">Greenfield Care · valve cluster</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">Likely failure in 3–4 weeks · proactive call ready for Mary</div>
            </li>
            <li className="rounded-md border border-hairline bg-surface-alt p-2.5">
              <div className="font-medium">Godolphin · Boiler 2 sensor drift</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">IoT trending hot · service brought forward</div>
            </li>
            <li className="rounded-md border border-hairline bg-surface-alt p-2.5">
              <div className="font-medium">Royal Lymington YC · Pump P2</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">Vibration anomaly · book inspection</div>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ───────── 7. COMPLIANCE ROADMAP ───────── */

export function ComplianceRoadmap() {
  const credentials = [
    { name: "SFG20",                    stage: "Mapped",       progress: 70, owner: "Heidi",  due: "Q3 26",  tone: "accent" as Tone },
    { name: "SSIP",                     stage: "Renewal due",  progress: 85, owner: "Heidi",  due: "Aug 26", tone: "warning" as Tone },
    { name: "Security clearance (CTC)", stage: "In flight",    progress: 45, owner: "Tony",   due: "Q4 26",  tone: "accent" as Tone },
    { name: "MoJ framework",            stage: "Application",  progress: 30, owner: "Heidi",  due: "Q1 27",  tone: "muted" as Tone },
    { name: "Gas Safe (multi)",         stage: "Live",         progress: 100, owner: "All",    due: "—",      tone: "success" as Tone },
  ];

  const certs = [
    { engineer: "S. Walsh",  cert: "Unvented HW",         expires: "21 days", tone: "warning" as Tone },
    { engineer: "J. Aaron",  cert: "F-Gas Cat 1",         expires: "62 days", tone: "accent" as Tone },
    { engineer: "L. Brown",  cert: "ACS · Domestic",      expires: "4 mo",    tone: "muted" as Tone },
    { engineer: "Team",      cert: "First Aid",           expires: "9 days",  tone: "destructive" as Tone },
  ];

  const gaps = [
    { item: "RAMS missing on J-3402 (HMP wing)", owner: "Larne", tone: "destructive" as Tone },
    { item: "Open-flue service form missing on J-3398", owner: "Sam", tone: "warning" as Tone },
    { item: "ASHP service form missing on J-3395",      owner: "Aaron", tone: "warning" as Tone },
    { item: "Boiler registration overdue · J-3389",     owner: "Coordinator", tone: "destructive" as Tone },
  ];

  return (
    <div className="space-y-5">
      <SectionHero
        eyebrow="Compliance · credential roadmap"
        title="The difference between being considered and being shortlisted."
        sub="SFG20, SSIP, security clearance, MoJ framework as a pipeline, not a folder. Plus the everyday gaps: missed registrations, expiring tickets, RAMS, engineer forms."
        icon={ShieldCheck}
        pill="Audit gaps: 4 open"
        pillTone="warning"
      />

      <div className="grid gap-3 md:grid-cols-4">
        <KPI label="Audit-readiness"   value="86%" target="100%" delta="▲ 4pp" tone="accent" sub="weighted by contract type" />
        <KPI label="Open gaps"         value="4"   target="0"    delta="2 critical" tone="destructive" sub="2 chasing today" />
        <KPI label="Certs valid"       value="26 / 27" target="27 / 27" delta="1 expiring" tone="warning" sub="auto-renewal pack ready" />
        <KPI label="Credential pipeline" value="5" target="5"   delta="MoJ furthest out" tone="accent" sub="qualifies for prison work" />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-2xl border border-hairline bg-white lg:col-span-2">
          <div className="border-b border-hairline px-5 py-3 text-display text-sm font-semibold">Credential pipeline</div>
          <div className="divide-y divide-hairline">
            {credentials.map((c) => (
              <div key={c.name} className="px-5 py-3">
                <div className="flex items-center justify-between text-sm">
                  <div className="font-medium">{c.name}</div>
                  <div className="font-mono tabular text-xs text-muted-foreground">{c.owner} · {c.due}</div>
                </div>
                <div className="mt-2"><Sparkbar pct={c.progress} tone={c.tone} /></div>
                <div className="mt-1 flex items-center justify-between text-[11px]">
                  <span className={toneText[c.tone]}>{c.stage}</span>
                  <span className="font-mono text-muted-foreground">{c.progress}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-2xl border border-hairline bg-white">
            <div className="border-b border-hairline px-5 py-3 text-display text-sm font-semibold">Certs expiring</div>
            <div className="divide-y divide-hairline">
              {certs.map((c) => (
                <div key={c.engineer + c.cert} className="flex items-center justify-between px-5 py-2.5 text-sm">
                  <div>
                    <div className="font-medium">{c.engineer}</div>
                    <div className="text-[11px] text-muted-foreground">{c.cert}</div>
                  </div>
                  <span className={cn("rounded-full border px-2 py-0.5 text-[10px]", tonePill[c.tone])}>{c.expires}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-hairline bg-white">
            <div className="border-b border-hairline px-5 py-3 text-display text-sm font-semibold">Open gaps</div>
            <ul className="divide-y divide-hairline">
              {gaps.map((g) => (
                <li key={g.item} className="flex items-center justify-between px-5 py-2.5 text-sm">
                  <span className="pr-3">{g.item}</span>
                  <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px]", tonePill[g.tone])}>{g.owner}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────── 8. CALLS & COMMS (SLA + complaints) ───────── */

export function CommsHub() {
  const slas = [
    { channel: "Emergency · phone",     tier: "All tiers", target: "15 min", actual: "9 min",  pct: 97, tone: "success" as Tone },
    { channel: "Complaint · email",     tier: "All tiers", target: "24 h",   actual: "11 h",   pct: 94, tone: "success" as Tone },
    { channel: "Quote follow-up",       tier: "All tiers", target: "3 d",    actual: "2.1 d",  pct: 88, tone: "accent" as Tone },
    { channel: "Warranty callback",     tier: "PPM",       target: "48 h",   actual: "31 h",   pct: 91, tone: "success" as Tone },
    { channel: "General · email",       tier: "All tiers", target: "1 d",    actual: "1.4 d",  pct: 71, tone: "warning" as Tone },
  ];

  const complaints: { id: string; cust: string; risk: "red" | "orange" | "green"; sentiment: number; owner: string; note: string }[] = [
    { id: "C-091", cust: "ABC School",          risk: "red",    sentiment: -0.72, owner: "Mary",  note: "No callback in 2 days · goodwill £50 ready" },
    { id: "C-090", cust: "Greenfield Care",     risk: "orange", sentiment: -0.31, owner: "Mary",  note: "Engineer late twice · service plan review" },
    { id: "C-089", cust: "12 Marlborough Rd",   risk: "green",  sentiment: +0.12, owner: "Heidi", note: "Resolved · awaiting review request" },
  ];

  return (
    <div className="space-y-5">
      <SectionHero
        eyebrow="Calls & Comms · SLA + complaint grading"
        title="The reactive firefight becomes a managed protocol."
        sub="Defined response SLAs, complaints owned by Mary and graded by the system (never self-judged), call recording with sentiment + complaint-risk scoring, and emergency routing with a real backup to Tony."
        icon={MessageSquare}
        pill="Inside protocol: 94%"
        pillTone="success"
      />

      <div className="grid gap-3 md:grid-cols-4">
        <KPI label="Inside SLA"          value="94%"  target="≥ 95%" delta="▲ 2pp"     tone="success" sub="weighted by tier" />
        <KPI label="Active complaints"   value="3"    target="< 5"   delta="1 red"     tone="warning" sub="Mary owns response" />
        <KPI label="Avg call sentiment"  value="+0.41" target="+0.5" delta="▲ vs wk"   tone="accent" sub="recorded + scored" />
        <KPI label="Emergency backup"    value="armed" target="armed" delta="Tony + Aaron" tone="success" sub="no single point" />
      </div>

      <div className="grid gap-3 lg:grid-cols-5">
        <div className="rounded-2xl border border-hairline bg-white lg:col-span-3">
          <div className="border-b border-hairline px-5 py-3 text-display text-sm font-semibold">Response SLAs</div>
          <div className="divide-y divide-hairline">
            {slas.map((s) => (
              <div key={s.channel} className="grid grid-cols-12 items-center gap-3 px-5 py-3 text-sm hover:bg-surface-alt">
                <div className="col-span-4 font-medium">{s.channel}</div>
                <div className="col-span-2 text-[11px] text-muted-foreground">{s.tier}</div>
                <div className="col-span-2 font-mono tabular text-xs">{s.actual} / {s.target}</div>
                <div className="col-span-3"><Sparkbar pct={s.pct} tone={s.tone} /></div>
                <div className={cn("col-span-1 text-right font-mono text-xs", toneText[s.tone])}>{s.pct}%</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-hairline bg-white lg:col-span-2">
          <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
            <div className="text-display text-sm font-semibold">Complaints · system-graded</div>
            <Flame className="h-4 w-4 text-destructive" />
          </div>
          <div className="divide-y divide-hairline">
            {complaints.map((c) => {
              const dot = c.risk === "red" ? "bg-destructive" : c.risk === "orange" ? "bg-warning" : "bg-success";
              return (
                <div key={c.id} className="px-5 py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={cn("h-2.5 w-2.5 rounded-full", dot)} />
                      <span className="font-medium">{c.cust}</span>
                    </div>
                    <span className="font-mono text-[11px] text-muted-foreground">{c.id} · {c.owner}</span>
                  </div>
                  <div className="mt-1.5 text-[11px] text-muted-foreground">{c.note}</div>
                  <div className="mt-1.5 flex items-center justify-between text-[10px]">
                    <span className="text-muted-foreground">sentiment</span>
                    <span className={cn("font-mono", c.sentiment < 0 ? "text-destructive" : "text-success")}>
                      {c.sentiment > 0 ? "+" : ""}{c.sentiment.toFixed(2)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
