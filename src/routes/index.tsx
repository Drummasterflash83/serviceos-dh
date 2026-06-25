import { createFileRoute, Link } from "@tanstack/react-router";
import { motion, useScroll, useTransform } from "motion/react";
import { useRef, useState } from "react";
import {
  Phone, MonitorSmartphone, Mail, Plug, Boxes, Shield, Lock, FileCheck,
  UserCheck, ScrollText, ArrowRight, Sparkles, Activity, CircleDot,
  TrendingDown, AlertTriangle, ChevronRight,
} from "lucide-react";
import { Nav } from "@/components/Nav";
import { SectionShell, Reveal, Eyebrow, CountUp, GlassCard } from "@/components/pitch/primitives";
import { cn } from "@/lib/utils";
import drummondLogo from "@/assets/drummond-heading-black.png.asset.json";
import dhIcon from "@/assets/dh-icon-black.png.asset.json";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ServiceOS · Bespoke Operating System for Drummonds" },
      { name: "description", content: "A bespoke operating system designed around Drummonds' people, systems and workflows. Built from discovery, engineered to operate." },
      { property: "og:title", content: "ServiceOS · Built for Drummonds" },
      { property: "og:description", content: "One intelligence layer above every existing system." },
    ],
  }),
  component: Page,
});

const EASE = [0.22, 1, 0.36, 1] as const;

function Page() {
  return (
    <main className="overflow-x-hidden bg-background text-foreground">
      <Nav />
      <Hero />
      <HiddenProblem />
      <CostOfFriction />
      <WhyAINow />
      <Architecture />
      <CaptureLayer />
      <WorkflowIntelligence />
      <VoiceIntelligence />
      <AgentLayer />
      <CommandCentrePreview />
      <Security />
      <Roadmap />
      <ROI />
      <StrategicFuture />
      <Closing />
      <Footer />
    </main>
  );
}

/* ──────────────── 1. HERO ──────────────── */
function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const scale = useTransform(scrollYProgress, [0, 1], [1, 0.82]);
  const opacity = useTransform(scrollYProgress, [0, 0.8], [1, 0]);
  const y = useTransform(scrollYProgress, [0, 1], [0, -80]);

  return (
    <section ref={ref} className="relative flex min-h-[100svh] items-center justify-center overflow-hidden px-6 pt-28">
      {/* ambient orb */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[700px] w-[700px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_center,#dbeafe_0%,transparent_60%)] blur-2xl" />

      <motion.div style={{ scale, opacity, y }} className="relative z-10 mx-auto max-w-5xl text-center">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: EASE }}
        >
          <div className="flex justify-center">
            <img
              src={drummondLogo.url}
              alt="Drummond Heating - Established 1978"
              className="h-10 w-auto md:h-14"
            />
          </div>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.1, ease: EASE, delay: 0.1 }}
          className="text-display mt-8 flex items-center justify-center gap-[0.05em] text-[18vw] font-extrabold leading-[0.9] md:text-[160px]"
        >
          <img
            src={dhIcon.url}
            alt=""
            aria-hidden
            className="h-[0.72em] w-auto rounded-[0.12em]"
          />
          <span>ServiceOS</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: EASE, delay: 0.35 }}
          className="text-display mt-10 text-3xl font-semibold text-foreground md:text-5xl"
        >
          A bespoke operating system,<br />
          <span className="text-muted-foreground">designed around Drummonds workflow.</span>
        </motion.p>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 0.6 }}
          className="mx-auto mt-8 max-w-xl text-lg text-muted-foreground md:text-xl"
        >
          Built from weeks of discovery inside your operation - your calls, engineers, systems, suppliers and workflows. Engineered to make all of it work as one.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.75, ease: EASE }}
          className="mt-12 flex flex-wrap items-center justify-center gap-3"
        >
          <a href="#problem" className="group inline-flex items-center gap-2 rounded-full bg-foreground px-6 py-3.5 text-sm font-medium text-background transition hover:bg-foreground/85">
            See What We Found
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </a>
          <Link to="/app" className="inline-flex items-center gap-2 rounded-full border border-hairline bg-white px-6 py-3.5 text-sm font-medium text-foreground transition hover:border-foreground/30">
            Preview Your Command Centre
          </Link>
        </motion.div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.5, duration: 1 }}
        className="absolute bottom-10 left-1/2 -translate-x-1/2 text-[11px] uppercase tracking-[0.3em] text-muted-foreground"
      >
        Scroll
      </motion.div>
    </section>
  );
}

