/**
 * useMarketingAccess — resolves the signed-in user's Marketing access via the
 * `marketing-access` Edge Function and exposes it to navigation and the
 * /marketing surface.
 *
 * Deliberately a plain effect + module-level cache rather than React Query: this
 * is an ACCESS GATE, and it must always settle to a definite answer (data or
 * error) so the UI can be truthful. React Query's online/offline networkMode
 * semantics can leave a failed check permanently "paused" (pending, no error) in
 * embedded or event-unreliable browser contexts — an unresolvable limbo that
 * would either lie ("Requires permission") or spin forever. A direct fetch has
 * no such states.
 *
 * The client gate is a UX convenience only; the server (RLS + Edge-Function role
 * checks) is the real enforcement.
 */

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/lib/auth";
import { fetchMarketingAccess, type MarketingAccess } from "./access";
import type { MarketingPermission } from "./permissions";

export interface UseMarketingAccess {
  access: MarketingAccess | null;
  /** True until the server has ANSWERED (data or error) for this user. */
  loading: boolean;
  error: string | null;
  /** True ONLY when the server resolved access AND granted marketing.view. */
  canView: boolean;
  /** Permission check against the server-resolved set. */
  can: (permission: MarketingPermission) => boolean;
  /** Re-run the access check (e.g. a Retry button on the error state). */
  refresh: () => void;
}

/** Module-level cache + shared in-flight promise so every subscriber (nav link,
 *  surface, sections) shares ONE answer per user — and effect re-runs/remounts
 *  simply re-await the same promise instead of racing or dropping the result. */
let cachedForUser: string | null = null;
let cachedAccess: MarketingAccess | null = null;
let pending: { userId: string; promise: ReturnType<typeof fetchMarketingAccess> } | null = null;

function loadAccess(userId: string): ReturnType<typeof fetchMarketingAccess> {
  if (pending && pending.userId === userId) return pending.promise;
  const promise = fetchMarketingAccess().finally(() => {
    if (pending?.promise === promise) pending = null;
  });
  pending = { userId, promise };
  return promise;
}

export function useMarketingAccess(): UseMarketingAccess {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [state, setState] = useState<{
    access: MarketingAccess | null;
    error: string | null;
    settled: boolean;
  }>(() =>
    userId && cachedForUser === userId && cachedAccess
      ? { access: cachedAccess, error: null, settled: true }
      : { access: null, error: null, settled: false },
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!userId) {
      setState({ access: null, error: null, settled: false });
      return;
    }
    if (cachedForUser === userId && cachedAccess) {
      setState({ access: cachedAccess, error: null, settled: true });
      return;
    }
    let cancelled = false;
    loadAccess(userId).then((result) => {
      if (result.ok) {
        cachedForUser = userId;
        cachedAccess = result.data;
      }
      if (cancelled) return;
      if (result.ok) setState({ access: result.data, error: null, settled: true });
      else setState({ access: null, error: result.error.message, settled: true });
    });
    return () => {
      cancelled = true;
    };
  }, [userId, attempt]);

  const refresh = useCallback(() => {
    cachedForUser = null;
    cachedAccess = null;
    setState({ access: null, error: null, settled: false });
    setAttempt((a) => a + 1);
  }, []);

  const access = state.access;
  return {
    access,
    loading: Boolean(userId) && !state.settled,
    error: state.error,
    canView: Boolean(access?.can_view),
    can: (permission) => Boolean(access?.permissions?.includes(permission)),
    refresh,
  };
}
