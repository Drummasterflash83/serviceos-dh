/**
 * /marketing — the protected Marketing surface (Phase 1 foundation).
 *
 * A real top-level ServiceOS surface sharing the SAME application chrome as /app
 * (see components/app/AppChrome.tsx — extracted, never duplicated). Marketing has
 * exactly three primary sections, in order: Contacts, Campaigns, Ads.
 *
 * Access is enforced twice:
 *   - server-side: the `marketing-access` Edge Function resolves the caller's
 *     permissions from role defaults + per-user grants (and RLS scopes every
 *     read); a user without `marketing.view` receives can_view=false and no data.
 *   - client-side: this route renders an honest "Requires permission" state and
 *     the /app sidebar hides the Marketing item.
 *
 * Reality states are honest: the Phase-1 backend is the access/config/lifecycle
 * foundation, so Contacts/Campaigns show what IS real (tenant config, lifecycle
 * stages, permissions) and label everything else Preview. Ads is Not connected —
 * no ad provider adapter exists yet. Nothing fakes production data.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  Contact,
  Megaphone,
  Radio,
  AlertTriangle,
  ShieldAlert,
  Users,
  Send,
  Tag,
  ListFilter,
  Upload,
  BarChart3,
  Plug,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { RequireAuth } from "@/lib/auth";
import { AppChrome } from "@/components/app/AppChrome";
import { MarketingCampaigns } from "@/components/app/MarketingCampaigns";
import { MarketingContacts } from "@/components/app/MarketingContacts";
import { MarketingSegments } from "@/components/app/MarketingSegments";
import { MarketingTags } from "@/components/app/MarketingTags";
import { MarketingImports } from "@/components/app/MarketingImports";
import { MarketingSettings } from "@/components/app/MarketingSettings";
import { MarketingAds } from "@/components/app/MarketingAds";
import { useMarketingAccess } from "@/lib/marketing/useMarketingAccess";
import { deriveMarketingGate } from "@/lib/marketing/gate";
import { Settings as SettingsIcon } from "lucide-react";

export const Route = createFileRoute("/marketing")({
  head: () => ({
    meta: [{ title: "Marketing · ServiceOS" }],
  }),
  component: ProtectedMarketing,
});

function ProtectedMarketing() {
  return (
    <RequireAuth>
      <MarketingShell />
    </RequireAuth>
  );
}

/* ── Section model — exactly three primary sections, in this order. ── */
type SectionKey = "contacts" | "campaigns" | "ads";

const SECTIONS: { key: SectionKey; label: string; icon: typeof Contact }[] = [
  { key: "contacts", label: "Contacts", icon: Contact },
  { key: "campaigns", label: "Campaigns", icon: Megaphone },
  { key: "ads", label: "Ads", icon: Radio },
];

/** Honest reality pill — mirrors the capability-registry tenant vocabulary. */
function RealityPill({
  state,
}: {
  state: "Live" | "Read only" | "Preview" | "Not connected" | "Requires permission";
}) {
  const toneClass =
    state === "Live"
      ? "border-success/30 bg-success/10 text-success"
      : state === "Read only"
        ? "border-accent/30 bg-accent/10 text-accent"
        : state === "Not connected"
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-warning/30 bg-warning/10 text-warning";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        toneClass,
      )}
    >
      {state}
    </span>
  );
}

function SectionCard({
  icon: Icon,
  title,
  state,
  children,
}: {
  icon: typeof Contact;
  title: string;
  state: "Live" | "Read only" | "Preview" | "Not connected" | "Requires permission";
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-hairline bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Icon className="h-4 w-4 text-muted-foreground" /> {title}
        </div>
        <RealityPill state={state} />
      </div>
      <div className="mt-2 text-xs text-muted-foreground">{children}</div>
    </div>
  );
}