/* ──────────────── 2. HIDDEN PROBLEM ──────────────── */
function HiddenProblem() {
  const systems = [
    { label: "Phone Calls", x: "10%", y: "20%" },
    { label: "Commusoft", x: "70%", y: "12%" },
    { label: "QuickBooks", x: "85%", y: "55%" },
    { label: "Slack", x: "20%", y: "70%" },
    { label: "Supplier Portals", x: "55%", y: "78%" },
    { label: "Google Drive", x: "40%", y: "25%" },
    { label: "Spreadsheets", x: "5%", y: "50%" },
    { label: "Engineers", x: "75%", y: "35%" },
    { label: "Email", x: "45%", y: "55%" },
  ];

  return (
    <SectionShell id="problem">
      <div className="grid items-center gap-16 md:grid-cols-12">
        <div className="md:col-span-5">
          <Eyebrow>What Discovery Revealed</Eyebrow>
          <Reveal delay={0.05}>
            <h2 className="text-display mt-6 text-5xl font-bold md:text-6xl">
              Drummonds doesn't have a people problem. It has a systems problem.
            </h2>
          </Reveal>
          <Reveal delay={0.25}>
            <p className="mt-8 text-2xl text-muted-foreground md:text-3xl">
              The expertise is already there. What's missing is one <span className="text-foreground">connected operating layer</span> across it.
            </p>
          </Reveal>
          <Reveal delay={0.4}>
            <p className="mt-8 max-w-md text-base text-muted-foreground">
              Commusoft holds the jobs. QuickBooks holds the money. Calls live on phones. Knowledge lives in heads. Nothing sees the whole picture.
            </p>
          </Reveal>
        </div>

        <div className="relative h-[480px] md:col-span-7">
          {systems.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, scale: 0.6 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7, delay: i * 0.07, ease: EASE }}
              animate={{ y: [0, -8, 0] }}
              style={{ left: s.x, top: s.y, animationDelay: `${i * 0.2}s` }}
              className="absolute rounded-xl border border-hairline bg-white px-4 py-2.5 text-sm font-medium shadow-[var(--shadow-soft)]"
            >
              <motion.div
                animate={{ y: [0, -6, 0] }}
                transition={{ duration: 3 + i * 0.3, repeat: Infinity, ease: "easeInOut" }}
              >
                {s.label}
              </motion.div>
            </motion.div>
          ))}
          {/* fragmented connecting lines */}
          <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-20" aria-hidden>
            <defs>
              <pattern id="dot" x="0" y="0" width="14" height="14" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="1" fill="currentColor" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#dot)" />
          </svg>
        </div>
      </div>
    </SectionShell>
  );
}

/* ──────────────── 3. COST OF FRICTION ──────────────── */
function CostOfFriction() {
  const cards = [
    { label: "Hidden Admin", value: 160, suffix: " hrs/mo", icon: Activity },
    { label: "Missed Follow-Ups", value: 14, suffix: "/wk", icon: AlertTriangle },
    { label: "Quote Delays", value: 0, hardValue: "Daily", icon: TrendingDown },
    { label: "Margin Leakage", value: 0, hardValue: "Invisible", icon: CircleDot },
  ];

  return (
    <SectionShell alt>
      <div className="max-w-3xl">
        <Eyebrow>What It's Costing Drummonds</Eyebrow>
        <Reveal>
          <h2 className="text-display mt-6 text-5xl font-bold md:text-6xl">
            Quiet inefficiencies. Loud impact on margin.
          </h2>
        </Reveal>
      </div>

      <div className="mt-20 grid gap-5 md:grid-cols-4">
        {cards.map((c, i) => (
          <Reveal key={c.label} delay={i * 0.08}>
            <div className="group relative h-full overflow-hidden rounded-2xl border border-hairline bg-white p-7 shadow-[var(--shadow-soft)] transition hover:shadow-[var(--shadow-lift)]">
              <c.icon className="h-5 w-5 text-muted-foreground" />
              <div className="text-display mt-10 text-5xl font-bold tabular">
                {c.hardValue ?? <CountUp to={c.value} suffix={c.suffix} />}
              </div>
              <div className="mt-2 text-sm text-muted-foreground">{c.label}</div>
              <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-accent to-transparent opacity-0 transition group-hover:opacity-100" />
            </div>
          </Reveal>
        ))}
      </div>
    </SectionShell>
  );
}

