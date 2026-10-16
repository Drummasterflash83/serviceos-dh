import assert from "node:assert/strict";
import test from "node:test";
import {
  isCurrentWorkspaceProfileProof,
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
    generation: "generation-1", revision: 7,
    state: "blocked", block_code: "persistence_failed" };
  assert.equal(isWorkspaceRecentCaptureHeld(account, [held]), true);
  assert.equal(isWorkspaceRecentCaptureHeld(account, [{ ...held, state: "ready", block_code: null }]), false);
  assert.equal(isWorkspaceRecentCaptureHeld(account, [{ ...held, tenant_id: "tenant-2" }]), false);
  assert.equal(isWorkspaceRecentCaptureHeld(account, [{ ...held, email_account_id: "account-2" }]), false);
  assert.equal(isWorkspaceRecentCaptureHeld(account, []), false);
});

test("only a fresh matching successful profile proof can schedule a delegation hold", () => {
  const now = Date.parse("2026-10-16T14:10:00Z");
  const held = { tenant_id: account.tenant_id, email_account_id: account.id,
    generation: "generation-1", revision: 7,
    state: "blocked", block_code: "admin_delegation_missing" };
  const proof = { status: "success", created_at: "2026-10-16T14:08:00Z",
    detail: { code: "provider_verified", checkpoint_generation: "generation-1",
      checkpoint_revision: 7, mailbox_content_read: false,
      request_audit_id: "audit-request-1" } };
  assert.equal(isCurrentWorkspaceProfileProof(held, proof, now), true);
  assert.equal(isWorkspaceRecentCaptureHeld(account, [held], proof, now), false);
  for (const changed of [
    { status: "failed" },
    { created_at: "2026-10-16T13:00:00Z" },
    { created_at: "2026-10-16T14:11:00Z" },
    { detail: { ...proof.detail, code: "provider_unconfirmed" } },
    { detail: { ...proof.detail, checkpoint_generation: "other" } },
    { detail: { ...proof.detail, checkpoint_revision: "8" } },
    { detail: { ...proof.detail, mailbox_content_read: true } },
    { detail: { ...proof.detail, request_audit_id: undefined } },
  ]) {
    assert.equal(isWorkspaceRecentCaptureHeld(account, [held], { ...proof, ...changed }, now), true);
  }
  assert.equal(isWorkspaceRecentCaptureHeld(account, [
    { ...held, block_code: "persistence_failed" },
  ], proof, now), true);
  assert.equal(isWorkspaceRecentCaptureHeld({ ...account, id: "other" }, [held], proof, now), false);
});
