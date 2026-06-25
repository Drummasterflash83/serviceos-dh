import { useState } from "react";
import {
  HardHat, Wrench, Trophy, Camera, FileText, Phone, MessageSquare, Mail,
  Clock, Gauge, AlertTriangle, CheckCircle2, XCircle, Sparkles, TrendingUp,
  TrendingDown, Award, ShieldCheck, GraduationCap, MapPin, Activity,
  PhoneCall, ChevronRight, Search, Filter, ThumbsUp, Smile, Meh, Frown,
  Flame, Star, Calendar, ClipboardCheck, RefreshCw, Heart,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

/* ──────────── DATA ──────────── */
type Trend = "up" | "flat" | "down";

type Engineer = {
  id: string;
  name: string;
  initials: string;
  role: string;
  region: string;
  tone: string; // avatar tint
  yearsAtDH: number;

  // Composite "Super Tony" score 0-100
  superTed: number;
  superTedTrend: Trend;
  rank: number;
  streak: number; // weeks above threshold

  // Job-sheet & data-input quality (the biggest discovery gap)
  dataInput: number;          // 0-100 — Heidi/Mary/Larne's biggest pain
  photosPerJob: number;       // avg
  serialsCaptured: number;    // %
  ramsAttached: number;       // %
  voiceNotesUsed: number;     // % of jobs

  // Output / commercial
  firstTimeFix: number;       // %
  returnRate: number;         // %
  hoursVsQuoted: number;      // ratio (1.0 = on the nose; >1 = overran)
  jobsThisWeek: number;
  partsAccuracy: number;      // % (right parts first time)

  // Comms responsiveness
  chasesThisWeek: number;     // times Mary/Larne had to chase
  avgCallbackMins: number;
  slackReplyMins: number;
  callsSentiment: "Positive" | "Neutral" | "Frustrated";
  customerTone: number;       // 0-100 derived

  // Wellbeing / morale
  morale: number;             // 0-100
  workload: "Light" | "Steady" | "Heavy" | "Slammed";

  // Certifications
  certs: { name: string; expires: string; status: "valid" | "soon" | "expired" }[];

  // Hidden expertise / recognition
  wins: { date: string; what: string }[];
  flags: { tone: "warning" | "destructive" | "success"; text: string }[];

  // Sparkline for Super Tony
  spark: number[];
};

const ENGINEERS: Engineer[] = [
  {
    id: "E-01", name: "Ryan Avery", initials: "RA", role: "Senior · Commercial", region: "Hampshire", tone: "bg-emerald-500",
    yearsAtDH: 6,
    superTed: 92, superTedTrend: "up", rank: 1, streak: 11,
    dataInput: 96, photosPerJob: 14, serialsCaptured: 98, ramsAttached: 100, voiceNotesUsed: 88,
    firstTimeFix: 94, returnRate: 3, hoursVsQuoted: 0.94, jobsThisWeek: 11, partsAccuracy: 97,
    chasesThisWeek: 0, avgCallbackMins: 12, slackReplyMins: 6, callsSentiment: "Positive", customerTone: 94,
    morale: 88, workload: "Steady",
    certs: [
      { name: "Gas Safe · Commercial", expires: "Mar 2027", status: "valid" },
      { name: "F-Gas",                 expires: "Aug 2026", status: "valid" },
      { name: "Unvented HW",           expires: "Nov 2025", status: "soon" },
    ],
    wins: [
      { date: "Wed", what: "Detail so good Larne 'felt in the plant room'" },
      { date: "Mon", what: "Closed Greenfield service in 3.2h vs 5h quoted" },
    ],
    flags: [{ tone: "success", text: "Benchmark for data-input quality" }],
    spark: [80, 82, 85, 84, 87, 89, 90, 91, 92],
  },
  {
    id: "E-02", name: "Tom Patel", initials: "TP", role: "Senior · Domestic", region: "Hampshire", tone: "bg-sky-500",
    yearsAtDH: 4,
    superTed: 84, superTedTrend: "up", rank: 2, streak: 6,
    dataInput: 88, photosPerJob: 10, serialsCaptured: 92, ramsAttached: 95, voiceNotesUsed: 71,
    firstTimeFix: 91, returnRate: 5, hoursVsQuoted: 1.02, jobsThisWeek: 14, partsAccuracy: 93,
    chasesThisWeek: 1, avgCallbackMins: 24, slackReplyMins: 11, callsSentiment: "Positive", customerTone: 88,
    morale: 81, workload: "Heavy",
    certs: [
      { name: "Gas Safe · Domestic", expires: "Jul 2026", status: "valid" },
      { name: "Water Regs",          expires: "Oct 2025", status: "soon" },
    ],
    wins: [{ date: "Tue", what: "Customer named him on the wraparound review" }],
    flags: [],
    spark: [70, 74, 76, 78, 80, 82, 81, 83, 84],
  },
  {
    id: "E-03", name: "Tariq Reid", initials: "TR", role: "Lead · Plant Rooms", region: "London", tone: "bg-violet-500",
    yearsAtDH: 8,
    superTed: 79, superTedTrend: "flat", rank: 3, streak: 4,
    dataInput: 82, photosPerJob: 9, serialsCaptured: 86, ramsAttached: 92, voiceNotesUsed: 64,
    firstTimeFix: 88, returnRate: 7, hoursVsQuoted: 1.08, jobsThisWeek: 9, partsAccuracy: 90,
    chasesThisWeek: 2, avgCallbackMins: 38, slackReplyMins: 22, callsSentiment: "Neutral", customerTone: 78,
    morale: 72, workload: "Heavy",
    certs: [
      { name: "Gas Safe · Commercial", expires: "Feb 2026", status: "soon" },
      { name: "Working at Height",     expires: "Sep 2025", status: "soon" },
    ],
    wins: [{ date: "Last wk", what: "On-call hero · 2am leak in Mayfair" }],
    flags: [{ tone: "warning", text: "London parking notes inconsistent" }],
    spark: [76, 78, 79, 80, 78, 79, 80, 79, 79],
  },
  {
    id: "E-04", name: "Mo Patel", initials: "MP", role: "Engineer · Service", region: "Hampshire", tone: "bg-amber-500",
    yearsAtDH: 3,
    superTed: 74, superTedTrend: "up", rank: 4, streak: 3,
    dataInput: 78, photosPerJob: 8, serialsCaptured: 80, ramsAttached: 86, voiceNotesUsed: 52,
    firstTimeFix: 86, returnRate: 8, hoursVsQuoted: 1.05, jobsThisWeek: 12, partsAccuracy: 88,
    chasesThisWeek: 3, avgCallbackMins: 41, slackReplyMins: 19, callsSentiment: "Neutral", customerTone: 74,
    morale: 76, workload: "Steady",
    certs: [{ name: "Gas Safe · Domestic", expires: "Jun 2026", status: "valid" }],
    wins: [],
    flags: [],
    spark: [62, 65, 67, 70, 71, 72, 73, 74, 74],
  },
  {
    id: "E-05", name: "Sarah Walsh", initials: "SW", role: "Engineer", region: "Hampshire", tone: "bg-pink-500",
    yearsAtDH: 2,
    superTed: 72, superTedTrend: "up", rank: 5, streak: 2,
    dataInput: 74, photosPerJob: 7, serialsCaptured: 76, ramsAttached: 88, voiceNotesUsed: 48,
    firstTimeFix: 84, returnRate: 9, hoursVsQuoted: 1.04, jobsThisWeek: 10, partsAccuracy: 86,
    chasesThisWeek: 2, avgCallbackMins: 35, slackReplyMins: 14, callsSentiment: "Positive", customerTone: 82,
    morale: 84, workload: "Steady",
    certs: [{ name: "Gas Safe · Domestic", expires: "May 2027", status: "valid" }],
    wins: [{ date: "Wed", what: "First wraparound 5★ this month" }],
    flags: [],
    spark: [58, 62, 64, 66, 68, 70, 71, 72, 72],
  },
  {
    id: "E-06", name: "Liam Bryan", initials: "LB", role: "Engineer · Commercial", region: "Hampshire", tone: "bg-indigo-500",
    yearsAtDH: 5,
    superTed: 68, superTedTrend: "flat", rank: 6, streak: 1,
    dataInput: 70, photosPerJob: 6, serialsCaptured: 68, ramsAttached: 80, voiceNotesUsed: 38,
    firstTimeFix: 82, returnRate: 10, hoursVsQuoted: 1.11, jobsThisWeek: 9, partsAccuracy: 84,
    chasesThisWeek: 4, avgCallbackMins: 52, slackReplyMins: 28, callsSentiment: "Neutral", customerTone: 70,
    morale: 64, workload: "Heavy",
    certs: [
      { name: "Gas Safe · Commercial", expires: "Dec 2025", status: "soon" },
      { name: "Unvented HW",           expires: "Oct 2024", status: "expired" },
    ],
    wins: [],
    flags: [
      { tone: "destructive", text: "Unvented HW cert expired" },
      { tone: "warning", text: "Hours over-running 11% on average" },
    ],
    spark: [70, 71, 70, 69, 68, 68, 67, 68, 68],
  },
  {
    id: "E-07", name: "Tony Stocko", initials: "TS", role: "Senior · 'Old guard'", region: "Hampshire", tone: "bg-slate-700",
    yearsAtDH: 1,
    superTed: 66, superTedTrend: "up", rank: 7, streak: 1,
    dataInput: 52, photosPerJob: 4, serialsCaptured: 60, ramsAttached: 70, voiceNotesUsed: 14,
    firstTimeFix: 96, returnRate: 2, hoursVsQuoted: 0.92, jobsThisWeek: 8, partsAccuracy: 98,
    chasesThisWeek: 3, avgCallbackMins: 28, slackReplyMins: 90, callsSentiment: "Positive", customerTone: 92,
    morale: 78, workload: "Steady",
    certs: [
      { name: "Gas Safe · Commercial", expires: "Jan 2027", status: "valid" },
      { name: "ACS Core",              expires: "Jan 2027", status: "valid" },
    ],
    wins: [{ date: "Mon", what: "Diagnosed boiler fault in 8 minutes — apprentice gold" }],
    flags: [
      { tone: "warning", text: "Hates Commusoft — voice-to-card onboarding pending" },
      { tone: "warning", text: "Slack reply 90m avg · prefers phone" },
    ],
    spark: [58, 60, 61, 62, 63, 64, 65, 66, 66],
  },
  {
    id: "E-08", name: "Rob Hayes", initials: "RH", role: "Engineer · Commercial", region: "Hampshire", tone: "bg-rose-600",
    yearsAtDH: 7,
    superTed: 48, superTedTrend: "down", rank: 8, streak: 0,
    dataInput: 38, photosPerJob: 2, serialsCaptured: 41, ramsAttached: 52, voiceNotesUsed: 8,
    firstTimeFix: 79, returnRate: 14, hoursVsQuoted: 1.18, jobsThisWeek: 7, partsAccuracy: 78,
    chasesThisWeek: 11, avgCallbackMins: 240, slackReplyMins: 180, callsSentiment: "Frustrated", customerTone: 58,
    morale: 52, workload: "Heavy",
    certs: [
      { name: "Gas Safe · Commercial", expires: "Apr 2026", status: "valid" },
      { name: "LPG",                   expires: "Aug 2024", status: "expired" },
    ],
    wins: [{ date: "—", what: "Big technical brain when engaged" }],
    flags: [
      { tone: "destructive", text: "LPG cert expired · book Portchester" },
      { tone: "destructive", text: "11 chases this week (Mary + Larne)" },
      { tone: "warning", text: "Customer callbacks averaging 4h" },
      { tone: "warning", text: "Prison job has 0 photos on file" },
    ],
    spark: [60, 58, 56, 54, 52, 51, 50, 49, 48],
  },
  {
    id: "E-09", name: "Brad Khan", initials: "BK", role: "Apprentice", region: "Hampshire", tone: "bg-cyan-600",
    yearsAtDH: 1,
    superTed: 61, superTedTrend: "up", rank: 9, streak: 2,
    dataInput: 64, photosPerJob: 6, serialsCaptured: 70, ramsAttached: 78, voiceNotesUsed: 42,
    firstTimeFix: 71, returnRate: 11, hoursVsQuoted: 1.14, jobsThisWeek: 5, partsAccuracy: 80,
    chasesThisWeek: 1, avgCallbackMins: 18, slackReplyMins: 9, callsSentiment: "Positive", customerTone: 84,
    morale: 86, workload: "Light",
    certs: [{ name: "ACS Core (in progress)", expires: "—", status: "soon" }],
    wins: [{ date: "Tue", what: "Asked the right question on a Vaillant fault" }],
    flags: [],
    spark: [42, 46, 50, 53, 55, 57, 59, 60, 61],
  },
];

/* ──────────── UI HELPERS ──────────── */
function scoreTone(v: number) {
  return v >= 85 ? "success" : v >= 70 ? "warning" : "destructive";
}
function scoreText(v: number) {
  return v >= 85 ? "text-success" : v >= 70 ? "text-warning" : "text-destructive";
}
function scoreBg(v: number) {
  return v >= 85 ? "bg-success" : v >= 70 ? "bg-warning" : "bg-destructive";
}
function TrendIcon({ t }: { t: Trend }) {
  if (t === "up") return <TrendingUp className="h-3 w-3 text-success" />;
  if (t === "down") return <TrendingDown className="h-3 w-3 text-destructive" />;
  return <span className="inline-block h-px w-3 bg-muted-foreground/60" />;
}
function SentIcon({ s }: { s: Engineer["callsSentiment"] }) {
  if (s === "Positive") return <Smile className="h-3.5 w-3.5 text-success" />;
  if (s === "Neutral") return <Meh className="h-3.5 w-3.5 text-muted-foreground" />;
  return <Frown className="h-3.5 w-3.5 text-destructive" />;
}

function Spark({ data, tone = "var(--color-foreground)" }: { data: number[]; tone?: string }) {
  const w = 100, h = 28;
  const min = Math.min(...data), max = Math.max(...data);
  const span = Math.max(1, max - min);
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / span) * (h - 4) - 2}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-7 w-full" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={tone} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Ring({ value, size = 64 }: { value: number; size?: number }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const off = c - (value / 100) * c;
  const stroke = value >= 85 ? "var(--color-success)" : value >= 70 ? "var(--color-warning)" : "var(--color-destructive)";
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--color-hairline)" strokeWidth="6" fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={stroke} strokeWidth="6" fill="none"
                strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <span className="text-display text-base font-bold tabular">{value}</span>
      </div>
    </div>
  );
}

