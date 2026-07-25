/**
 * OpenFolk Control Plane — application shell (sidebar + header + full-width canvas).
 *
 * Gives the operator surface a coherent, modern shell aligned with ServiceOS: a branded,
 * GROUPED sidebar (Operate / Configure / Govern), a header that always shows where you are,
 * which tenant is selected, the tenant's live readiness, and the operator identity — and a
 * full-width canvas. Build/env diagnostics move OUT of page furniture into an About popover.
 *
 * Product hierarchy made explicit: Product = OpenFolk · Context = Control Plane for ServiceOS
 * · Tenant = <the selected tenant>. The tenant is visually separate from the platform identity.
 */
import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  Building2,
  ChevronLeft,
  Fingerprint,
  GraduationCap,
  HeartPulse,
  History,
  Info,
  Lock,
  MessagesSquare,
  Plug,
  ShieldCheck,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BuildBadge } from "@/components/BuildBadge";
import {
  NAV_GROUPS,
  activeNavKey,
  type NavItemKey,
  type WorkspaceSection,
} from "@/lib/openfolk-workspace-nav";
import { StatusPill, type Tone } from "@/components/app/openfolk-ui";
import type { SourceReadiness } from "@/lib/openfolk";

const NAV_ICON: Record<NavItemKey, ReactNode> = {
  overview: <Activity className="h-4 w-4" />,
  learning: <GraduationCap className="h-4 w-4" />,
  connections: <Plug className="h-4 w-4" />,
  directory: <Users className="h-4 w-4" />,
  communications: <MessagesSquare className="h-4 w-4" />,
  company: <Building2 className="h-4 w-4" />,
  health: <HeartPulse className="h-4 w-4" />,
  data_quality: <AlertTriangle className="h-4 w-4" />,
  identity: <Fingerprint className="h-4 w-4" />,
  security: <Lock className="h-4 w-4" />,
  audit: <History className="h-4 w-4" />,
};
const READINESS: Record<string, { label: string; tone: Tone }> = {
  not_ready: { label: "Not ready", tone: "risk" },
  ready_for_evaluation: { label: "Ready for evaluation", tone: "attention" },
  ready_for_chris_shadow: { label: "Ready for Chris-only shadow", tone: "ok" },
  ready_for_staff_pilot: { label: "Ready for staff pilot", tone: "ok" },
};
// Human page title for the active section (covers hidden sections too).
const SECTION_TITLE: Partial<Record<WorkspaceSection, string>> = {
  overview: "Command Centre",
  learning: "Learning",
  connections: "Connections",
  people: "Directory",
  review: "Directory",
  ownership: "Directory",
  communications: "Communications",
  company: "Company",
  health: "Health & Readiness",
  data_quality: "Data Quality",
  identity: "Identity",
  security: "Security",
  audit: "Audit",
  agents: "Agents",
  automations: "Automations",
};

export function OpenfolkShell({
  tenantName,
  section,
  onSectionChange,
  readiness,
  operatorLabel,
  primaryAction,
  children,
}: {
  tenantName: string;
  section: WorkspaceSection;
  onSectionChange: (s: WorkspaceSection) => void;
  readiness: SourceReadiness | null;
  operatorLabel?: string;
  primaryAction?: ReactNode;
  children: ReactNode;
}) {
  const active = activeNavKey(section);
  const r = READINESS[readiness?.level ?? ""] ?? { label: "Unknown", tone: "neutral" as Tone };
  const initials = (operatorLabel ?? "OP")
    .split(/[@\s._-]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");
  const [aboutOpen, setAboutOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-surface-alt/30">
      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-hairline bg-white">
        <div className="border-b border-hairline px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-foreground text-white">
              <ShieldCheck className="h-3.5 w-3.5" />
            </span>
            <div className="leading-tight">
              <div className="text-sm font-semibold text-display">OpenFolk</div>
              <div className="text-[10px] text-muted-foreground">Control Plane for ServiceOS</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {NAV_GROUPS.map((g) => (
            <div key={g.title} className="mb-3">
              <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {g.title}
              </div>
              {g.items.map((item) => {
                const isActive = active === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => onSectionChange(item.section)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium transition-colors",
                      isActive
                        ? "bg-foreground text-white"
                        : "text-muted-foreground hover:bg-surface-alt hover:text-display",
                    )}
                  >
                    <span className={cn(isActive ? "text-white" : "text-muted-foreground")}>
                      {NAV_ICON[item.key]}
                    </span>
                    {item.label}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Tenant identity + live readiness (mirrors ServiceOS "ALL SYSTEMS LIVE · <tenant>") */}
        <div className="border-t border-hairline px-4 py-3">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                {
                  ok: "bg-success",
                  attention: "bg-amber-500",
                  risk: "bg-destructive",
                  neutral: "bg-muted-foreground/40",
                  info: "bg-accent",
                }[r.tone],
              )}
            />
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {r.label}
            </span>
          </div>
          <div className="truncate text-sm font-semibold text-display" title={tenantName}>
            {tenantName}
          </div>
          <Link
            to="/openfolk"
            className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-display"
          >
            <ChevronLeft className="h-3 w-3" /> All tenants
          </Link>
        </div>
      </aside>

      {/* ── Main column ─────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-hairline bg-white/90 px-5 py-2.5 backdrop-blur">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-display">
              {SECTION_TITLE[section] ?? section}
            </div>
            <div className="text-[11px] text-muted-foreground">
              OpenFolk Control Plane · <span className="text-display">{tenantName}</span>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2.5">
            <StatusPill tone={r.tone}>{r.label}</StatusPill>
            {primaryAction}
            {/* About / diagnostics — build+env metadata lives here, not as page furniture. */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setAboutOpen((v) => !v)}
                aria-label="About / diagnostics"
                className="flex h-7 w-7 items-center justify-center rounded-md border border-hairline text-muted-foreground hover:text-display"
              >
                <Info className="h-4 w-4" />
              </button>
              {aboutOpen && (
                <div className="absolute right-0 top-8 z-20 w-72 rounded-lg border border-hairline bg-white p-3 shadow-lg">
                  <div className="mb-1 text-xs font-semibold text-display">About this build</div>
                  <BuildBadge className="mt-0 border-0 pt-0" />
                </div>
              )}
            </div>
            <span
              className="flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-[10px] font-semibold text-white"
              title={operatorLabel ?? "operator"}
            >
              {initials || "OP"}
            </span>
          </div>
        </header>

        {/* Canvas — full width, per-block measures inside */}
        <main className="flex-1 px-5 py-5">{children}</main>
      </div>
    </div>
  );
}
