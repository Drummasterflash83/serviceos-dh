// ServiceOS — Email connector health derivation (pure, Deno, unit-tested).
//
// The ONE place the explicit email connector-state enum is decided. It takes raw
// EVIDENCE (from the email_connector_health RPC) and returns the derived state, so
// there is exactly one place for the numbers (SQL) and one for the logic (here) —
// no conflicting health computation scattered across frontend components.
//
// Golden rule: a later success ALWAYS resolves an earlier failure. "Current
// failure" is expressed as (last_failure newer than last_success), never a latched
// flag. Pure + deterministic (now is injected) → directly unit-testable.

export type ConnectorState =
  | "needs_setup"
  | "connected_healthy"
  | "connected_stale"
  | "connected_failing"
  | "auth_expired"
  | "delegation_failed"
  | "no_mailboxes"
  | "backfill_running"
  | "backfill_failed"
  | "disabled"
  | "unknown";

export interface DerivedState {
  state: ConnectorState;
  reason: string;
  /** A genuinely unresolved current failure (not resolved by a later success). */
  currentFailure: boolean;
  /** Backfill dimension — reported separately so it never worsens live health. */
  backfill: "idle" | "running" | "failed";
  /** Gmail only: a genuine reconnect is required right now. */
  needsReconnect: boolean;
  /** Workspace only: delegation is genuinely failing right now. */
  needsDelegationRetest: boolean;
}

export interface GmailEvidence {
  configured: boolean;
  accounts_total: number;
  accounts_active: number;
  accounts_disabled: number;
  accounts_auth_ok: number;
  accounts_auth_failing: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_useful_at: string | null;
  last_failure_message: string | null;
}

export interface WorkspaceEvidence {
  configured: boolean;
  connection_status: string | null;
  connection_error: string | null;
  connection_last_verified_at: string | null;
  mailboxes_total: number;
  mailboxes_enabled: number;
  mailboxes_disabled: number;
  mailboxes_removed: number;
  delegation_last_ok_at: string | null;
  delegation_last_fail_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_useful_at: string | null;
  last_failure_message: string | null;
  discovery_last_success_at: string | null;
  discovery_last_failure_at: string | null;
  backfill_running: number;
  backfill_errored: number;
}

// Live sync cadence is every 5 min; call it stale after 3 missed ticks.
export const LIVE_STALE_MS = 15 * 60 * 1000;