function MetricBar({ label, value, suffix = "", icon: Icon, invert = false }:
  { label: string; value: number; suffix?: string; icon: typeof Wrench; invert?: boolean }) {
  // For "lower is better" metrics (chases, returns), invert tone.
  const display = invert ? 100 - Math.min(100, value * 8) : value;
  const tone = scoreBg(display);
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className="inline-flex items-center gap-1"><Icon className="h-3 w-3" />{label}</span>
        <span className="font-mono tabular text-foreground">{value}{suffix}</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-alt">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.max(4, Math.min(100, display))}%` }} />
      </div>
    </div>
  );
}

/* ──────────── COMPACT CARD ──────────── */
function EngineerCard({ e, onOpen }: { e: Engineer; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="group relative w-full overflow-hidden rounded-2xl border border-hairline bg-white p-4 text-left transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-soft)]"
    >
      {/* Rank ribbon */}
      <div className="absolute right-3 top-3 flex items-center gap-1 rounded-full border border-hairline bg-surface-alt px-2 py-0.5 text-[10px] font-mono">
        #{e.rank}
        {e.rank === 1 && <Trophy className="h-3 w-3 text-warning" />}
      </div>

      {/* Identity */}
      <div className="flex items-center gap-3">
        <div className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-full text-sm font-semibold text-white", e.tone)}>
          {e.initials}
        </div>
        <div className="min-w-0">
          <div className="text-display truncate text-sm font-semibold">{e.name}</div>
          <div className="truncate text-[11px] text-muted-foreground">{e.role} · {e.region}</div>
        </div>
      </div>

      {/* Super Tony score + trend + spark */}
      <div className="mt-4 grid grid-cols-5 items-center gap-3">
        <div className="col-span-2 flex items-center gap-3">
          <Ring value={e.superTed} size={56} />
          <div className="min-w-0">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              Super Tony <TrendIcon t={e.superTedTrend} />
            </div>
            <div className="text-[10px] text-muted-foreground">
              {e.streak > 0 ? `${e.streak}w streak` : "no streak"}
            </div>
          </div>
        </div>
        <div className="col-span-3">
          <Spark data={e.spark} tone={
            e.superTedTrend === "up" ? "var(--color-success)"
            : e.superTedTrend === "down" ? "var(--color-destructive)"
            : "var(--color-muted-foreground)"
          } />
          <div className="mt-1 flex justify-between font-mono text-[9px] text-muted-foreground">
            <span>9w ago</span><span>now</span>
          </div>
        </div>
      </div>

      {/* Three pillar bars */}
      <div className="mt-4 space-y-2">
        <MetricBar label="Data input quality" value={e.dataInput} suffix="" icon={ClipboardCheck} />
        <MetricBar label="First-time fix"     value={e.firstTimeFix} suffix="%" icon={Wrench} />
        <MetricBar label="Comms · chases/wk"  value={e.chasesThisWeek} icon={MessageSquare} invert />
      </div>

      {/* Footer row */}
      <div className="mt-3 flex items-center justify-between border-t border-hairline pt-3 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1"><Camera className="h-3 w-3" />{e.photosPerJob}/job</span>
          <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{Math.round(e.hoursVsQuoted * 100)}%</span>
          <span className="inline-flex items-center gap-1"><SentIcon s={e.callsSentiment} />{e.callsSentiment}</span>
        </div>
        {e.flags.some((f) => f.tone === "destructive") && (
          <span className="inline-flex items-center gap-1 text-destructive">
            <AlertTriangle className="h-3 w-3" />{e.flags.filter(f => f.tone === "destructive").length}
          </span>
        )}
      </div>

      <span className="pointer-events-none absolute bottom-3 right-3 opacity-0 transition group-hover:opacity-100">
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </span>
    </button>
  );
}

