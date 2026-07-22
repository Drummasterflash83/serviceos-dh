/**
 * useCommandCentre — the live data orchestration for the authenticated Command Centre.
 *
 * Resolves the caller's role-scoped, ranked work list from the real work-projection Edge
 * Function (optionally re-scoped through an active View-As context), persists transitions
 * through work-transition, and manages the Tenant-Superadmin View-As lifecycle. No backend
 * ranking/permission logic is duplicated here — it only orchestrates the server contract.
 */
import { useCallback, useEffect, useState } from "react";
import {
  getWorkProjection,
  transitionWork,
  openViewAs,
  exitViewAs as exitViewAsApi,
  type WorkProjection,
  type WorkItem,
  type WorkVerb,
} from "@/lib/command-work";
import type { ApiError } from "@/lib/types";

export interface ViewAsState {
  contextId: string;
  subjectLabel: string;
  expiresAt: string;
}
export interface CommandCentreState {
  loading: boolean;
  error: ApiError | null;
  projection: WorkProjection | null;
  viewAs: ViewAsState | null;
  refresh: () => Promise<void>;
  /** Persist a transition (blocked while viewing — read-only). Returns error message or null. */
  transition: (
    item: WorkItem,
    verb: WorkVerb,
    opts?: { reason?: string; evidence?: unknown },
  ) => Promise<string | null>;
  enterViewAs: (subjectProfileId: string, subjectLabel: string) => Promise<string | null>;
  exitViewAs: () => Promise<void>;
}

export function useCommandCentre(): CommandCentreState {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [projection, setProjection] = useState<WorkProjection | null>(null);
  const [viewAs, setViewAs] = useState<ViewAsState | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getWorkProjection(viewAs?.contextId);
    if (res.ok) {
      setProjection(res.data);
      setError(null);
    } else {
      setError(res.error);
    }
    setLoading(false);
  }, [viewAs?.contextId]);

  useEffect(() => {
    void load();
  }, [load]);

  const transition = useCallback<CommandCentreState["transition"]>(
    async (item, verb, opts) => {
      if (viewAs) return "Read-only while viewing as another user.";
      const res = await transitionWork({
        objectId: item.id,
        verb,
        reason: opts?.reason,
        evidence: opts?.evidence,
      });
      if (!res.ok) return res.error.message;
      await load();
      return null;
    },
    [viewAs, load],
  );

  const enterViewAs = useCallback(async (subjectProfileId: string, subjectLabel: string) => {
    const res = await openViewAs("user", subjectProfileId);
    if (!res.ok) return res.error.message;
    setViewAs({
      contextId: res.data.context.id,
      subjectLabel,
      expiresAt: res.data.context.expires_at,
    });
    return null;
  }, []);

  const exitViewAs = useCallback(async () => {
    if (viewAs) await exitViewAsApi(viewAs.contextId);
    setViewAs(null);
  }, [viewAs]);

  return { loading, error, projection, viewAs, refresh: load, transition, enterViewAs, exitViewAs };
}
