/**
 * Connector Runtime — public entry point. The singleton `connectorRuntime` holds
 * every registered provider; `useConnectorRuntime()` loads the tenant snapshot,
 * resolves all enabled connectors, and rolls them up. Both dashboards consume
 * only this — they never switch on a vendor.
 *
 * Registering a new connector: add a provider file and one `.register(...)` line.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { useModules } from "@/lib/modules/useModules";
import { EMPTY_SNAPSHOT, getOperationsSnapshot, type OperationsSnapshot } from "@/lib/ops-metrics";
import { ConnectorRuntime, toConnectorView, type PlatformRollup } from "./ConnectorRuntime";
import { ConnectorScheduler } from "./ConnectorScheduler";
import { gmailProvider } from "./providers/gmail";
import { googleWorkspaceProvider } from "./providers/googleWorkspace";
import { simwoodProvider } from "./providers/simwood";
import type { ConnectorJob, ConnectorLog, RuntimeConnector } from "./types";

export const connectorRuntime = new ConnectorRuntime()
  .register(googleWorkspaceProvider)
  .register(gmailProvider)
  .register(simwoodProvider);

export const connectorScheduler = new ConnectorScheduler(() => connectorRuntime.all());

export { ConnectorRuntime, toConnectorView };
export type { PlatformRollup };
export * from "./types";

export interface UseConnectorRuntime {
  snapshot: OperationsSnapshot;
  connectors: RuntimeConnector[];
  platform: PlatformRollup;
  logs: ConnectorLog[];
  jobs: ConnectorJob[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useConnectorRuntime(): UseConnectorRuntime {
  const { isEnabled } = useModules();
  const [snapshot, setSnapshot] = useState<OperationsSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await getOperationsSnapshot());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load connector runtime");
      setSnapshot(EMPTY_SNAPSHOT);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const connectors = useMemo(
    () => connectorRuntime.resolveAll(snapshot, isEnabled),
    [snapshot, isEnabled],
  );
  const platform = useMemo(() => connectorRuntime.platform(connectors), [connectors]);
  const logs = useMemo(() => connectorRuntime.aggregateLogs(connectors), [connectors]);
  const jobs = useMemo(() => connectorRuntime.aggregateJobs(connectors), [connectors]);

  return { snapshot, connectors, platform, logs, jobs, loading, error, refresh: load };
}
