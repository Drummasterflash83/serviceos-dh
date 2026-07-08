/**
 * OperationsCentre — replaces the former Admin page. A monitoring-first shell
 * with its own sub-navigation; each section is its own focused component (not one
 * giant file). Sections map to module categories so OpenFolk can later drive
 * which appear per customer.
 *
 * The existing Gmail/Workspace/Simwood functionality lives, unchanged, under
 * Communications › Email / Phone.
 */

import { useState } from "react";
import {
  Gauge,
  MessageSquare,
  Briefcase,
  FolderOpen,
  Calendar as CalendarIcon,
  Brain,
  Zap,
  Users as UsersIcon,
  Settings as SettingsIcon,
  Building2,
  FileText,
  Bot,
  ShieldCheck,
  Bell,
  KeyRound,
  Palette,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { OperationsOverview } from "./OperationsOverview";
import { Communications } from "./Communications";
import { ModuleSection } from "./ModuleSection";
import { PlaceholderPanel } from "./PlaceholderPanel";

type SectionKey =
  | "operations"
  | "communications"
  | "business"
  | "documents"
  | "calendar"
  | "ai"
  | "automations"
  | "users"
  | "settings";

const SECTIONS: { key: SectionKey; label: string; icon: LucideIcon }[] = [
  { key: "operations", label: "Operations", icon: Gauge },
  { key: "communications", label: "Communications", icon: MessageSquare },
  { key: "business", label: "Business Systems", icon: Briefcase },
  { key: "documents", label: "Documents", icon: FolderOpen },
  { key: "calendar", label: "Calendar", icon: CalendarIcon },
  { key: "ai", label: "AI", icon: Brain },
  { key: "automations", label: "Automations", icon: Zap },
  { key: "users", label: "Users", icon: UsersIcon },
  { key: "settings", label: "Settings", icon: SettingsIcon },
];

export function OperationsCentre() {
  const [section, setSection] = useState<SectionKey>("operations");

  return (
    <div className="space-y-6">
      {/* Sub-navigation */}
      <div className="-mx-1 flex gap-1 overflow-x-auto pb-1">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSection(s.key)}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition",
              section === s.key
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-surface-alt hover:text-foreground",
            )}
          >
            <s.icon className="h-4 w-4" />
            {s.label}
          </button>
        ))}
      </div>

      {section === "operations" && <OperationsOverview />}
      {section === "communications" && <Communications />}
      {section === "business" && (
        <ModuleSection
          icon={Building2}
          category="business"
          title="Business Systems"
          description="Field-service, accounting and CRM systems. Connect one to unify jobs, customers and invoices."
        />
      )}
      {section === "documents" && (
        <ModuleSection
          icon={FileText}
          category="documents"
          title="Documents"
          description="Document stores for job files, certificates and attachments."
        />
      )}
      {section === "calendar" && (
        <ModuleSection
          icon={CalendarIcon}
          category="calendar"
          title="Calendar"
          description="Scheduling and availability across calendar providers."
        />
      )}
      {section === "ai" && (
        <ModuleSection
          icon={Bot}
          category="ai"
          title="AI"
          description="AI workers for email, calls, jobs and knowledge. Queues, tokens and agent health will surface here."
        />
      )}
      {section === "automations" && (
        <ModuleSection
          icon={Zap}
          category="automations"
          title="Automations"
          description="Workflows, scheduled jobs, webhooks and API automations."
        />
      )}
      {section === "users" && (
        <PlaceholderPanel
          icon={UsersIcon}
          title="Users & permissions"
          description="Roles, departments, teams and per-connector/AI/automation permissions."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { icon: ShieldCheck, label: "Roles & permissions" },
              { icon: UsersIcon, label: "Teams & departments" },
              { icon: KeyRound, label: "Connector access" },
            ].map((x) => (
              <div key={x.label} className="rounded-xl border border-hairline bg-surface-alt p-4">
                <x.icon className="h-4 w-4 text-muted-foreground" />
                <div className="mt-2 text-xs font-medium">{x.label}</div>
              </div>
            ))}
          </div>
        </PlaceholderPanel>
      )}
      {section === "settings" && (
        <PlaceholderPanel
          icon={SettingsIcon}
          title="Settings"
          description="Operational settings kept separate from the live dashboards."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { icon: Palette, label: "Branding & theme" },
              { icon: Building2, label: "Business details" },
              { icon: ShieldCheck, label: "Security" },
              { icon: Bell, label: "Notifications" },
              { icon: KeyRound, label: "API keys" },
              { icon: FileText, label: "Audit log" },
            ].map((x) => (
              <div key={x.label} className="rounded-xl border border-hairline bg-surface-alt p-4">
                <x.icon className="h-4 w-4 text-muted-foreground" />
                <div className="mt-2 text-xs font-medium">{x.label}</div>
              </div>
            ))}
          </div>
        </PlaceholderPanel>
      )}
    </div>
  );
}