function MarketingShell() {
  const [section, setSection] = useState<SectionKey>("contacts");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { access, loading, error, canView, refresh } = useMarketingAccess();
  const navigate = useNavigate();
  const gate = deriveMarketingGate(loading, error, access);
  const canAdmin = access?.permissions?.includes("marketing.access.manage") ?? false;

  const title = settingsOpen
    ? "Settings"
    : (SECTIONS.find((s) => s.key === section)?.label ?? "Marketing");

  return (
    <AppChrome
      title={`Marketing · ${title}`}
      nav={({ closeNav }) => (
        <>
          {/* Back to the operating system */}
          <button
            onClick={() => {
              closeNav();
              navigate({ to: "/app" });
            }}
            className="mb-4 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-surface-alt hover:text-foreground"
          >
            <Users className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">← ServiceOS</span>
          </button>
          <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Marketing
          </div>
          {SECTIONS.map((item) => (
            <button
              key={item.key}
              onClick={() => {
                setSection(item.key);
                setSettingsOpen(false);
                closeNav();
              }}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
                section === item.key && !settingsOpen
                  ? "bg-foreground font-medium text-background"
                  : "font-medium text-muted-foreground hover:bg-surface-alt hover:text-foreground",
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span className="flex-1 text-left">{item.label}</span>
            </button>
          ))}
          {/* Settings is a clearly-labelled control, NOT a fourth primary section */}
          {canAdmin && (
            <button
              onClick={() => {
                setSettingsOpen(true);
                closeNav();
              }}
              className={cn(
                "mt-4 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
                settingsOpen
                  ? "bg-foreground font-medium text-background"
                  : "font-medium text-muted-foreground hover:bg-surface-alt hover:text-foreground",
              )}
            >
              <SettingsIcon className="h-4 w-4 shrink-0" />
              <span className="flex-1 text-left">Marketing settings</span>
            </button>
          )}
        </>
      )}
    >
      {loading && (
        <div className="grid min-h-[40vh] place-items-center">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="h-2 w-2 animate-pulse rounded-full bg-foreground" />
            Checking your Marketing access…
          </div>
        </div>
      )}

      {!loading && error && (
        <div className="mx-auto max-w-lg rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <AlertTriangle className="h-4 w-4 text-destructive" /> Marketing is unavailable
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {error}. If this persists ask an administrator to check the marketing-access function
            deployment.
          </p>
          <button
            onClick={refresh}
            className="mt-3 rounded-lg border border-hairline bg-white px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-surface-alt"
          >
            Try again
          </button>
        </div>
      )}

      {/* Only claim "Requires permission" once the server has actually ANSWERED —
          an unreachable access check is an error, never a permission verdict.
          Marketing DISABLED + authenticated owner/admin role → the governed
          recovery path (the server explicitly permits owner/admin
          administration while disabled; hiding it would make disabling the
          module an unrecoverable UI lockout). */}
      {gate.kind === "disabled_admin" && !settingsOpen && (
        <div className="grid min-h-[50vh] place-items-center">
          <div className="max-w-sm text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-surface-alt">
              <ShieldAlert className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="text-display mt-4 text-xl font-semibold">Marketing is disabled</div>
            <p className="mt-1 text-sm text-muted-foreground">
              Marketing is switched off for this workspace. As an owner/admin you can re-enable it
              from Marketing settings — the change is versioned and audited.
            </p>
            <button
              onClick={() => setSettingsOpen(true)}
              className="mt-3 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
            >
              Open settings to re-enable
            </button>
          </div>
        </div>
      )}
      {gate.kind === "disabled_admin" && settingsOpen && (
        <MarketingSettings
          onBack={() => {
            setSettingsOpen(false);
            refresh();
          }}
        />
      )}

      {(gate.kind === "disabled" || gate.kind === "denied") && (
        <div className="grid min-h-[50vh] place-items-center">
          <div className="max-w-sm text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-surface-alt">
              <ShieldAlert className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="text-display mt-4 text-xl font-semibold">
              {gate.kind === "disabled" ? "Marketing is disabled" : "Requires permission"}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {gate.kind === "disabled"
                ? "Marketing is not enabled for this workspace. An owner or admin can re-enable it."
                : "You don't have Marketing access. An owner or admin can grant it in Settings."}
            </p>
          </div>
        </div>
      )}

      {!loading && !error && canView && (
        <>
          {settingsOpen ? (
            <MarketingSettings onBack={() => setSettingsOpen(false)} />
          ) : (
            <>
              {section === "contacts" && <ContactsSection />}
              {section === "campaigns" && <CampaignsSection />}
              {section === "ads" && <AdsSection />}
            </>
          )}
        </>
      )}
    </AppChrome>
  );
}

/* ── Contacts — the Contacts area now carries four coherent tabs:
      Contacts (Phase-2 projection) · Segments · Tags · Imports (Phase 3). ── */
type ContactsTab = "contacts" | "segments" | "tags" | "imports";

function ContactsSection() {
  const { access, can } = useMarketingAccess();
  const settings = access?.settings ?? null;
  const [tab, setTab] = useState<ContactsTab>("contacts");

  const tabs: { key: ContactsTab; label: string; icon: typeof Users; show: boolean }[] = [
    { key: "contacts", label: "Contacts", icon: Users, show: true },
    { key: "segments", label: "Segments", icon: ListFilter, show: true },
    { key: "tags", label: "Tags", icon: Tag, show: can("marketing.tags.manage") },
    { key: "imports", label: "Imports", icon: Upload, show: can("marketing.contacts.import") },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-1 border-b border-hairline pb-2">
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition",
                tab === t.key
                  ? "bg-foreground font-medium text-background"
                  : "font-medium text-muted-foreground hover:bg-surface-alt hover:text-foreground",
              )}
            >
              <t.icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          ))}
      </div>

      {tab === "contacts" && (
        <>
          <MarketingContacts />
          {settings && (
            <div className="rounded-lg border border-hairline bg-surface-alt/50 px-3 py-2 text-xs text-muted-foreground">
              Inclusion:{" "}
              <span className="font-medium text-foreground">
                {settings.include_all_discovered
                  ? "all discovered people"
                  : "classified / eligible people only"}
              </span>{" "}
              · new contacts default to {settings.default_relationship_type} /{" "}
              {settings.default_lifecycle_stage_key} · timezone {settings.timezone}. Configurable in
              Marketing settings.
            </div>
          )}
        </>
      )}
      {tab === "segments" && <MarketingSegments />}
      {tab === "tags" && <MarketingTags />}
      {tab === "imports" && <MarketingImports />}
    </div>
  );
}

/* ── Campaigns — Broadcasts operational (Phase 5); the rest honest Preview. ── */
function CampaignsSection() {
  return <MarketingCampaigns />;
}

/* ── Ads — the operational Phase 8 surface: signed-webhook lead capture,
      attribution, honest cost and source health. Meta/Google/LinkedIn stay
      truthfully Not connected inside it until real adapters exist. ── */
function AdsSection() {
  // affordance gating only — the server enforces every permission again. Mirror
  // the server's STRUCTURAL ceiling here: management needs the owner/admin role
  // AND marketing.ads.manage, so a stray grant to ops/viewer never surfaces
  // buttons that would only 403 (the boundary holds server-side either way).
  const { access, can } = useMarketingAccess();
  const isOwnerAdmin = access?.role === "owner" || access?.role === "admin";
  return <MarketingAds canManage={Boolean(isOwnerAdmin) && can("marketing.ads.manage")} />;
}
