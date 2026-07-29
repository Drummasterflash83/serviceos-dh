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
import { MarketingContacts } from "@/components/app/MarketingContacts";
import { useMarketingAccess } from "@/lib/marketing/useMarketingAccess";

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
  const { access, loading, error, canView, refresh } = useMarketingAccess();
  const navigate = useNavigate();

  const title = SECTIONS.find((s) => s.key === section)?.label ?? "Marketing";

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
                closeNav();
              }}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
                section === item.key
                  ? "bg-foreground font-medium text-background"
                  : "font-medium text-muted-foreground hover:bg-surface-alt hover:text-foreground",
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span className="flex-1 text-left">{item.label}</span>
            </button>
          ))}
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
          an unreachable access check is an error, never a permission verdict. */}
      {!loading && !error && access && !canView && (
        <div className="grid min-h-[50vh] place-items-center">
          <div className="max-w-sm text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-surface-alt">
              <ShieldAlert className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="text-display mt-4 text-xl font-semibold">Requires permission</div>
            <p className="mt-1 text-sm text-muted-foreground">
              {access?.reason === "not_enabled"
                ? "Marketing is not enabled for this workspace."
                : "You don't have Marketing access. An owner or admin can grant it in Settings."}
            </p>
          </div>
        </div>
      )}

      {!loading && !error && canView && (
        <>
          {section === "contacts" && <ContactsSection />}
          {section === "campaigns" && <CampaignsSection />}
          {section === "ads" && <AdsSection />}
        </>
      )}
    </AppChrome>
  );
}

/* ── Contacts — the Phase-2 vertical slice: the real server-side projection
      (list/filters/detail/classify/tags) plus the tenant-config note and the
      Phase-3 import preview. ── */
function ContactsSection() {
  const { access, can } = useMarketingAccess();
  const settings = access?.settings ?? null;

  return (
    <div className="space-y-5">
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
          Settings (admin UI arrives in Phase 3).
        </div>
      )}

      {can("marketing.contacts.import") && (
        <SectionCard icon={Upload} title="Import contacts" state="Preview">
          CSV import runs through the platform's preview-first importer (creates, updates, conflicts
          and invalid rows before anything is applied). The contact import profile and UI arrive in
          Phase 3.
        </SectionCard>
      )}
    </div>
  );
}

/* ── Campaigns — foundation only; everything delivery-related is Phase 4–5. ── */
function CampaignsSection() {
  const { can } = useMarketingAccess();
  return (
    <div className="space-y-5">
      <div>
        <div className="text-display text-xl font-semibold">Campaigns</div>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Broadcasts, sequences, templates, reporting and AI drafting — every send governed,
          suppressed-safe and evidence-reported.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <SectionCard icon={Send} title="Broadcasts" state="Preview">
          One-off governed sends with audience preflight, immutable snapshots and per-recipient
          evidence. Arrives in Phase 5, after the Workspace sender is authorised (Phase 4).
        </SectionCard>
        <SectionCard icon={ListFilter} title="Sequences" state="Preview">
          Person-based enrolments with send/wait/action steps, pause/resume and safe exits. Arrives
          in Phase 6.
        </SectionCard>
        <SectionCard icon={Tag} title="Templates" state="Preview">
          Versioned, immutable template revisions with editorial quality checks. Arrives in Phase 7.
        </SectionCard>
        <SectionCard icon={BarChart3} title="Objectives &amp; Reporting" state="Preview">
          Honest, evidence-backed reporting only — an open is not an outcome. Arrives in Phase 7.
        </SectionCard>
      </div>
      {!can("marketing.campaigns.launch") && (
        <div className="rounded-lg border border-hairline bg-surface-alt px-3 py-2 text-xs text-muted-foreground">
          Your role can draft and test campaigns when those arrive, but launching requires the
          launch permission (owner/admin by default).
        </div>
      )}
    </div>
  );
}

/* ── Ads — no provider adapter exists: honestly Not connected. ── */
function AdsSection() {
  return (
    <div className="space-y-5">
      <div>
        <div className="text-display text-xl font-semibold">Ads</div>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Lead capture, attribution, cost-per-lead and source health. Ads does not create or edit
          advertisements.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {["Meta / Facebook / Instagram", "Google Ads", "LinkedIn"].map((provider) => (
          <SectionCard key={provider} icon={Plug} title={provider} state="Not connected">
            No adapter or credentials are configured for this provider. It stays Not connected until
            a real integration is verified end-to-end (Phase 8) — no fabricated data.
          </SectionCard>
        ))}
      </div>
    </div>
  );
}
