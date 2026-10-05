/**
 * ConnectorScheduler — declarative view of each connector's automatic sync
 * cadence. The real scheduling is server-side (pg_cron per connector); this is
 * the framework surface the runtime/UI reads so no connector hardcodes cadence.
 */

import type { ConnectorProvider } from "./types";

export interface ScheduledSync {
  connector: string;
  cadence: string;
  enabled: boolean;
}

export class ConnectorScheduler {
  constructor(private readonly providers: () => ConnectorProvider[]) {}

  /** Connectors with automatic sync run every 5 minutes today (server cron). */
  schedules(): ScheduledSync[] {
    return this.providers().map((p) => ({
      connector: p.descriptor.id,
      cadence: p.descriptor.capabilities.supportsManualSync ? "every 5 minutes" : "manual only",
      enabled: p.descriptor.capabilities.supportsManualSync,
    }));
  }

  cadenceFor(connectorId: string): string | null {
    return this.schedules().find((s) => s.connector === connectorId)?.cadence ?? null;
  }
}
