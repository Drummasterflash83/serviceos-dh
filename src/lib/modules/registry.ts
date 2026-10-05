/**
 * Module catalogue. Everything ServiceOS can do — today and planned — is listed
 * here as a module. `available` modules are operational now; `planned` modules
 * render as placeholders so the architecture is visible without being built.
 *
 * Adding a future capability = appending a descriptor. No platform code assumes
 * a module exists; callers check availability/enablement via `useModules()`.
 */

import type { ModuleDescriptor } from "./types";

export const MODULES: ModuleDescriptor[] = [
  // ── Communications ──────────────────────────────────────────────────────
  {
    id: "comms.gmail",
    name: "Gmail",
    category: "communications",
    availability: "available",
    license: "starter",
    connectorId: "gmail",
  },
  {
    id: "comms.google_workspace",
    name: "Google Workspace",
    category: "communications",
    availability: "available",
    license: "professional",
    connectorId: "google_workspace",
  },
  {
    id: "comms.voip",
    name: "Phone / VoIP",
    category: "communications",
    availability: "available",
    license: "starter",
    connectorId: "simwood",
  },
  {
    id: "comms.microsoft365",
    name: "Microsoft 365",
    category: "communications",
    availability: "planned",
    license: "professional",
  },
  {
    id: "comms.outlook",
    name: "Outlook",
    category: "communications",
    availability: "planned",
    license: "professional",
  },
  {
    id: "comms.slack",
    name: "Slack",
    category: "communications",
    availability: "planned",
    license: "professional",
  },
  {
    id: "comms.teams",
    name: "Microsoft Teams",
    category: "communications",
    availability: "planned",
    license: "professional",
  },
  {
    id: "comms.whatsapp",
    name: "WhatsApp",
    category: "communications",
    availability: "planned",
    license: "professional",
  },
  {
    id: "comms.sms",
    name: "SMS",
    category: "communications",
    availability: "planned",
    license: "starter",
  },

  // ── Business systems ────────────────────────────────────────────────────
  {
    id: "business.commusoft",
    name: "Commusoft",
    category: "business",
    availability: "planned",
    license: "professional",
  },
  {
    id: "business.quickbooks",
    name: "QuickBooks",
    category: "business",
    availability: "planned",
    license: "professional",
  },
  {
    id: "business.xero",
    name: "Xero",
    category: "business",
    availability: "planned",
    license: "professional",
  },
  {
    id: "business.hubspot",
    name: "HubSpot",
    category: "business",
    availability: "planned",
    license: "enterprise",
  },
  {
    id: "business.salesforce",
    name: "Salesforce",
    category: "business",
    availability: "planned",
    license: "enterprise",
  },
  {
    id: "business.dynamics",
    name: "Microsoft Dynamics",
    category: "business",
    availability: "planned",
    license: "enterprise",
  },

  // ── Documents ───────────────────────────────────────────────────────────
  {
    id: "documents.google_drive",
    name: "Google Drive",
    category: "documents",
    availability: "planned",
    license: "professional",
  },
  {
    id: "documents.onedrive",
    name: "OneDrive",
    category: "documents",
    availability: "planned",
    license: "professional",
  },
  {
    id: "documents.sharepoint",
    name: "SharePoint",
    category: "documents",
    availability: "planned",
    license: "enterprise",
  },
  {
    id: "documents.dropbox",
    name: "Dropbox",
    category: "documents",
    availability: "planned",
    license: "professional",
  },

  // ── Calendar ────────────────────────────────────────────────────────────
  {
    id: "calendar.google",
    name: "Google Calendar",
    category: "calendar",
    availability: "planned",
    license: "professional",
  },
  {
    id: "calendar.microsoft365",
    name: "Microsoft 365 Calendar",
    category: "calendar",
    availability: "planned",
    license: "professional",
  },
  {
    id: "calendar.outlook",
    name: "Outlook Calendar",
    category: "calendar",
    availability: "planned",
    license: "professional",
  },
  {
    id: "calendar.apple",
    name: "Apple Calendar",
    category: "calendar",
    availability: "planned",
    license: "professional",
  },

  // ── AI ──────────────────────────────────────────────────────────────────
  {
    id: "ai.email",
    name: "Email AI",
    category: "ai",
    availability: "planned",
    license: "professional",
  },
  {
    id: "ai.call",
    name: "Call AI",
    category: "ai",
    availability: "planned",
    license: "professional",
  },
  { id: "ai.job", name: "Job AI", category: "ai", availability: "planned", license: "enterprise" },
  {
    id: "ai.knowledge",
    name: "Knowledge AI",
    category: "ai",
    availability: "planned",
    license: "enterprise",
  },
  {
    id: "ai.voice",
    name: "Voice AI",
    category: "ai",
    availability: "planned",
    license: "enterprise",
  },

  // ── Automations ─────────────────────────────────────────────────────────
  {
    id: "automations.workflows",
    name: "Workflow Engine",
    category: "automations",
    availability: "planned",
    license: "professional",
  },
  {
    id: "automations.scheduled",
    name: "Scheduled Jobs",
    category: "automations",
    availability: "planned",
    license: "professional",
  },
  {
    id: "automations.webhooks",
    name: "Webhooks",
    category: "automations",
    availability: "planned",
    license: "professional",
  },
  {
    id: "automations.api",
    name: "API Automations",
    category: "automations",
    availability: "planned",
    license: "enterprise",
  },
];

export function getModule(id: string): ModuleDescriptor | null {
  return MODULES.find((m) => m.id === id) ?? null;
}
