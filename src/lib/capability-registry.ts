/**
 * Capability Registry — the single machine-readable truth about what every visible
 * control in the product actually does. It exists so the frontend can render HONEST
 * states and never imply a control works when it does not (Constitution: "does the
 * business operate *through* this?").
 *
 * This is NOT a customer dashboard. It is a platform-governance mechanism:
 *  - exhaustive for OpenFolk / engineering (the full registry, with raw statuses);
 *  - consumed PROGRAMMATICALLY by the UI to gate/label controls;
 *  - surfaced to normal tenant users only as plain language (Live / Read only /
 *    Preview / Not connected / Requires permission), never raw "LOCAL_ONLY".
 *
 * Versioned in git; bump REGISTRY_VERSION on every change. Derived from the
 * founding-document alignment audit + the frontend capability audit (2026-07-22).
 */

export const REGISTRY_VERSION = "2026-07-29.2";

/** Raw engineering status — the full truth, for OpenFolk/eng only. */
export type CapabilityStatus =
  | "LIVE" // works end-to-end against the backend (read+write persist)
  | "READ_ONLY" // shows real backend data; no write action
  | "LOCAL_ONLY" // state lives only in the browser; nothing is persisted
  | "BROKEN" // wired to a backend but errors
  | "FAKE_DEMO" // hardcoded/demo data or handler-less control
  | "PREVIEW" // deliberate placeholder; backend not built yet
  | "STALE" // shows real data that is not being refreshed
  | "UNREACHABLE" // code exists but is not routed/mounted
  | "MISSING"; // referenced/implied but does not exist

/** Plain-language label shown to a normal tenant user (never the raw status). */
export type TenantLabel =
  | "Live"
  | "Read only"
  | "Preview"
  | "Not connected"
  | "Requires permission"
  | "Hidden"; // not surfaced to tenant users at all

export interface CapabilityEntry {
  /** stable id: `<screen>.<control>` */
  id: string;
  screen: string;
  control: string;
  /** the backend capability/function/table this control depends on, or null */
  backingCapability: string | null;
  read: boolean;
  write: boolean;
  /** does a user action here persist to the backend? */
  persistence: "server" | "none" | "n/a";
  /** minimum role/permission required to use it meaningfully */
  requiredPermission: "any" | "ops" | "admin" | "owner" | "platform_admin";
  status: CapabilityStatus;
  tenantLabel: TenantLabel;
  /** short human explanation (why this status) */
  explanation: string;
  /** true = a real end-to-end write path proven this session */
  proven?: boolean;
}

// Map raw status → the honest plain-language label a tenant user should see.
const DEFAULT_TENANT_LABEL: Record<CapabilityStatus, TenantLabel> = {
  LIVE: "Live",
  READ_ONLY: "Read only",
  LOCAL_ONLY: "Preview", // never expose "local only" — it reads as broken
  BROKEN: "Preview",
  FAKE_DEMO: "Preview",
  PREVIEW: "Preview",
  STALE: "Read only",
  UNREACHABLE: "Hidden",
  MISSING: "Hidden",
};

export function tenantLabelFor(status: CapabilityStatus): TenantLabel {
  return DEFAULT_TENANT_LABEL[status];
}

/**
 * The registry. One row per meaningful visible control across the eight screens
 * (+ global chrome). Statuses are the audited truth as of REGISTRY_VERSION.
 */
