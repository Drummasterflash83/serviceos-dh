import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  clientSearch,
  clientWorkspaceHref,
  receptionistHref,
  selectedWorkspace,
} from "./client-workspace-nav.ts";
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("sign-in workspace defaults to home, not the proposal", () => {
  assert.deepEqual(clientSearch({}), { tenant: undefined, section: "home" });
  assert.equal(clientSearch({ section: "invalid" }).section, "home");
});
test("section and tenant survive refresh and back/forward URL round trips", () => {
  const url = new URL(clientWorkspaceHref("tenant-a", "investment"), "https://app.openfolk.ai");
  assert.deepEqual(clientSearch(Object.fromEntries(url.searchParams)), {
    tenant: "tenant-a",
    section: "investment",
  });
  assert.equal(receptionistHref("tenant-a"), "/receptionist?tenant=tenant-a");
});
test("inaccessible explicit tenant never falls through to another client", () => {
  assert.equal(selectedWorkspace([{ tenant_id: "other" }], "missing"), undefined);
  assert.equal(selectedWorkspace(undefined, "missing"), undefined);
});
test("default can only use already-authorised query results", () => {
  assert.equal(selectedWorkspace([{ tenant_id: "authorised" }])?.tenant_id, "authorised");
  assert.equal(selectedWorkspace([]), undefined);
});
test("tenant values cannot inject routes or additional query parameters", () => {
  for (const href of [
    clientWorkspaceHref("a&section=notes"),
    receptionistHref("a&section=notes"),
  ]) {
    const url = new URL(href, "https://app.openfolk.ai");
    assert.equal(url.searchParams.get("tenant"), "a&section=notes");
    assert.equal(url.searchParams.has("section"), false);
  }
});
test("company menu provides accessible home, receptionist, programme and invoice links", () => {
  const menu = read("../components/WorkspaceMenu.tsx");
  assert.match(menu, /DropdownMenuTrigger asChild/);
  assert.match(menu, /workspace menu/);
  for (const name of ["Workspace home", "AI Receptionist", "Your programme", "Invoices & delivery"])
    assert.ok(menu.includes(name));
});
test("both workspaces share the company menu; Emma has persistent top return action", () => {
  const emma = read("../components/receptionist/ReceptionistWorkspace.tsx");
  const portal = read("../components/client-portal/ClientPortal.tsx");
  assert.match(emma, /<WorkspaceMenu/);
  assert.match(portal, /<WorkspaceMenu/);
  assert.match(emma, /href=\{workspaceHref\} className="rw-workspace-back"/);
  assert.ok(emma.indexOf('className="rw-workspace-back"') < emma.indexOf('id="receptionist-main"'));
  assert.match(emma, /selectedWorkspace\(workspaces.data, selectedTenant\)/);
  assert.match(portal, /selectedWorkspace\(programmes.data, tenantId\)/);
});
test("client view is default; editing still requires real operator authority", () => {
  const portal = read("../components/client-portal/ClientPortal.tsx");
  assert.match(portal, /\[operatorTools, setOperatorTools\] = useState\(false\)/);
  assert.match(portal, /operator.data === true && operatorTools/);
  assert.match(portal, /current_user_is_openfolk_operator/);
  assert.match(portal, /setOperatorTools\(false\)/);
});
test("auth return retains selected company and section", () => {
  const auth = read("./auth.tsx");
  assert.match(auth, /redirect: pathname \+ searchStr/);
  assert.match(auth, /pathname !== "\/login"/);
});
test("home status is scoped source data, never a fabricated health score", () => {
  const home = read("../components/client-portal/WorkspaceHome.tsx");
  assert.match(home, /\.eq\("tenant_id", tenant\)/);
  assert.match(home, /maybeSingle\(\)/);
  assert.match(home, /Recorded stage:/);
  assert.match(home, /isError/);
  assert.match(home, /refetch\(\)/);
  assert.doesNotMatch(home, /100%|All systems operational|createClient|service_role/);
});
