import test from "node:test";
import assert from "node:assert/strict";
import { clientSearch, clientWorkspaceHref, selectedWorkspace } from "./client-workspace-nav.ts";
test("client deep links retain section and tenant", () => {
  assert.deepEqual(clientSearch({ tenant: "dh", section: "investment" }), {
    tenant: "dh",
    section: "investment",
  });
});
test("invalid sections and non-string tenants are discarded", () => {
  assert.deepEqual(clientSearch({ tenant: { id: "dh" }, section: "delete" }), {
    tenant: undefined,
    section: undefined,
  });
});
test("an inaccessible explicit tenant never falls back to another client", () => {
  assert.equal(selectedWorkspace([{ tenant_id: "other" }], "dh"), undefined);
});
test("first accessible workspace is used only without an explicit selection", () => {
  const rows = [{ tenant_id: "other" }, { tenant_id: "dh" }];
  assert.equal(selectedWorkspace(rows)?.tenant_id, "other");
  assert.equal(selectedWorkspace(rows, "dh")?.tenant_id, "dh");
  assert.equal(selectedWorkspace(undefined, "dh"), undefined);
});
test("return links keep and encode the selected workspace", () => {
  assert.equal(clientWorkspaceHref("dh&section=notes"), "/client?tenant=dh%26section%3Dnotes");
  assert.equal(clientWorkspaceHref(), "/client");
});
