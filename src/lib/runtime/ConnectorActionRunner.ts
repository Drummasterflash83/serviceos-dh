/**
 * ConnectorActionRunner — turns an Overview card action into a REAL backend call
 * using the existing api/feed helpers. This is the one place that knows which
 * function each connector's Sync/Reconnect maps to (the same declarative-mapping
 * pattern as ConnectorLogs). The dashboard calls `runConnectorAction(...)` and
 * renders the normalised result; it never imports a vendor function directly.
 *
 * Navigation-only actions (Workspace "Sync", every "Settings", "Logs", "Health")
 * are handled in the UI and never reach this runner — they mutate nothing.
 */

import {
  startGmailOAuth,
  syncGmailMessages,
  syncSimwoodCalls,
  testGoogleWorkspaceConnection,
  testSimwoodConnection,
} from "@/lib/api";
import { listEmailAccounts } from "@/lib/email-feed";
import type { ConnectorActionKind } from "./types";

// TODO(integration): source the Simwood customer id from per-tenant integration
// config once provider connections are stored per tenant (mirrors PhoneOperations).
const SIMWOOD_CUSTOMER_ID = "3950";

export interface ActionRunContext {
  tenantId: string;
}

export interface ActionRunResult {
  ok: boolean;
  title: string;
  message: string;
  /** True when the action navigated away (e.g. OAuth redirect) — skip refresh. */
  redirected?: boolean;
}

/** Whether a given action for a connector is executed by this runner (vs. UI nav). */
export function isRunnableAction(connectorId: string, kind: ConnectorActionKind): boolean {
  if (kind === "reconnect") return true;
  if (kind === "sync") return connectorId === "gmail" || connectorId === "simwood";
  return false;
}

async function runGmailSync(): Promise<ActionRunResult> {
  const accountsRes = await listEmailAccounts("gmail");
  if (!accountsRes.ok) {
    return { ok: false, title: "Gmail sync", message: accountsRes.error.message };
  }
  // OAuth accounts only — never the DWD service accounts (active_dwd/pending_*).
  const oauth = accountsRes.data.filter((a) => a.status === "active");
  if (oauth.length === 0) {
    return {
      ok: false,
      title: "Gmail sync",
      message: "No OAuth mailbox connected. Use Reconnect to connect one.",
    };
  }
  let messages = 0;
  let failed = 0;
  let firstError: string | null = null;
  for (const acct of oauth) {
    const res = await syncGmailMessages({ emailAccountId: acct.id });
    if (res.ok) messages += res.data.records_processed;
    else {
      failed += 1;
      firstError = firstError ?? res.error.message;
    }
  }
  const ok = failed === 0;
  return {
    ok,
    title: "Gmail sync",
    message: ok
      ? `Synced ${oauth.length} mailbox(es) · ${messages} messages imported`
      : `${failed} of ${oauth.length} mailbox(es) failed${firstError ? `: ${firstError}` : ""}`,
  };
}

async function runGmailReconnect(): Promise<ActionRunResult> {
  const res = await startGmailOAuth();
  if (res.ok) {
    window.location.href = res.data.auth_url; // leaves the app for Google
    return { ok: true, title: "Gmail", message: "Redirecting to Google…", redirected: true };
  }
  return { ok: false, title: "Gmail reconnect", message: res.error.message };
}

async function runWorkspaceReconnect(): Promise<ActionRunResult> {
  const res = await testGoogleWorkspaceConnection();
  if (res.ok) {
    return {
      ok: true,
      title: "Workspace connection",
      message: `Delegation verified for ${res.data.impersonated} · ${res.data.scopes.length} scope(s)`,
    };
  }
  return {
    ok: false,
    title: "Workspace connection",
    message: `${res.error.code}: ${res.error.message}`,
  };
}

async function runSimwoodSync(ctx: ActionRunContext): Promise<ActionRunResult> {
  if (!ctx.tenantId) {
    return { ok: false, title: "Call sync", message: "No tenant in session." };
  }
  const res = await syncSimwoodCalls({
    tenantId: ctx.tenantId,
    providerCustomerId: SIMWOOD_CUSTOMER_ID,
  });
  if (res.ok) {
    return {
      ok: true,
      title: "Call sync",
      message: `${res.data.records_processed} call(s) imported`,
    };
  }
  return { ok: false, title: "Call sync", message: `${res.error.code}: ${res.error.message}` };
}

async function runSimwoodReconnect(ctx: ActionRunContext): Promise<ActionRunResult> {
  if (!ctx.tenantId) {
    return { ok: false, title: "Simwood connection", message: "No tenant in session." };
  }
  const res = await testSimwoodConnection(ctx.tenantId, SIMWOOD_CUSTOMER_ID);
  if (res.ok) {
    return {
      ok: true,
      title: "Simwood connection",
      message: `Connected · ${res.data.customerCount} account(s) reachable`,
    };
  }
  return {
    ok: false,
    title: "Simwood connection",
    message: `${res.error.code}: ${res.error.message}`,
  };
}

/** Execute a real backend action for a connector; returns a normalised result. */
export async function runConnectorAction(
  connectorId: string,
  kind: ConnectorActionKind,
  ctx: ActionRunContext,
): Promise<ActionRunResult> {
  if (connectorId === "gmail") {
    if (kind === "sync") return runGmailSync();
    if (kind === "reconnect") return runGmailReconnect();
  }
  if (connectorId === "google_workspace") {
    if (kind === "reconnect") return runWorkspaceReconnect();
  }
  if (connectorId === "simwood") {
    if (kind === "sync") return runSimwoodSync(ctx);
    if (kind === "reconnect") return runSimwoodReconnect(ctx);
  }
  return { ok: false, title: "Action", message: `No handler for ${connectorId}:${kind}` };
}
