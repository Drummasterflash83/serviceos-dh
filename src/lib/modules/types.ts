/**
 * Module system — every ServiceOS capability is a module, never a hardcoded
 * feature. A customer deployment is simply a collection of enabled modules, and
 * OpenFolk will eventually drive enablement/licensing per customer. The UI only
 * ever renders enabled modules, so gating later needs no UI changes.
 */

export type ModuleCategory =
  "communications" | "business" | "documents" | "calendar" | "ai" | "automations";

/** `available` = built + operational today. `planned` = placeholder only. */
export type ModuleAvailability = "available" | "planned";

/** Licence tier that unlocks a module (OpenFolk decides what a customer gets). */
export type ModuleLicense = "starter" | "professional" | "enterprise";

export interface ModuleDescriptor {
  /** Stable id, e.g. "comms.gmail". */
  id: string;
  name: string;
  category: ModuleCategory;
  availability: ModuleAvailability;
  license: ModuleLicense;
  /** Connector this module surfaces, if any (see lib/connectors). */
  connectorId?: string;
  description?: string;
}