/* ──────────────── 4. WHY AI / WHY NOW ──────────────── */
function WhyAINow() {
  return (
    <SectionShell>
      <div className="grid items-center gap-16 md:grid-cols-2">
        <div>
          <Eyebrow>Why AI · Why Now</Eyebrow>
          <Reveal>
            <h2 className="text-display mt-6 text-5xl font-bold md:text-7xl">
              AI can now <span className="text-accent">observe work</span>.
            </h2>
          </Reveal>
          <Reveal delay={0.2}>
            <p className="mt-8 text-lg text-muted-foreground md:text-xl">
              For the first time, AI can understand calls, workflows, documents, emails, and operational patterns - together.
            </p>
          </Reveal>
          <Reveal delay={0.35}>
            <ul className="mt-8 space-y-3 text-base text-foreground">
              {["Calls", "Workflows", "Documents", "Emails", "Operational patterns"].map((x) => (
                <li key={x} className="flex items-center gap-3">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                  {x}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>

        <Reveal delay={0.2}>
          <div className="relative aspect-square rounded-3xl border border-hairline bg-gradient-to-br from-white to-surface-alt p-8">
            <div className="absolute inset-0 grid grid-cols-8 gap-1 p-8 opacity-60">
              {Array.from({ length: 64 }).map((_, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0.1, scale: 0.6 }}
                  whileInView={{ opacity: [0.1, 0.7, 0.3], scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 1.6, delay: (i % 8) * 0.05 + Math.floor(i / 8) * 0.05 }}
                  className="rounded-sm bg-accent/30"
                />
              ))}
            </div>
            <div className="relative flex h-full flex-col items-center justify-center">
              <div className="text-display text-sm uppercase tracking-[0.3em] text-muted-foreground">Chaos</div>
              <ArrowRight className="my-4 h-6 w-6 text-accent" />
              <div className="text-display text-sm uppercase tracking-[0.3em] text-foreground">Intelligence</div>
            </div>
          </div>
        </Reveal>
      </div>
    </SectionShell>
  );
}

/* ──────────────── 5. ARCHITECTURE ──────────────── */
function Architecture() {
  const layers = [
    { name: "Your Existing Stack", desc: "Commusoft, QuickBooks, Slack, supplier portals, telephony, email - kept intact, nothing ripped out." },
    { name: "Capture Layer", desc: "Listens across your calls, jobs, documents and APIs without disrupting how engineers and office staff work today." },
    { name: "Intelligence Layer", desc: "Learns the grammar of Drummonds - your service types, customers, suppliers, seasonal patterns and standards." },
    { name: "Agent Layer", desc: "Autonomous workers that triage calls, chase quotes, schedule follow-ups and approve actions under your policy." },
    { name: "Command Centre", desc: "One live surface for Drummonds - operations, calls, finance and risk in a single pane of glass." },
  ];
  const [active, setActive] = useState<number | null>(null);

  return (
    <SectionShell id="architecture" alt>
      <div className="grid gap-16 md:grid-cols-12">
        <div className="md:col-span-5">
          <Eyebrow>The System We're Building You</Eyebrow>
          <Reveal>
            <h2 className="text-display mt-6 text-5xl font-bold md:text-6xl">
              One intelligent layer sitting above everything Drummonds already uses.
            </h2>
          </Reveal>
          <Reveal delay={0.2}>
            <p className="mt-8 text-lg text-muted-foreground">
              We are not replacing your stack. We are giving it a brain - one that listens, learns and orchestrates across every system you already rely on.
            </p>
          </Reveal>
        </div>

        <div className="space-y-3 md:col-span-7">
          {layers.map((l, i) => (
            <Reveal key={l.name} delay={i * 0.08}>
              <button
                onClick={() => setActive(active === i ? null : i)}
                className={cn(
                  "group relative block w-full overflow-hidden rounded-2xl border border-hairline bg-white p-6 text-left transition hover:border-foreground/20 hover:shadow-[var(--shadow-soft)]",
                  active === i && "border-accent/40 shadow-[var(--shadow-lift)]",
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <span className="grid h-8 w-8 place-items-center rounded-md bg-surface-alt text-xs font-mono text-muted-foreground">
                      0{i + 1}
                    </span>
                    <span className="text-display text-2xl font-semibold">{l.name}</span>
                  </div>
                  <ChevronRight className={cn("h-5 w-5 text-muted-foreground transition", active === i && "rotate-90 text-accent")} />
                </div>
                <motion.div
                  initial={false}
                  animate={{ height: active === i ? "auto" : 0, opacity: active === i ? 1 : 0 }}
                  transition={{ duration: 0.4, ease: EASE }}
                  className="overflow-hidden"
                >
                  <p className="pt-4 pl-12 text-base text-muted-foreground">{l.desc}</p>
                </motion.div>
              </button>
            </Reveal>
          ))}
        </div>
      </div>
    </SectionShell>
  );
}

/* ──────────────── 6. CAPTURE LAYER ──────────────── */
function CaptureLayer() {
  const cards = [
    { icon: Phone, name: "Phone Intelligence", desc: "Every inbound and outbound call transcribed, classified and routed." },
    { icon: MonitorSmartphone, name: "Workflow Intelligence", desc: "Observes how work actually happens across desktops and tools." },
    { icon: Mail, name: "Email Intelligence", desc: "Threads understood, intents extracted, replies drafted under approval." },
    { icon: Plug, name: "API Intelligence", desc: "Reads from Commusoft, QuickBooks, suppliers - kept in sync, in real time." },
    { icon: Boxes, name: "Asset Intelligence", desc: "Files, photos, certificates, contracts - searchable, structured, governed." },
  ];

  return (
    <SectionShell>
      <div className="max-w-3xl">
        <Eyebrow>Capture Layer</Eyebrow>
        <Reveal>
          <h2 className="text-display mt-6 text-5xl font-bold md:text-6xl">
            Nothing important should happen invisibly.
          </h2>
        </Reveal>
      </div>

      <div className="mt-20 grid gap-5 md:grid-cols-3 lg:grid-cols-5">
        {cards.map((c, i) => (
          <Reveal key={c.name} delay={i * 0.06}>
            <div className="group relative h-full rounded-2xl border border-hairline bg-white p-6 transition hover:-translate-y-1 hover:shadow-[var(--shadow-lift)]">
              <c.icon className="h-5 w-5 text-accent" />
              <div className="text-display mt-10 text-lg font-semibold">{c.name}</div>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{c.desc}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </SectionShell>
  );
}

/* ──────────────── 7. WORKFLOW INTELLIGENCE ──────────────── */
function WorkflowIntelligence() {
  const steps = ["Commusoft", "Supplier Portal", "PDF", "Spreadsheet", "Quote", "Approval"];

  return (
    <SectionShell alt>
      <div className="grid gap-16 md:grid-cols-12">
        <div className="md:col-span-5">
          <Eyebrow>Workflow Intelligence</Eyebrow>
          <Reveal>
            <h2 className="text-display mt-6 text-5xl font-bold md:text-6xl">
              Learn how work actually happens.
            </h2>
          </Reveal>
          <Reveal delay={0.2}>
            <p className="mt-8 text-lg text-muted-foreground">
              ServiceOS observes real workflows to discover repetitive admin, bottlenecks, manual handoffs, and automation opportunities.
            </p>
          </Reveal>
          <Reveal delay={0.35}>
            <div className="mt-10 inline-flex items-end gap-3 rounded-2xl border border-hairline bg-white px-6 py-5 shadow-[var(--shadow-soft)]">
              <div className="text-display text-6xl font-bold tabular text-accent">
                <CountUp to={74} suffix="%" />
              </div>
              <div className="pb-2 text-sm text-muted-foreground">Potential Automation</div>
            </div>
          </Reveal>
        </div>

        <div className="md:col-span-7">
          <Reveal delay={0.15}>
            <GlassCard className="p-8">
              <div className="mb-5 flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                <span>Observed process · live</span>
                <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" /> recording</span>
              </div>
              <div className="space-y-2">
                {steps.map((s, i) => (
                  <motion.div
                    key={s}
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.6, delay: i * 0.12, ease: EASE }}
                    className="flex items-center gap-4"
                  >
                    <div className="font-mono text-xs text-muted-foreground w-6">{String(i + 1).padStart(2, "0")}</div>
                    <div className="flex-1 rounded-lg border border-hairline bg-white px-4 py-3 text-sm font-medium">{s}</div>
                    {i < steps.length - 1 && <ArrowRight className="h-4 w-4 text-accent shrink-0" />}
                  </motion.div>
                ))}
              </div>
              <div className="mt-6 rounded-lg bg-accent-soft p-4 text-sm">
                <span className="font-semibold text-accent">Insight ·</span>{" "}
                <span className="text-foreground">Steps 2–4 take 22 minutes on average. Automatable to under 90 seconds.</span>
              </div>
            </GlassCard>
          </Reveal>
        </div>
      </div>
    </SectionShell>
  );
}

/* ──────────────── 8. VOICE INTELLIGENCE ──────────────── */
function VoiceIntelligence() {
  const flow = ["Customer Call", "AI Receptionist", "Transcription", "Intent Detection", "Routing", "Summary", "Action"];

  return (
    <SectionShell>
      <div className="grid gap-16 md:grid-cols-12">
        <div className="md:col-span-5">
          <Eyebrow>Voice Intelligence</Eyebrow>
          <Reveal>
            <h2 className="text-display mt-6 text-5xl font-bold md:text-6xl">
              Every call becomes structured intelligence.
            </h2>
          </Reveal>
          <Reveal delay={0.2}>
            <p className="mt-8 text-lg text-muted-foreground">
              From the first ring to the final action - captured, understood and acted upon.
            </p>
          </Reveal>

          <Reveal delay={0.35}>
            <div className="mt-10 flex flex-wrap gap-2">
              {flow.map((f, i) => (
                <span key={f} className="flex items-center gap-2 rounded-full border border-hairline bg-white px-3 py-1.5 text-xs font-medium">
                  <span className="font-mono text-muted-foreground">{i + 1}</span>{f}
                </span>
              ))}
            </div>
          </Reveal>
        </div>

        <div className="md:col-span-7">
          <Reveal delay={0.15}>
            <GlassCard className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-hairline px-6 py-4">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Live transcript</span>
                </div>
                <span className="font-mono text-xs text-muted-foreground">14:22:08</span>
              </div>
              <div className="space-y-4 p-6">
                <Row label="Caller" value="ABC School" />
                <Row label="Urgency" value="High" tone="destructive" />
                <Row label="Sentiment" value="Frustrated" tone="warning" />
                <Row label="Issue" value="No heating across 3 classrooms" />
                <div className="rounded-lg border border-accent/30 bg-accent-soft p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-accent">Recommended action</div>
                  <div className="mt-1 text-base font-medium text-foreground">Escalate immediately - dispatch nearest engineer</div>
                </div>
                <div className="flex gap-2">
                  <button className="flex-1 rounded-lg bg-foreground px-4 py-2.5 text-sm font-medium text-background">Approve & dispatch</button>
                  <button className="rounded-lg border border-hairline px-4 py-2.5 text-sm font-medium">Review</button>
                </div>
              </div>
            </GlassCard>
          </Reveal>
        </div>
      </div>
    </SectionShell>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "destructive" | "warning" }) {
  return (
    <div className="flex items-center justify-between border-b border-hairline pb-3 last:border-0 last:pb-0">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn(
        "text-sm font-semibold",
        tone === "destructive" && "text-destructive",
        tone === "warning" && "text-warning",
      )}>
        {value}
      </span>
    </div>
  );
}

/* ──────────────── 9. AGENT LAYER ──────────────── */
function AgentLayer() {
  const agents = [
    { name: "Reception Agent", task: "Handling 2 inbound calls", confidence: 96, status: "active" },
    { name: "Scheduling Agent", task: "Optimising 11 engineer routes", confidence: 92, status: "active" },
    { name: "Finance Agent", task: "Reconciling 47 invoices", confidence: 88, status: "active" },
    { name: "Procurement Agent", task: "Comparing 3 supplier quotes", confidence: 91, status: "active" },
  ];

  return (
    <SectionShell alt>
      <div className="max-w-3xl">
        <Eyebrow>Agent Layer</Eyebrow>
        <Reveal>
          <h2 className="text-display mt-6 text-5xl font-bold md:text-6xl">
            AI workers inside the business.
          </h2>
        </Reveal>
      </div>

      <div className="mt-20 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        {agents.map((a, i) => (
          <Reveal key={a.name} delay={i * 0.08}>
            <div className="group relative h-full rounded-2xl border border-hairline bg-white p-6 transition hover:-translate-y-1 hover:shadow-[var(--shadow-lift)]">
              <div className="flex items-center justify-between">
                <Sparkles className="h-5 w-5 text-accent" />
                <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-success">
                  <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" /> {a.status}
                </span>
              </div>
              <div className="text-display mt-10 text-lg font-semibold">{a.name}</div>
              <div className="mt-2 text-sm text-muted-foreground">{a.task}</div>
              <div className="mt-6">
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>Confidence</span>
                  <span className="font-mono tabular text-foreground">{a.confidence}%</span>
                </div>
                <div className="mt-1.5 h-1 rounded-full bg-surface-alt">
                  <motion.div
                    initial={{ width: 0 }}
                    whileInView={{ width: `${a.confidence}%` }}
                    viewport={{ once: true }}
                    transition={{ duration: 1.2, delay: i * 0.1, ease: EASE }}
                    className="h-full rounded-full bg-accent"
                  />
                </div>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </SectionShell>
  );
}

/* ──────────────── 10. COMMAND CENTRE ──────────────── */
function CommandCentrePreview() {
  return (
    <SectionShell id="command">
      <div className="max-w-3xl">
        <Eyebrow>Command Centre</Eyebrow>
        <Reveal>
          <h2 className="text-display mt-6 text-5xl font-bold md:text-7xl">
            The whole business, one surface.
          </h2>
        </Reveal>
        <Reveal delay={0.2}>
          <p className="mt-8 text-lg text-muted-foreground">
            Operations, calls, finance, risk - synthesised live. The pulse of your business at a glance.
          </p>
        </Reveal>
      </div>

      <Reveal delay={0.25}>
        <div className="mt-16 overflow-hidden rounded-3xl border border-hairline bg-white shadow-[var(--shadow-lift)]">
          {/* window chrome */}
          <div className="flex items-center justify-between border-b border-hairline bg-surface-alt px-5 py-3">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
            </div>
            <span className="font-mono text-[11px] text-muted-foreground">serviceos.app/command</span>
            <span />
          </div>

          <div className="grid gap-px bg-hairline md:grid-cols-12">
            <div className="bg-white p-6 md:col-span-8">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">ServiceOS Command Centre</div>
                  <div className="text-display mt-1 text-2xl font-semibold">Today · Tuesday</div>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-success">
                  <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" /> Live
                </div>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="Live Jobs" value="42" sub="Active" />
                <Stat label="Calls Waiting" value="8" sub="Pending" tone="warning" />
                <Stat label="Engineers" value="11" sub="Available" />
                <Stat label="Revenue Today" value="£18,400" sub="+12% v wk" tone="accent" />
              </div>

              <div className="mt-6 rounded-xl border border-hairline p-5">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">Complaint Risk</div>
                  <div className="text-xs font-medium text-success">Low</div>
                </div>
                <div className="mt-3 flex gap-1">
                  {Array.from({ length: 24 }).map((_, i) => (
                    <div key={i} className={cn(
                      "h-8 flex-1 rounded-sm",
                      i < 18 ? "bg-success/30" : i < 22 ? "bg-warning/40" : "bg-destructive/40",
                    )} />
                  ))}
                </div>
              </div>
            </div>

            <div className="bg-white p-6 md:col-span-4">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">AI Insights</div>
              <div className="mt-4 space-y-3">
                {[
                  { tone: "warning", text: "Supplier delay affecting 3 jobs" },
                  { tone: "accent", text: "Quote follow-up overdue (×7)" },
                  { tone: "destructive", text: "Complaint risk detected · ABC School" },
                ].map((insight) => (
                  <div key={insight.text} className="rounded-lg border border-hairline p-3">
                    <div className="flex items-start gap-2">
                      <span className={cn(
                        "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                        insight.tone === "warning" && "bg-warning",
                        insight.tone === "accent" && "bg-accent",
                        insight.tone === "destructive" && "bg-destructive",
                      )} />
                      <span className="text-sm leading-snug">{insight.text}</span>
                    </div>
                  </div>
                ))}
              </div>
              <Link to="/app" className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:gap-2 transition-all">
                Open full Command Centre <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </Reveal>
    </SectionShell>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "warning" | "accent" }) {
  return (
    <div className="rounded-xl border border-hairline p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn(
        "text-display mt-2 text-3xl font-bold tabular",
        tone === "accent" && "text-accent",
        tone === "warning" && "text-warning",
      )}>{value}</div>
      {sub && <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

/* ──────────────── 11. SECURITY ──────────────── */
function Security() {
  const items = [
    { icon: Lock, name: "Encryption", desc: "End-to-end, at rest and in transit." },
    { icon: UserCheck, name: "Permissions", desc: "Role-based, least-privilege by default." },
    { icon: ScrollText, name: "Audit Logging", desc: "Every action attributable and reviewable." },
    { icon: FileCheck, name: "Human Approval", desc: "Agents act under policy, not autonomy." },
    { icon: Shield, name: "GDPR", desc: "Data residency and right-to-erasure built in." },
  ];

  return (
    <SectionShell alt>
      <div className="max-w-3xl">
        <Eyebrow>Security</Eyebrow>
        <Reveal>
          <h2 className="text-display mt-6 text-5xl font-bold md:text-6xl">
            Security first. Always.
          </h2>
        </Reveal>
      </div>

      <div className="mt-20 grid gap-5 md:grid-cols-3 lg:grid-cols-5">
        {items.map((i, idx) => (
          <Reveal key={i.name} delay={idx * 0.06}>
            <div className="rounded-2xl border border-hairline bg-white p-6">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-accent-soft">
                <i.icon className="h-5 w-5 text-accent" />
              </div>
              <div className="text-display mt-8 text-lg font-semibold">{i.name}</div>
              <p className="mt-2 text-sm text-muted-foreground">{i.desc}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </SectionShell>
  );
}

/* ──────────────── 12. ROADMAP ──────────────── */
function Roadmap() {
  const phases = [
    { phase: "Phase 0", name: "Security & Foundations" },
    { phase: "Phase 0.5", name: "Operational Learning" },
    { phase: "Phase 1", name: "Capture Layer" },
    { phase: "Phase 2", name: "Automation" },
    { phase: "Phase 3", name: "Predictive Intelligence" },
  ];

  return (
    <SectionShell id="roadmap">
      <div className="max-w-3xl">
        <Eyebrow>Roadmap</Eyebrow>
        <Reveal>
          <h2 className="text-display mt-6 text-5xl font-bold md:text-6xl">
            Phased delivery. Controlled transformation.
          </h2>
        </Reveal>
      </div>

      <div className="mt-20 relative">
        <div className="absolute left-0 right-0 top-6 h-px bg-hairline" />
        <motion.div
          initial={{ scaleX: 0 }}
          whileInView={{ scaleX: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 2, ease: EASE }}
          style={{ transformOrigin: "left" }}
          className="absolute left-0 right-0 top-6 h-px bg-accent"
        />
        <div className="grid grid-cols-2 gap-6 md:grid-cols-5">
          {phases.map((p, i) => (
            <Reveal key={p.phase} delay={i * 0.12}>
              <div>
                <div className="grid h-12 w-12 place-items-center rounded-full border-2 border-accent bg-white">
                  <span className="font-mono text-xs font-bold text-accent">{String(i + 1).padStart(2, "0")}</span>
                </div>
                <div className="mt-6 text-[11px] uppercase tracking-wider text-muted-foreground">{p.phase}</div>
                <div className="text-display mt-2 text-xl font-semibold">{p.name}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </SectionShell>
  );
}

/* ──────────────── 13. ROI ──────────────── */
function ROI() {
  const rows = [
    { label: "Quote Time", before: "35 mins", after: "8 mins" },
    { label: "Missed Follow-Ups", before: "14 / week", after: "1 / week" },
    { label: "Admin Hours", before: "160 / month", after: "40 / month" },
    { label: "Complaint Rate", before: "8.2%", after: "2.1%" },
  ];

  return (
    <SectionShell alt>
      <div className="max-w-3xl">
        <Eyebrow>Outcomes</Eyebrow>
        <Reveal>
          <h2 className="text-display mt-6 text-5xl font-bold md:text-6xl">
            From friction to flow.
          </h2>
        </Reveal>
      </div>

      <Reveal delay={0.2}>
        <div className="mt-16 overflow-hidden rounded-3xl border border-hairline bg-white">
          <div className="grid grid-cols-12 border-b border-hairline px-8 py-5 text-[11px] uppercase tracking-wider text-muted-foreground">
            <div className="col-span-4">Metric</div>
            <div className="col-span-4">Before</div>
            <div className="col-span-4">With ServiceOS</div>
          </div>
          {rows.map((r, i) => (
            <motion.div
              key={r.label}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: i * 0.1, ease: EASE }}
              className="grid grid-cols-12 items-center border-b border-hairline px-8 py-6 last:border-0"
            >
              <div className="col-span-4 text-display text-lg font-semibold">{r.label}</div>
              <div className="col-span-4 font-mono text-base tabular text-muted-foreground line-through decoration-muted-foreground/30">{r.before}</div>
              <div className="col-span-4 text-display text-2xl font-bold tabular text-accent">{r.after}</div>
            </motion.div>
          ))}
        </div>
      </Reveal>
    </SectionShell>
  );
}

/* ──────────────── 14. STRATEGIC FUTURE ──────────────── */
function StrategicFuture() {
  return (
    <SectionShell>
      <div className="grid items-center gap-16 md:grid-cols-12">
        <div className="md:col-span-6">
          <Eyebrow>Built For Drummonds, Not Off The Shelf</Eyebrow>
          <Reveal>
            <h2 className="text-display mt-6 text-5xl font-bold md:text-6xl md:text-7xl">
              Shaped by your operation. Tuned to your standards.
            </h2>
          </Reveal>
          <Reveal delay={0.2}>
            <p className="mt-8 text-lg text-muted-foreground md:text-xl">
              Every workflow, agent, model and screen has been mapped to the way Drummonds actually works - from how calls come in, to how engineers report back, to how invoices clear. This is your operating system, not a template.
            </p>
          </Reveal>
        </div>

        <Reveal delay={0.2} className="md:col-span-6">
          <div className="aspect-[4/3] rounded-3xl border border-hairline bg-gradient-to-br from-white to-surface-alt p-10">
            <svg viewBox="0 0 400 300" className="h-full w-full" aria-hidden>
              {Array.from({ length: 18 }).map((_, r) =>
                Array.from({ length: 24 }).map((_, c) => {
                  const cx = 20 + c * 16;
                  const cy = 20 + r * 14;
                  // rough continent-ish mask
                  const mask =
                    (r > 4 && r < 12 && c > 4 && c < 10) ||
                    (r > 3 && r < 9 && c > 10 && c < 16) ||
                    (r > 8 && r < 15 && c > 14 && c < 21) ||
                    (r > 5 && r < 13 && c > 19 && c < 23);
                  return (
                    <circle
                      key={`${r}-${c}`}
                      cx={cx}
                      cy={cy}
                      r={mask ? 1.6 : 1}
                      className={mask ? "fill-foreground/30" : "fill-foreground/10"}
                    />
                  );
                }),
              )}
              <circle cx={120} cy={110} r={5} className="fill-accent" />
              <circle cx={120} cy={110} r={14} className="fill-accent/20 animate-ping" />
              <text x={140} y={114} className="fill-foreground" fontSize="11" fontFamily="Inter Tight">
                Drummonds · HQ
              </text>
            </svg>
          </div>
        </Reveal>
      </div>
    </SectionShell>
  );
}

/* ──────────────── 15. CLOSING ──────────────── */
function Closing() {
  return (
    <section className="relative flex min-h-[100svh] flex-col items-center justify-center overflow-hidden bg-foreground px-6 py-32 text-background">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(37,99,235,0.25),transparent_60%)]" />

      <div className="relative z-10 mx-auto max-w-5xl text-center">
        <motion.h2
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 1.2, ease: EASE }}
          className="text-display text-5xl font-bold leading-[1.05] md:text-7xl"
        >
          Drummonds already has the expertise.
        </motion.h2>
        <motion.h2
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 1.2, delay: 0.5, ease: EASE }}
          className="text-display mt-8 text-5xl font-bold leading-[1.05] text-background/60 md:text-7xl"
        >
          We're building the system that unlocks it.
        </motion.h2>

        <Reveal delay={0.8} className="mt-16 flex flex-wrap items-center justify-center gap-3">
          <a href="mailto:hello@serviceos.app" className="group inline-flex items-center gap-2 rounded-full bg-background px-8 py-4 text-base font-medium text-foreground transition hover:bg-background/90">
            Approve Build · Phase 1
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </a>
          <a href="mailto:hello@serviceos.app" className="inline-flex items-center gap-2 rounded-full border border-background/20 px-8 py-4 text-base font-medium text-background transition hover:bg-background/10">
            Review Discovery Findings
          </a>
        </Reveal>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-background/10 bg-foreground px-6 py-10 text-background/60">
      <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-3 text-xs md:flex-row">
        <span>© {new Date().getFullYear()} ServiceOS · Built bespoke for Drummonds</span>
        <span className="font-mono">v0.1 · Drummonds Operating System</span>
      </div>
    </footer>
  );
}