function ms(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** Is `failISO` a CURRENT failure — i.e. not resolved by a later `successISO`? */
export function isCurrentFailure(failISO: string | null, successISO: string | null): boolean {
  const f = ms(failISO);
  if (f === null) return false;
  const s = ms(successISO);
  return s === null || f > s;
}

/** Gmail (per-tenant OAuth) state from evidence. `nowMs` injected for testability. */
export function deriveGmailState(e: GmailEvidence, nowMs: number): DerivedState {
  const base = {
    backfill: "idle" as const,
    needsReconnect: false,
    needsDelegationRetest: false,
  };
  if (!e.configured || e.accounts_total === 0) {
    return {
      state: "needs_setup",
      reason: "No Gmail account connected",
      currentFailure: false,
      ...base,
    };
  }
  if (e.accounts_disabled === e.accounts_total) {
    return {
      state: "disabled",
      reason: "All Gmail accounts are disabled",
      currentFailure: false,
      ...base,
    };
  }
  // Genuine current auth problem — the ONLY trigger for "Reconnect Gmail".
  if (e.accounts_auth_failing > 0) {
    return {
      state: "auth_expired",
      reason: `${e.accounts_auth_failing} Gmail account(s) need reconnection`,
      currentFailure: true,
      ...base,
      needsReconnect: true,
    };
  }
  // A current sync failure (transient/provider) — not an auth problem.
  if (isCurrentFailure(e.last_failure_at, e.last_success_at)) {
    return {
      state: "connected_failing",
      reason: e.last_failure_message ?? "The latest Gmail sync failed",
      currentFailure: true,
      ...base,
    };
  }
  const lastOk = ms(e.last_success_at);
  if (lastOk === null) {
    return {
      state: "connected_stale",
      reason: "Connected — awaiting first sync",
      currentFailure: false,
      ...base,
    };
  }
  if (nowMs - lastOk > LIVE_STALE_MS) {
    return {
      state: "connected_stale",
      reason: "No successful sync in the last 15 minutes",
      currentFailure: false,
      ...base,
    };
  }
  return { state: "connected_healthy", reason: "Syncing normally", currentFailure: false, ...base };
}

/** Google Workspace (DWD) state from evidence. `nowMs` injected for testability. */
export function deriveWorkspaceState(e: WorkspaceEvidence, nowMs: number): DerivedState {
  const backfill: DerivedState["backfill"] =
    e.backfill_running > 0 ? "running" : e.backfill_errored > 0 ? "failed" : "idle";
  const base = { backfill, needsReconnect: false };

  if (!e.configured) {
    return {
      state: "needs_setup",
      reason: "Workspace delegation not configured",
      currentFailure: false,
      ...base,
      needsDelegationRetest: false,
    };
  }
  if (e.connection_status === "disabled") {
    return {
      state: "disabled",
      reason: "Workspace connector disabled",
      currentFailure: false,
      ...base,
      needsDelegationRetest: false,
    };
  }
  // Delegation is CURRENTLY failing only if the latest delegation failure is newer
  // than the latest successful delegated operation (sync/discover/test all prove
  // delegation). A latched connection_status='error' that a later success has
  // superseded is NOT current — this is the fix for the recurring "Re-test
  // delegation" prompt. A never-proved connection in 'error' is current.
  const delegationCurrentlyFailing =
    isCurrentFailure(e.delegation_last_fail_at, e.delegation_last_ok_at) ||
    (e.connection_status === "error" && e.delegation_last_ok_at === null);
  if (delegationCurrentlyFailing) {
    return {
      state: "delegation_failed",
      reason: e.connection_error ?? "Domain-wide delegation is failing",
      currentFailure: true,
      ...base,
      needsDelegationRetest: true,
    };
  }
  if (e.mailboxes_enabled === 0) {
    return {
      state: "no_mailboxes",
      reason: "Delegation healthy — no mailboxes enabled yet",
      currentFailure: false,
      ...base,
      needsDelegationRetest: false,
    };
  }
  // Current live-sync failure (never worsened by backfill — §7).
  if (isCurrentFailure(e.last_failure_at, e.last_success_at)) {
    return {
      state: "connected_failing",
      reason: e.last_failure_message ?? "The latest Workspace sync failed",
      currentFailure: true,
      ...base,
      needsDelegationRetest: false,
    };
  }
  const lastOk = ms(e.last_success_at);
  const nd = { needsDelegationRetest: false };
  if (lastOk === null) {
    // Delegation proven and mailboxes enabled, but no message sync yet.
    if (backfill === "running") {
      return {
        state: "backfill_running",
        reason: "Historical backfill in progress",
        currentFailure: false,
        ...base,
        ...nd,
      };
    }
    return {
      state: "connected_stale",
      reason: "Connected — awaiting first sync",
      currentFailure: false,
      ...base,
      ...nd,
    };
  }
  if (nowMs - lastOk > LIVE_STALE_MS) {
    return {
      state: "connected_stale",
      reason: "No successful sync in the last 15 minutes",
      currentFailure: false,
      ...base,
      ...nd,
    };
  }
  // Healthy live sync — surface backfill as the state only when it's actively
  // running (informational); a past backfill error never shows as current here.
  if (backfill === "running") {
    return {
      state: "backfill_running",
      reason: "Live sync healthy · historical backfill running",
      currentFailure: false,
      ...base,
      ...nd,
    };
  }
  return {
    state: "connected_healthy",
    reason: "Syncing normally",
    currentFailure: false,
    ...base,
    ...nd,
  };
}

export interface EmailHealthEvidence {
  gmail: GmailEvidence;
  workspace: WorkspaceEvidence;
  pipeline: Record<string, unknown>;
}

export interface EmailHealth {
  gmail: DerivedState;
  workspace: DerivedState;
  pipeline: Record<string, unknown>;
}

/** Derive both connectors' states from the RPC evidence bundle. */
export function deriveEmailHealth(ev: EmailHealthEvidence, nowMs: number): EmailHealth {
  return {
    gmail: deriveGmailState(ev.gmail, nowMs),
    workspace: deriveWorkspaceState(ev.workspace, nowMs),
    pipeline: ev.pipeline ?? {},
  };
}
