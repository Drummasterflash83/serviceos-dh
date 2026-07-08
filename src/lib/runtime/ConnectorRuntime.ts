/**
 * ConnectorRuntime — the registry + resolver every connector plugs into. It holds
 * providers, resolves them against the live tenant snapshot into `RuntimeConnector`
 * objects, and rolls those up (platform health, aggregate logs/jobs). The
 * dashboards loop the output; they never switch on a vendor.
 *
 * Adding a connector = `runtime.register(provider)`. Nothing else changes.
 */

import type { ConnectorCategory, ConnectorView } from "@/lib/connectors/types";
import type { OperationsSnapshot } from "@/lib/ops-metrics";
import { isPresent, toBadge, toBucket } from "./ConnectorHealth";
import { toCardMetrics } from "./ConnectorMetrics";
import type { ConnectorJob, ConnectorLog, ConnectorProvider, RuntimeConnector } from "./types";

export interface PlatformRollup {
  connected: number;
  healthy: number;
  warning: number;
  critical: number;
}

export class ConnectorRuntime {
  private readonly providers = new Map<string, ConnectorProvider>();

  register(provider: ConnectorProvider): this {
    this.providers.set(provider.descriptor.id, provider);
    return this;
  }

  all(): ConnectorProvider[] {
    return [...this.providers.values()];
  }

  get(id: string): ConnectorProvider | null {
    return this.providers.get(id) ?? null;
  }

  /** Providers whose module is enabled for this tenant (OpenFolk-aware). */
  enabled(isEnabled: (moduleId: string) => boolean): ConnectorProvider[] {
    return this.all().filter((p) => isEnabled(p.descriptor.moduleId));
  }

  enabledByCategory(
    category: ConnectorCategory,
    isEnabled: (moduleId: string) => boolean,
  ): ConnectorProvider[] {
    return this.enabled(isEnabled).filter((p) => p.descriptor.category === category);
  }

  resolve(provider: ConnectorProvider, snapshot: OperationsSnapshot): RuntimeConnector {
    const status = provider.status(snapshot);
    const metrics = provider.metrics(snapshot);
    return {
      descriptor: provider.descriptor,
      present: isPresent(status),
      status,
      health: provider.health(snapshot),
      metrics,
      cardMetrics: provider.cardMetrics?.(snapshot) ?? toCardMetrics(metrics),
      diagnostics: provider.diagnostics(snapshot),
      jobs: provider.jobs(snapshot),
      logs: provider.logs(snapshot),
      actions: provider.actions(),
      settings: provider.settings(),
    };
  }

  resolveAll(
    snapshot: OperationsSnapshot,
    isEnabled: (moduleId: string) => boolean,
  ): RuntimeConnector[] {
    return this.enabled(isEnabled).map((p) => this.resolve(p, snapshot));
  }

  platform(connectors: RuntimeConnector[]): PlatformRollup {
    const present = connectors.filter((c) => c.present);
    return {
      connected: present.length,
      healthy: present.filter((c) => toBucket(c.status) === "healthy").length,
      warning: present.filter((c) => toBucket(c.status) === "warning").length,
      critical: present.filter((c) => toBucket(c.status) === "critical").length,
    };
  }

  aggregateLogs(connectors: RuntimeConnector[]): ConnectorLog[] {
    return connectors
      .flatMap((c) => c.logs)
      .filter((l) => l.timestamp)
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
      .slice(0, 20);
  }

  aggregateJobs(connectors: RuntimeConnector[]): ConnectorJob[] {
    return connectors.flatMap((c) => c.jobs);
  }
}

/** Map a resolved connector to the reusable ConnectorCard's view shape. */
export function toConnectorView(c: RuntimeConnector): ConnectorView {
  const badge = toBadge(c.status);
  return {
    descriptor: c.descriptor,
    state: {
      status: badge.status,
      health: badge.health,
      version: c.descriptor.version,
      metrics: c.cardMetrics,
      lastSyncAt: c.metrics.lastSync,
      errors: c.metrics.errors24h,
    },
  };
}
