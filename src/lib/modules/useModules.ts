/**
 * useModules — the single seam for "what is this customer allowed to see".
 *
 * Today every `available` module is enabled, so nothing that works today is ever
 * hidden (no regressions). This is exactly where OpenFolk will later inject
 * per-tenant enablement/licensing — because navigation, routes and dashboards
 * already render only what `isEnabled` returns, gating later needs NO UI changes.
 *
 * `planned` modules are returned too (so the UI can render placeholders) but are
 * NOT "enabled" — callers use `isEnabled` to decide operational vs placeholder.
 */

import { useMemo } from "react";

import { MODULES } from "./registry";
import type { ModuleCategory, ModuleDescriptor } from "./types";

export interface ModulesApi {
  /** The full catalogue (available + planned). */
  all: ModuleDescriptor[];
  /** Operational modules enabled for this tenant. */
  enabled: ModuleDescriptor[];
  /** True when a module is enabled/operational for this tenant. */
  isEnabled: (id: string) => boolean;
  /** All modules in a category (for rendering a section, placeholders included). */
  byCategory: (category: ModuleCategory) => ModuleDescriptor[];
  /** Enabled modules in a category. */
  enabledByCategory: (category: ModuleCategory) => ModuleDescriptor[];
}

export function useModules(): ModulesApi {
  return useMemo<ModulesApi>(() => {
    // TODO(openfolk): source enabled ids from per-tenant config once OpenFolk
    // controls deployments. Until then, every built module is enabled.
    const enabledIds = new Set(
      MODULES.filter((m) => m.availability === "available").map((m) => m.id),
    );
    const isEnabled = (id: string) => enabledIds.has(id);

    return {
      all: MODULES,
      enabled: MODULES.filter((m) => isEnabled(m.id)),
      isEnabled,
      byCategory: (category) => MODULES.filter((m) => m.category === category),
      enabledByCategory: (category) =>
        MODULES.filter((m) => m.category === category && isEnabled(m.id)),
    };
  }, []);
}