/* ──────────── DETAIL ──────────── */
function EngineerDetail({ e }: { e: Engineer }) {
  const Section = ({ title, icon: Icon, children, right }:
    { title: string; icon: typeof Wrench; children: React.ReactNode; right?: React.ReactNode }) => (
    <div className="rounded-xl border border-hairline bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          <Icon className="h-3 w-3" /> {title}
        </div>
        {right}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Hero */}
      <div className="rounded-2xl border border-hairline bg-gradient-to-br from-white to-surface-alt p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className={cn("grid h-16 w-16 place-items-center rounded-full text-lg font-bold text-white", e.tone)}>
              {e.initials}
            </div>
            <div>
              <div className="text-display text-xl font-semibold">{e.name}</div>
              <div className="text-sm text-muted-foreground">{e.role} · {e.region} · {e.yearsAtDH}y at DH</div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-warning">
                  <Trophy className="h-3 w-3" /> Rank #{e.rank}
                </span>
                {e.streak > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-success">
                    <Flame className="h-3 w-3" /> {e.streak} week streak
                  </span>
                )}
                <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5",
                  e.workload === "Slammed" && "bg-destructive/10 text-destructive",
                  e.workload === "Heavy"   && "bg-warning/10 text-warning",
                  e.workload === "Steady"  && "bg-accent/10 text-accent",
                  e.workload === "Light"   && "bg-surface-alt text-muted-foreground",
                )}>
                  <Activity className="h-3 w-3" /> {e.workload}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-end gap-4">
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Super Tony</div>
              <div className={cn("text-display text-3xl font-bold tabular", scoreText(e.superTed))}>{e.superTed}</div>
              <div className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
                <TrendIcon t={e.superTedTrend} /> last 9 weeks
              </div>
            </div>
            <div className="h-12 w-32">
              <Spark data={e.spark} tone={
                e.superTedTrend === "up" ? "var(--color-success)"
                : e.superTedTrend === "down" ? "var(--color-destructive)"
                : "var(--color-muted-foreground)"
              } />
            </div>
          </div>
        </div>
      </div>

      {/* The 4 pillars */}
      <div className="grid gap-3 md:grid-cols-2">
        <Section title="Data input · job sheets" icon={ClipboardCheck}
          right={<span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium",
            e.dataInput >= 85 ? "bg-success/10 text-success" : e.dataInput >= 70 ? "bg-warning/10 text-warning" : "bg-destructive/10 text-destructive",
          )}>{e.dataInput}/100</span>}>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="flex items-center justify-between"><span>Photos / job</span><span className="font-mono tabular">{e.photosPerJob}</span></div>
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-surface-alt">
                <div className={scoreBg(Math.min(100, e.photosPerJob * 8))} style={{ width: `${Math.min(100, e.photosPerJob * 8)}%`, height: "100%" }} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between"><span>Serials captured</span><span className="font-mono tabular">{e.serialsCaptured}%</span></div>
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-surface-alt">
                <div className={scoreBg(e.serialsCaptured)} style={{ width: `${e.serialsCaptured}%`, height: "100%" }} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between"><span>RAMS attached</span><span className="font-mono tabular">{e.ramsAttached}%</span></div>
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-surface-alt">
                <div className={scoreBg(e.ramsAttached)} style={{ width: `${e.ramsAttached}%`, height: "100%" }} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between"><span>Voice-to-card use</span><span className="font-mono tabular">{e.voiceNotesUsed}%</span></div>
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-surface-alt">
                <div className={scoreBg(e.voiceNotesUsed)} style={{ width: `${e.voiceNotesUsed}%`, height: "100%" }} />
              </div>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Larne's biggest pain: missing serials, data plates and access info. This score weights what would otherwise land in Slack as a chase.
          </p>
        </Section>

        <Section title="On the tools · output" icon={Wrench}
          right={<span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium",
            e.firstTimeFix >= 90 ? "bg-success/10 text-success" : e.firstTimeFix >= 80 ? "bg-warning/10 text-warning" : "bg-destructive/10 text-destructive",
          )}>{e.firstTimeFix}% first-time fix</span>}>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-md bg-surface-alt p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Return rate</div>
              <div className={cn("text-display text-lg font-bold tabular", e.returnRate <= 5 ? "text-success" : e.returnRate <= 10 ? "text-warning" : "text-destructive")}>{e.returnRate}%</div>
            </div>
            <div className="rounded-md bg-surface-alt p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Hours vs quoted</div>
              <div className={cn("text-display text-lg font-bold tabular", e.hoursVsQuoted <= 1.0 ? "text-success" : e.hoursVsQuoted <= 1.1 ? "text-warning" : "text-destructive")}>
                {Math.round(e.hoursVsQuoted * 100)}%
              </div>
            </div>
            <div className="rounded-md bg-surface-alt p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Jobs this week</div>
              <div className="text-display text-lg font-bold tabular">{e.jobsThisWeek}</div>
            </div>
            <div className="rounded-md bg-surface-alt p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Parts accuracy</div>
              <div className={cn("text-display text-lg font-bold tabular", scoreText(e.partsAccuracy))}>{e.partsAccuracy}%</div>
            </div>
          </div>
        </Section>

        <Section title="Comms responsiveness" icon={MessageSquare}
          right={
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium",
              e.chasesThisWeek <= 1 ? "bg-success/10 text-success" : e.chasesThisWeek <= 4 ? "bg-warning/10 text-warning" : "bg-destructive/10 text-destructive",
            )}>{e.chasesThisWeek} chases this wk</span>
          }>
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md bg-surface-alt p-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Callback</div>
                <div className={cn("text-display text-base font-bold tabular", e.avgCallbackMins <= 30 ? "text-success" : e.avgCallbackMins <= 90 ? "text-warning" : "text-destructive")}>{e.avgCallbackMins}m</div>
              </div>
              <div className="rounded-md bg-surface-alt p-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Slack reply</div>
                <div className={cn("text-display text-base font-bold tabular", e.slackReplyMins <= 20 ? "text-success" : e.slackReplyMins <= 60 ? "text-warning" : "text-destructive")}>{e.slackReplyMins}m</div>
              </div>
              <div className="rounded-md bg-surface-alt p-2">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Customer tone</div>
                <div className={cn("text-display text-base font-bold tabular", scoreText(e.customerTone))}>{e.customerTone}</div>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border border-hairline px-3 py-2">
              <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-muted-foreground" /> Last 10 customer calls</div>
              <div className="flex items-center gap-1.5">
                {[..."ppnppnpnFp"].map((c, i) => {
                  const tone = c === "p" ? "bg-success" : c === "n" ? "bg-muted-foreground/40" : "bg-destructive";
                  return <span key={i} className={cn("h-2 w-2 rounded-full", tone)} />;
                })}
              </div>
            </div>
          </div>
        </Section>

        <Section title="Wellbeing · morale" icon={Heart}
          right={<span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium",
            e.morale >= 80 ? "bg-success/10 text-success" : e.morale >= 60 ? "bg-warning/10 text-warning" : "bg-destructive/10 text-destructive",
          )}>{e.morale}/100</span>}>
          <div className="space-y-2 text-xs">
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-alt">
              <div className={scoreBg(e.morale)} style={{ width: `${e.morale}%`, height: "100%" }} />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Signal blends Slack tone, callback latency, peer mentions in #engineer-wins, and workload. Larne is prompted when morale drops two weeks running.
            </p>
            <button className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-hairline px-2.5 py-1 text-[11px] hover:bg-surface-alt">
              <ThumbsUp className="h-3 w-3" /> Prompt Larne to check in
            </button>
          </div>
        </Section>
      </div>

      {/* Certs + Wins + Flags */}
      <div className="grid gap-3 md:grid-cols-3">
        <Section title="Certifications" icon={GraduationCap}>
          <ul className="space-y-2 text-xs">
            {e.certs.map((c) => (
              <li key={c.name} className="flex items-center justify-between rounded-md bg-surface-alt px-2.5 py-1.5">
                <span className="min-w-0 truncate font-medium">{c.name}</span>
                <span className={cn("ml-2 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                  c.status === "valid" && "bg-success/10 text-success",
                  c.status === "soon"  && "bg-warning/10 text-warning",
                  c.status === "expired" && "bg-destructive/10 text-destructive",
                )}>{c.status === "valid" ? c.expires : c.status === "soon" ? `expires ${c.expires}` : `expired ${c.expires}`}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Recent wins" icon={Award}>
          {e.wins.length === 0 ? (
            <p className="text-xs text-muted-foreground">No wins logged this fortnight — prompt apprentice/peer recognition.</p>
          ) : (
            <ul className="space-y-2 text-xs">
              {e.wins.map((w) => (
                <li key={w.what} className="flex items-start gap-2">
                  <Star className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                  <span><span className="text-muted-foreground">{w.date} · </span>{w.what}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Flags · what's costing time" icon={AlertTriangle}>
          {e.flags.length === 0 ? (
            <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-success" /> No active flags
            </p>
          ) : (
            <ul className="space-y-2 text-xs">
              {e.flags.map((f) => (
                <li key={f.text} className="flex items-start gap-2">
                  <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                    f.tone === "destructive" && "bg-destructive",
                    f.tone === "warning" && "bg-warning",
                    f.tone === "success" && "bg-success",
                  )} />
                  <span>{f.text}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {/* Gamification CTA strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-hairline bg-gradient-to-r from-warning/5 to-accent/5 p-4">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-warning/15 text-warning">
            <Trophy className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold">Super Tony · monthly bonus pool</div>
            <p className="text-[11px] text-muted-foreground">
              Data-driven, rotating, peer-validated. £200 pool — pays itself back in chases avoided.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="rounded-md border border-hairline bg-white px-3 py-1.5 text-xs hover:bg-surface-alt">Send to #engineer-wins</button>
          <button className="rounded-md bg-foreground px-3 py-1.5 text-xs text-background">Nominate for Super Tony</button>
        </div>
      </div>
    </div>
  );
}

/* ──────────── PAGE ──────────── */
export function EngineersView() {
  const [open, setOpen] = useState<Engineer | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"rank" | "data" | "chases" | "morale">("rank");

  const filtered = ENGINEERS.filter((e) =>
    !q || [e.name, e.role, e.region].some((s) => s.toLowerCase().includes(q.toLowerCase())),
  ).sort((a, b) => {
    if (sort === "rank")    return a.rank - b.rank;
    if (sort === "data")    return b.dataInput - a.dataInput;
    if (sort === "chases")  return b.chasesThisWeek - a.chasesThisWeek;
    if (sort === "morale")  return a.morale - b.morale; // surface lowest first
    return 0;
  });

  // Team-level stats
  const avg = (key: keyof Engineer) => Math.round(
    ENGINEERS.reduce((s, e) => s + (typeof e[key] === "number" ? (e[key] as number) : 0), 0) / ENGINEERS.length,
  );
  const totalChases = ENGINEERS.reduce((s, e) => s + e.chasesThisWeek, 0);
  const expiringCerts = ENGINEERS.reduce(
    (s, e) => s + e.certs.filter((c) => c.status !== "valid").length, 0,
  );

  return (
    <div className="space-y-5">
      {/* Hero */}
      <div className="rounded-2xl border border-hairline bg-gradient-to-br from-white to-surface-alt p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-foreground text-background">
                <HardHat className="h-3 w-3" />
              </span>
              Engineers · the field
            </div>
            <h2 className="text-display mt-3 text-2xl font-semibold tracking-tight">
              The data engineers produce is the company's biggest blind spot. This is where we light it up.
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              One card per engineer · job-sheet quality, first-time-fix, callback latency, customer tone, certifications,
              morale and recognition — all on the same surface. Super Tony ranks shift live so the bonus pool is data-driven, not gut-feel.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { l: "Team Super Tony",  v: avg("superTed"),     tone: scoreText(avg("superTed")) },
              { l: "Avg data input",  v: avg("dataInput"),    tone: scoreText(avg("dataInput")) },
              { l: "Chases this wk",  v: totalChases,         tone: totalChases <= 8 ? "text-success" : totalChases <= 20 ? "text-warning" : "text-destructive" },
              { l: "Certs expiring",  v: expiringCerts,       tone: expiringCerts === 0 ? "text-success" : expiringCerts <= 3 ? "text-warning" : "text-destructive" },
            ].map((s) => (
              <div key={s.l} className="rounded-xl border border-hairline bg-white px-4 py-3 text-center">
                <div className={cn("text-display text-xl font-bold tabular", s.tone)}>{s.v}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Leaderboard strip */}
      <div className="rounded-2xl border border-hairline bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Super Tony · this week</div>
            <div className="text-display mt-1 text-sm font-semibold">Live leaderboard · rotating monthly bonus</div>
          </div>
          <div className="text-[11px] text-muted-foreground">Weighted: data input 35% · first-time fix 25% · chases (inv) 20% · customer tone 20%</div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {ENGINEERS.slice().sort((a, b) => a.rank - b.rank).slice(0, 3).map((e, i) => (
            <button
              key={e.id}
              onClick={() => setOpen(e)}
              className={cn(
                "flex items-center gap-3 rounded-xl border p-3 text-left transition hover:bg-surface-alt",
                i === 0 ? "border-warning/40 bg-warning/5" : "border-hairline",
              )}
            >
              <div className={cn("grid h-10 w-10 place-items-center rounded-full text-xs font-semibold text-white", e.tone)}>{e.initials}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 text-sm font-semibold">
                  {i === 0 && <Trophy className="h-3.5 w-3.5 text-warning" />}
                  {e.name}
                </div>
                <div className="text-[11px] text-muted-foreground">{e.role}</div>
              </div>
              <div className="text-right">
                <div className={cn("text-display text-lg font-bold tabular", scoreText(e.superTed))}>{e.superTed}</div>
                <div className="text-[10px] text-muted-foreground inline-flex items-center justify-end gap-1">
                  <TrendIcon t={e.superTedTrend} /> #{e.rank}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-full border border-hairline bg-white p-1 text-xs">
          {([
            { k: "rank",   l: "Top of board" },
            { k: "data",   l: "Best data input" },
            { k: "chases", l: "Most chased" },
            { k: "morale", l: "Lowest morale" },
          ] as const).map((s) => (
            <button
              key={s.k}
              onClick={() => setSort(s.k)}
              className={cn(
                "rounded-full px-3 py-1.5 font-medium transition",
                sort === s.k ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s.l}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search engineers, regions…"
              className="w-64 rounded-full border border-hairline bg-white py-1.5 pl-9 pr-3 text-sm outline-none focus:border-accent"
            />
          </div>
          <button className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-white px-3 py-1.5 text-xs text-muted-foreground">
            <Filter className="h-3.5 w-3.5" /> Filter
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((e) => <EngineerCard key={e.id} e={e} onOpen={() => setOpen(e)} />)}
      </div>

      {/* Footer note */}
      <div className="rounded-2xl border border-dashed border-hairline bg-white p-4 text-xs text-muted-foreground">
        Built from Heidi, Mary and Larne's discovery: engineer data input is the single biggest blind spot.
        This surface gives every engineer a mirror — and gives Larne, Rudy and Heidi the data to coach,
        recognise and reward without it feeling like surveillance.
      </div>

      {/* Modal */}
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-display">{open?.name}</DialogTitle>
            <DialogDescription>
              Full performance card · weighted Super Tony, data-input quality, comms responsiveness, wellbeing and recognition.
            </DialogDescription>
          </DialogHeader>
          {open && <EngineerDetail e={open} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
