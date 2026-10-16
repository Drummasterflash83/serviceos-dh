import assert from "node:assert/strict";
import test from "node:test";
import {
  isWorkspaceMailboxEligible,
  isWorkspaceRecentCaptureHeld,
} from "./workspace_scheduler_selection.ts";

const account = {
  id: "account-1",
  tenant_id: "tenant-1",
  email_address: "Alias@Example.COM",
};
const mailbox = {
  tenant_id: "tenant-1",
  email_address: "alias@example.com",
  status: "active",
  sync_enabled: true,
  mailbox_type: "alias",
  directory_identity_conflict: false,
};

test("scheduler admits only one currently authorised mailbox", () => {
  assert.equal(isWorkspaceMailboxEligible(account, [mailbox]), true);
  assert.equal(isWorkspaceMailboxEligible(account, [{ ...mailbox, status: "pending" }]), true);
  for (const changed of [
    { status: "removed" },
    { status: "disabled" },
    { sync_enabled: false },
    { mailbox_type: "suspended" },
    { directory_identity_conflict: true },
    { tenant_id: "tenant-2" },
    { email_address: "other@example.com" },
  ]) {
    assert.equal(isWorkspaceMailboxEligible(account, [{ ...mailbox, ...changed }]), false);
  }
  assert.equal(isWorkspaceMailboxEligible(account, [mailbox, { ...mailbox }]), false);
  assert.equal(isWorkspaceMailboxEligible(account, []), false);
});

test("a blocked recent checkpoint is held without excluding another tenant or account", () => {
  const held = { tenant_id: account.tenant_id, email_account_id: account.id,
    state: "blocked", block_code: "persistence_failed" };
  assert.equal(isWorkspaceRecentCaptureHeld(account, [held]), true);
  assert.equal(isWorkspaceRecentCaptureHeld(account, [{ ...held, state: "ready", block_code: null }]), false);
  assert.equal(isWorkspaceRecentCaptureHeld(account, [{ ...held, tenant_id: "tenant-2" }]), false);
  assert.equal(isWorkspaceRecentCaptureHeld(account, [{ ...held, email_account_id: "account-2" }]), false);
  assert.equal(isWorkspaceRecentCaptureHeld(account, []), false);
});
