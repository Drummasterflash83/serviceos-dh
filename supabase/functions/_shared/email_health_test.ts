// ServiceOS — Deno unit tests for email health/classification (pure logic).
// Run: `deno test supabase/functions/_shared/email_health_test.ts`
//
// Covers the §17 reliability guarantees that are pure-logic:
//   * a stale historical failure does not show as current after a later success
//   * a refreshed OAuth token does not trigger reconnect
//   * a successful delegation clears a current delegation failure
//   * a disabled connector is not reported as failed
//   * refresh/delegation error classification (permanent vs transient)

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  deriveGmailState,
  deriveWorkspaceState,
  isCurrentFailure,
  type GmailEvidence,
  type WorkspaceEvidence,
} from "./email_health.ts";
import { classifyRefreshError } from "./gmail_oauth.ts";
import { classifyDelegationError } from "./google_workspace.ts";

const NOW = Date.parse("2026-07-13T12:00:00Z");
const T = (min: number) => new Date(NOW + min * 60_000).toISOString();

function gmail(over: Partial<GmailEvidence> = {}): GmailEvidence {
  return {
    configured: true,
    accounts_total: 1,
    accounts_active: 1,
    accounts_disabled: 0,
    accounts_auth_ok: 1,
    accounts_auth_failing: 0,
    last_success_at: T(-2),
    last_failure_at: null,
    last_useful_at: T(-2),
    last_failure_message: null,
    ...over,
  };
}

function wksp(over: Partial<WorkspaceEvidence> = {}): WorkspaceEvidence {
  return {
    configured: true,
    connection_status: "active",
    connection_error: null,
    connection_last_verified_at: T(-10),
    mailboxes_total: 3,
    mailboxes_enabled: 3,
    mailboxes_disabled: 0,
    mailboxes_removed: 0,
    delegation_last_ok_at: T(-2),
    delegation_last_fail_at: null,
    last_success_at: T(-2),
    last_failure_at: null,
    last_useful_at: T(-2),
    last_failure_message: null,
    discovery_last_success_at: T(-10),
    discovery_last_failure_at: null,
    backfill_running: 0,
    backfill_errored: 0,
    ...over,
  };
}

Deno.test("isCurrentFailure: later success resolves an earlier failure", () => {
  assertEquals(isCurrentFailure(T(-10), T(-2)), false); // fail older than success
  assertEquals(isCurrentFailure(T(-2), T(-10)), true); // fail newer than success
  assertEquals(isCurrentFailure(null, null), false);
  assertEquals(isCurrentFailure(T(-2), null), true); // failure, never a success
});

Deno.test("gmail: healthy when a recent success exists", () => {
  assertEquals(deriveGmailState(gmail(), NOW).state, "connected_healthy");
});

Deno.test("gmail: stale historical failure does NOT show as current after later success", () => {
  const s = deriveGmailState(gmail({ last_failure_at: T(-30), last_success_at: T(-2) }), NOW);
  assertEquals(s.state, "connected_healthy");
  assertEquals(s.currentFailure, false);
});

Deno.test("gmail: a refreshed token (auth_ok) does NOT trigger reconnect", () => {
  // A prior failure that a later success resolved, token healthy → no reconnect.
  const s = deriveGmailState(
    gmail({
      accounts_auth_failing: 0,
      accounts_auth_ok: 1,
      last_failure_at: T(-40),
      last_success_at: T(-1),
    }),
    NOW,
  );
  assertEquals(s.needsReconnect, false);
  assertEquals(s.state, "connected_healthy");
});

Deno.test("gmail: genuine revoked token triggers reconnect (auth_expired)", () => {
  const s = deriveGmailState(gmail({ accounts_auth_failing: 1, accounts_auth_ok: 0 }), NOW);
  assertEquals(s.state, "auth_expired");
  assertEquals(s.needsReconnect, true);
});

Deno.test("gmail: all-disabled connector is NOT reported as failed", () => {
  const s = deriveGmailState(
    gmail({ accounts_active: 0, accounts_disabled: 1, accounts_auth_ok: 0 }),
    NOW,
  );
  assertEquals(s.state, "disabled");
  assertEquals(s.currentFailure, false);
});

Deno.test("gmail: not configured → needs_setup", () => {
  assertEquals(
    deriveGmailState(gmail({ configured: false, accounts_total: 0 }), NOW).state,
    "needs_setup",
  );
});

Deno.test("workspace: successful delegation clears a prior delegation failure", () => {
  // Latched connection_status='error', but a LATER successful delegated op ran.
  const s = deriveWorkspaceState(
    wksp({
      connection_status: "error",
      connection_error: "admin_delegation_missing",
      delegation_last_fail_at: T(-30),
      delegation_last_ok_at: T(-2),
    }),
    NOW,
  );
  assertEquals(s.state, "connected_healthy");
  assertEquals(s.needsDelegationRetest, false);
});

Deno.test("workspace: current delegation failure (never proved) → delegation_failed", () => {
  const s = deriveWorkspaceState(
    wksp({
      connection_status: "error",
      connection_error: "admin_delegation_missing",
      delegation_last_ok_at: null,
      delegation_last_fail_at: T(-2),
    }),
    NOW,
  );
  assertEquals(s.state, "delegation_failed");
  assertEquals(s.needsDelegationRetest, true);
});

Deno.test("workspace: backfill failure does NOT mark live sync unhealthy (§7)", () => {
  const s = deriveWorkspaceState(wksp({ backfill_errored: 1, last_success_at: T(-1) }), NOW);
  assertEquals(s.state, "connected_healthy");
  assertEquals(s.currentFailure, false);
  assertEquals(s.backfill, "failed");
});

Deno.test("workspace: no enabled mailboxes → no_mailboxes", () => {
  assertEquals(deriveWorkspaceState(wksp({ mailboxes_enabled: 0 }), NOW).state, "no_mailboxes");
});

Deno.test("workspace: disabled connector is not a failure", () => {
  const s = deriveWorkspaceState(wksp({ connection_status: "disabled" }), NOW);
  assertEquals(s.state, "disabled");
  assertEquals(s.currentFailure, false);
});

Deno.test("classifyRefreshError: invalid_grant is permanent (reconnect)", () => {
  assertEquals(classifyRefreshError(400, '{"error":"invalid_grant"}'), {
    code: "refresh_token_revoked",
    permanent: true,
  });
});

Deno.test("classifyRefreshError: 5xx/429 are transient (retry, not reconnect)", () => {
  assertEquals(classifyRefreshError(503, "").permanent, false);
  assertEquals(classifyRefreshError(429, "").permanent, false);
});

Deno.test("classifyDelegationError: distinct permanent codes", () => {
  assertEquals(
    classifyDelegationError("unauthorized_client", 401).code,
    "admin_delegation_missing",
  );
  assertEquals(classifyDelegationError("invalid_scope", 401).code, "scopes_missing");
  assertEquals(classifyDelegationError("invalid_grant", 401).code, "subject_invalid");
  assertEquals(classifyDelegationError("anything", 503), {
    code: "provider_temporary",
    permanent: false,
  });
});