export const CAPABILITY_REGISTRY: CapabilityEntry[] = [
  // ── Global chrome ─────────────────────────────────────────────────────────
  { id: "global.search", screen: "Global", control: "Header search", backingCapability: null, read: false, write: false, persistence: "none", requiredPermission: "any", status: "MISSING", tenantLabel: "Hidden", explanation: "Decorative input with no handler; no search backend. Removed from the header until a real search exists." },
  { id: "global.notifications", screen: "Global", control: "Notifications bell", backingCapability: null, read: false, write: false, persistence: "none", requiredPermission: "any", status: "MISSING", tenantLabel: "Hidden", explanation: "Button with no handler and no notifications backend. Removed until real notifications exist." },

  // ── 1. Command Centre ─────────────────────────────────────────────────────
  { id: "command.feed", screen: "Command Centre", control: "Story/attention feed", backingCapability: "command-feed (recommendations, intelligence_objects, automation_intents, outcomes, platform_events)", read: true, write: false, persistence: "n/a", requiredPermission: "any", status: "READ_ONLY", tenantLabel: "Read only", explanation: "Live read, synthesised per-request. Not yet objective/role/ownership-organised (reset target)." },
  { id: "command.callStories", screen: "Command Centre", control: "From your calls (call stories)", backingCapability: "phone_ai_insights", read: true, write: false, persistence: "n/a", requiredPermission: "any", status: "LIVE", tenantLabel: "Live", explanation: "Live read; each story deep-links to its real call detail.", proven: true },
  { id: "command.approve", screen: "Command Centre", control: "Approve (automation intent)", backingCapability: "intelligence-review-action (approveAutomationIntent)", read: false, write: true, persistence: "server", requiredPermission: "ops", status: "LIVE", tenantLabel: "Live", explanation: "Two-click confirm; persists via Edge Function.", proven: true },
  { id: "command.acknowledge", screen: "Command Centre", control: "Acknowledge", backingCapability: null, read: false, write: true, persistence: "none", requiredPermission: "any", status: "LOCAL_ONLY", tenantLabel: "Preview", explanation: "State lives only in the browser and is lost on refresh. Becomes a real work-item transition in the Command Centre rebuild." },
  { id: "command.edit", screen: "Command Centre", control: "Edit recommendation", backingCapability: null, read: false, write: true, persistence: "none", requiredPermission: "ops", status: "LOCAL_ONLY", tenantLabel: "Preview", explanation: "Edits are not persisted ('edits stay local … next milestone'). Real refinement lands with work items." },
  { id: "command.dismiss", screen: "Command Centre", control: "Dismiss", backingCapability: null, read: false, write: true, persistence: "none", requiredPermission: "ops", status: "LOCAL_ONLY", tenantLabel: "Preview", explanation: "Dismissal is browser-only and reappears on refresh. Becomes a real work-item state transition." },
  { id: "command.filterTabs", screen: "Command Centre", control: "Filter tabs / reset triage", backingCapability: null, read: true, write: false, persistence: "none", requiredPermission: "any", status: "LOCAL_ONLY", tenantLabel: "Preview", explanation: "View-only client filtering; not persisted per user." },
  { id: "command.compactHealth", screen: "Command Centre", control: "Compact health warning", backingCapability: "system_health_checks", read: true, write: false, persistence: "n/a", requiredPermission: "any", status: "LIVE", tenantLabel: "Live", explanation: "Live read of sensor health; links to Settings → System Health.", proven: true },

  // ── 2. Communications ─────────────────────────────────────────────────────
  { id: "comms.list", screen: "Communications", control: "Phone/Email list", backingCapability: "interactions (listInteractions)", read: true, write: false, persistence: "n/a", requiredPermission: "any", status: "LIVE", tenantLabel: "Live", explanation: "Live RLS read of interactions.", proven: true },
  { id: "comms.callDetail", screen: "Communications", control: "Call detail + corrections + Mark reviewed", backingCapability: "phone-call-detail (call-detail.ts writes)", read: true, write: true, persistence: "server", requiredPermission: "ops", status: "LIVE", tenantLabel: "Live", explanation: "Corrected/raw transcript, correction evidence, and Mark reviewed persist server-side.", proven: true },
  { id: "comms.previewChannels", screen: "Communications", control: "SMS · WhatsApp · Teams · Slack pill", backingCapability: null, read: false, write: false, persistence: "n/a", requiredPermission: "any", status: "PREVIEW", tenantLabel: "Preview", explanation: "Honest placeholder; those connectors are not built." },

  // ── 3. Customers ──────────────────────────────────────────────────────────
  { id: "customers.cards", screen: "Customers", control: "Customer cards (honest states)", backingCapability: "customer_cards (getCustomerCards)", read: true, write: false, persistence: "n/a", requiredPermission: "any", status: "READ_ONLY", tenantLabel: "Read only", explanation: "Live read-only projection; evidence-based honest states; archived/synthetic excluded.", proven: true },
  { id: "customers.detail", screen: "Customers", control: "Card detail dialog", backingCapability: "customer_cards + recommendations", read: true, write: false, persistence: "n/a", requiredPermission: "any", status: "READ_ONLY", tenantLabel: "Read only", explanation: "Read-only projection detail." },

  // ── 4. Operations ─────────────────────────────────────────────────────────
  { id: "operations.recs", screen: "Operations", control: "Recommendations + job/delivery metrics", backingCapability: "recommendations, platform_jobs", read: true, write: false, persistence: "n/a", requiredPermission: "any", status: "READ_ONLY", tenantLabel: "Read only", explanation: "Live read-only; generic shells filtered out to show real work.", proven: true },
  { id: "operations.fieldDelivery", screen: "Operations", control: "Field delivery (jobs/engineers/assets)", backingCapability: "commusoft connector", read: false, write: false, persistence: "n/a", requiredPermission: "any", status: "PREVIEW", tenantLabel: "Not connected", explanation: "Honestly gated on the Commusoft connector, which is not connected." },

  // ── 5. Learning Centre ────────────────────────────────────────────────────
  { id: "learning.all", screen: "Learning Centre", control: "Learning health / sources / timeline / graph", backingCapability: "graph_*, platform_events, intelligence_objects, tenant_connectors", read: true, write: false, persistence: "n/a", requiredPermission: "any", status: "READ_ONLY", tenantLabel: "Read only", explanation: "Live read-only; sources show true Live/Planned status." },

  // ── 6. Agents ─────────────────────────────────────────────────────────────
  { id: "agents.nav", screen: "Agents", control: "Agents screen", backingCapability: "agents (not modelled)", read: false, write: false, persistence: "n/a", requiredPermission: "any", status: "PREVIEW", tenantLabel: "Preview", explanation: "Coming-soon placeholder; Agent objects are not first-class yet (governance model designed in step 2)." },
  { id: "agents.orphanDemo", screen: "Agents", control: "Legacy Agents demo (Reject/Edit/Approve)", backingCapability: null, read: false, write: false, persistence: "none", requiredPermission: "any", status: "UNREACHABLE", tenantLabel: "Hidden", explanation: "Orphaned dead-code demo with handler-less buttons; not routed. Flagged for deletion." },

  // ── 7. Protocol ───────────────────────────────────────────────────────────
  { id: "protocol.all", screen: "Protocol", control: "Rules / modes / thresholds", backingCapability: "operational_modes, policies (not yet surfaced)", read: false, write: false, persistence: "n/a", requiredPermission: "admin", status: "PREVIEW", tenantLabel: "Preview", explanation: "Static explanatory surface; the real versioned parameters are not yet bound to the UI." },

  // ── 8. Settings ───────────────────────────────────────────────────────────
  { id: "settings.systemHealth", screen: "Settings", control: "System Health", backingCapability: "system_health_checks / operations centre", read: true, write: false, persistence: "n/a", requiredPermission: "ops", status: "LIVE", tenantLabel: "Live", explanation: "Real observability surface." },
  { id: "settings.phoneVoip", screen: "Settings", control: "Phone / VoIP onboarding", backingCapability: "telephony.ts (provider onboarding)", read: true, write: true, persistence: "server", requiredPermission: "admin", status: "LIVE", tenantLabel: "Live", explanation: "Real telephony provider onboarding with Vault-backed credentials.", proven: true },
  { id: "settings.buildCards", screen: "Settings", control: "Build cards", backingCapability: "customer-card-sync", read: false, write: true, persistence: "server", requiredPermission: "ops", status: "LIVE", tenantLabel: "Live", explanation: "Triggers a real card projection.", proven: true },
  { id: "settings.membersRoles", screen: "Settings", control: "Members & roles", backingCapability: "profiles / operational ownership", read: false, write: false, persistence: "none", requiredPermission: "admin", status: "MISSING", tenantLabel: "Requires permission", explanation: "Inert label row; no member/role management UI exists. Ownership model is being built (step 2)." },
  { id: "settings.workspace", screen: "Settings", control: "Workspace", backingCapability: null, read: false, write: false, persistence: "none", requiredPermission: "admin", status: "MISSING", tenantLabel: "Preview", explanation: "Inert label row; no workspace settings backend." },
  { id: "settings.integrations", screen: "Settings", control: "Integrations", backingCapability: "tenant_connectors", read: true, write: false, persistence: "none", requiredPermission: "admin", status: "MISSING", tenantLabel: "Preview", explanation: "Inert label row; connector management not built here (registry is read elsewhere)." },
  { id: "settings.billing", screen: "Settings", control: "Billing", backingCapability: null, read: false, write: false, persistence: "none", requiredPermission: "owner", status: "MISSING", tenantLabel: "Preview", explanation: "Inert label row; no billing backend." },

  // ── Marketing (/marketing — Phase 1 foundation; see docs/product/marketing-crm) ──
  // Honest status: schema, RLS and the DB-level permission resolver are proven by SQL
  // tests against a real database, but the marketing-access Edge Function's
  // authenticated HTTP path has NOT executed anywhere (no local edge runtime; deploy
  // gated). Nothing here is marked LIVE or proven until that end-to-end path runs.
  {
    id: "marketing.route",
    screen: "Marketing",
    control: "Protected /marketing surface + nav",
    backingCapability:
      "marketing-access (marketing_settings, marketing_access_grants, marketing_effective_permissions)",
    read: true,
    write: false,
    persistence: "server",
    requiredPermission: "any",
    status: "PREVIEW",
    tenantLabel: "Preview",
    explanation:
      "Route + server access model built; DB-level resolver/RLS proven by SQL tests. Authenticated HTTP path awaits deployment — until then the surface fail-closes.",
  },
  {
    id: "marketing.lifecycle",
    screen: "Marketing",
    control: "Lifecycle pipeline (tenant config)",
    backingCapability: "marketing_lifecycle_stages",
    read: true,
    write: false,
    persistence: "server",
    requiredPermission: "any",
    status: "PREVIEW",
    tenantLabel: "Preview",
    explanation:
      "Tenant lifecycle schema + template materialisation proven at DB level only; reaches users through marketing-access, whose HTTP path is unproven.",
  },
  {
    id: "marketing.contacts",
    screen: "Marketing",
    control: "Contact list (projection)",
    backingCapability: "people + contact_relationships (query fn not built)",
    read: false,
    write: false,
    persistence: "n/a",
    requiredPermission: "any",
    status: "PREVIEW",
    tenantLabel: "Preview",
    explanation:
      "Foundation tables exist (relationships, contact points, preferences, suppression) but the paginated projection lands in Phase 2.",
  },
  {
    id: "marketing.imports",
    screen: "Marketing",
    control: "Contact import",
    backingCapability: "data-import (contact profile not seeded)",
    read: false,
    write: false,
    persistence: "n/a",
    requiredPermission: "ops",
    status: "PREVIEW",
    tenantLabel: "Preview",
    explanation:
      "Reuses the preview-first universal importer; the contact profile + UI arrive in Phase 3.",
  },
  {
    id: "marketing.campaigns",
    screen: "Marketing",
    control: "Broadcasts / Sequences / Templates / Reporting",
    backingCapability: "marketing_campaigns, marketing_segments (delivery not built)",
    read: false,
    write: false,
    persistence: "n/a",
    requiredPermission: "ops",
    status: "PREVIEW",
    tenantLabel: "Preview",
    explanation:
      "Campaign/segment foundations exist; governed delivery via the Automation Engine arrives in Phases 4–5. Nothing sends today.",
  },
  {
    id: "marketing.ads",
    screen: "Marketing",
    control: "Ads sources (Meta / Google / LinkedIn)",
    backingCapability: null,
    read: false,
    write: false,
    persistence: "n/a",
    requiredPermission: "admin",
    status: "PREVIEW",
    tenantLabel: "Not connected",
    explanation:
      "No ad provider adapter or credentials exist. Stays Not connected until a real integration is verified (Phase 8).",
  },

  // ── Strategy / ownership (whole-product gaps the reset addresses) ─────────
  { id: "strategy.objectives", screen: "Strategy", control: "Objectives / North Star view & edit", backingCapability: "objectives (exists, unwired/unseeded)", read: false, write: false, persistence: "none", requiredPermission: "owner", status: "MISSING", tenantLabel: "Preview", explanation: "No production surface reads or edits objectives; only a hardcoded Labs preview. Draft strategy seeded for review in step 2A." },
  { id: "strategy.ownership", screen: "Strategy", control: "Roles & ownership", backingCapability: "ownership_assignments / operational roles", read: false, write: false, persistence: "none", requiredPermission: "admin", status: "MISSING", tenantLabel: "Preview", explanation: "No UI assigns/edits ownership ('Not assigned' everywhere). Operational role/ownership model built in step 2B." },
];

export function getCapability(id: string): CapabilityEntry | undefined {
  return CAPABILITY_REGISTRY.find((e) => e.id === id);
}

/** Count of entries by raw status — for OpenFolk/engineering governance. */
export function capabilityCounts(): Record<CapabilityStatus, number> {
  const counts = {
    LIVE: 0, READ_ONLY: 0, LOCAL_ONLY: 0, BROKEN: 0, FAKE_DEMO: 0,
    PREVIEW: 0, STALE: 0, UNREACHABLE: 0, MISSING: 0,
  } as Record<CapabilityStatus, number>;
  for (const e of CAPABILITY_REGISTRY) counts[e.status] += 1;
  return counts;
}

/** True when a control should render as a working affordance (not a false one). */
export function isOperational(id: string): boolean {
  const e = getCapability(id);
  return !!e && (e.status === "LIVE" || e.status === "READ_ONLY");
}
