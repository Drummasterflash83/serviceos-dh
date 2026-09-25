import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  clientSearch,
  clientWorkspaceHref,
  receptionistHref,
  selectedWorkspace,
  canShowOpenFolkAdmin,
} from "./client-workspace-nav.ts";
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("admin return is shown only to Chris with verified admin authority", () => {
  assert.equal(canShowOpenFolkAdmin("chris@openfolk.ai", true), true);
  assert.equal(canShowOpenFolkAdmin("Chris@OpenFolk.ai", true), true);
  assert.equal(canShowOpenFolkAdmin("heidi@drummondheating.co.uk", true), false);
  assert.equal(canShowOpenFolkAdmin("other@openfolk.ai", true), false);
  assert.equal(canShowOpenFolkAdmin("chris@openfolk.ai.example.com", true), false);
});
test("an email match never grants access: missing, failed or pending authority hides the link", () => {
  for (const authority of [false, undefined, null, "true", 1, {}]) {
    assert.equal(canShowOpenFolkAdmin("chris@openfolk.ai", authority), false);
  }
  assert.equal(canShowOpenFolkAdmin(undefined, true), false);
  assert.equal(canShowOpenFolkAdmin(null, true), false);
});
test("admin return preserves the signed-in session and uses the existing guarded route", () => {
  const link = read("../components/OpenFolkAdminLink.tsx");
  assert.match(link, /if \(!canShowOpenFolkAdmin\(email, authorised\)\) return null/);
  assert.match(link, /<Link to="\/openfolk"/);
  assert.match(link, /OpenFolk admin/);
  assert.doesNotMatch(link, /signOut|signIn|window\.open|target=|localStorage/);
});
test("both sidebar footers contain the same gated admin return", () => {
  for (const [path, marker] of [
    ["../components/client-portal/ClientPortal.tsx", 'className="cp-sidebar-bottom"'],
    ["../components/receptionist/ReceptionistWorkspace.tsx", 'className="rw-sidebar-bottom"'],
  ]) {
    const text = read(path);
    const footer = text.slice(text.indexOf(marker), text.indexOf("</aside>", text.indexOf(marker)));
    assert.match(
      footer,
      /<OpenFolkAdminLink email=\{user\?\.email\} authorised=\{operator.data\} \/>/,
    );
  }
});

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
  assert.equal(receptionistHref("tenant-a"), "/client?tenant=tenant-a&section=receptionist");
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
    assert.notEqual(url.searchParams.get("section"), "notes");
  }
});
test("company menu provides accessible home, receptionist, programme and invoice links", () => {
  const menu = read("../components/WorkspaceMenu.tsx");
  assert.match(menu, /DropdownMenuTrigger asChild/);
  assert.match(menu, /workspace menu/);
  for (const name of ["Workspace home", "AI Receptionist", "Your programme", "Invoices & delivery"])
    assert.ok(menu.includes(name));
});
test("receptionist shares the client shell and keeps old links working", () => {
  const emma = read("../components/receptionist/ReceptionistWorkspace.tsx");
  const styles = read("../components/receptionist/receptionist.css");
  const portal = read("../components/client-portal/ClientPortal.tsx");
  assert.match(emma, /<WorkspaceMenu/);
  assert.doesNotMatch(portal, /WorkspaceMenu/);
  assert.match(emma, /onClick=\{goBack\}/);
  assert.match(emma, /window\.history\.back\(\)/);
  assert.match(emma, /window\.location\.assign\(workspaceHref\)/);
  assert.match(emma, /to: "\/receptionist"/);
  assert.match(styles, /\.rw-topbar\s*\{[^}]*position: sticky;[^}]*top: 0;/);
  assert.ok(emma.indexOf('className="rw-workspace-back"') < emma.indexOf('id="receptionist-main"'));
  assert.match(emma, /selectedWorkspace\(workspaces.data, selectedTenant\)/);
  assert.match(portal, /selectedWorkspace\(programmes.data, tenantId\)/);
  assert.match(portal, /<ReceptionistWorkspace[\s\S]*?embedded/);
  assert.match(emma, /!embedded && \([\s\S]*?<aside/);
  assert.match(emma, /!embedded && !demo && !mobileMenuOpen/);
  assert.match(emma, /const view = embedded \? receptionistView\(initialView\) : localView/);
  const route = read("../routes/receptionist.tsx");
  assert.match(route, /throw redirect\(/);
  assert.match(route, /section: "receptionist"/);
  assert.match(route, /replace: true/);
});

test("unified sidebar uses orange icons, white labels and no duplicate workspace dropdown", () => {
  const portal = read("../components/client-portal/ClientPortal.tsx");
  const css = read("../styles/client-workspace.css");
  const brand = read("../styles/workspace-navigation.css");
  assert.doesNotMatch(portal, /WorkspaceMenu|of-workspace-switch/);
  assert.match(portal, /<nav aria-label="Client workspace">/);
  assert.match(portal, /className="cp-receptionist-nav"/);
  assert.match(css, /\.cp-root \.cp-sidebar svg\s*\{\s*color: #cc8625;/);
  assert.match(brand, /\.of-drummonds-emblem\s*\{[^}]*background: #cc8625;/);
  assert.match(css, /\.cp-root \.cp-sidebar nav button,[^}]*color: #fff;/);
  assert.match(css, /\.cp-receptionist-nav button\.is-current\s*\{[^}]*color: #fff;/);
});

test("receptionist pages round-trip through the same client route", () => {
  for (const view of [
    "today",
    "practice",
    "improvements",
    "callers",
    "phones",
    "details",
    "calls",
  ] as const) {
    const url = new URL(receptionistHref("tenant-a", view), "https://app.openfolk.ai");
    assert.equal(url.pathname, "/client");
    assert.deepEqual(clientSearch(Object.fromEntries(url.searchParams)), {
      tenant: "tenant-a",
      section: "receptionist",
      view,
    });
  }
  assert.deepEqual(clientSearch({ section: "receptionist", view: "bad" }), {
    tenant: undefined,
    section: "receptionist",
    view: "today",
  });
  assert.deepEqual(clientSearch({ section: "investment", view: "practice" }), {
    tenant: undefined,
    section: "investment",
  });
});
test("mobile workspaces use one persistent menu and an explicit pull refresh", () => {
  const portal = read("../components/client-portal/ClientPortal.tsx");
  const emma = read("../components/receptionist/ReceptionistWorkspace.tsx");
  const navigation = read("../styles/workspace-navigation.css");
  const refresh = read("./use-pull-to-refresh.ts");
  for (const source of [portal, emma]) {
    assert.match(source, /aria-expanded=\{mobileMenuOpen\}/);
    assert.match(source, /usePullToRefresh/);
    assert.match(source, /setMobileMenuOpen\(false\)/);
  }
  assert.match(navigation, /position: sticky/);
  assert.match(navigation, /height: 100dvh/);
  assert.match(
    navigation,
    /\.cp-root \.cp-sidebar nav,[\s\S]*\.rw \.rw-sidebar nav\s*\{\s*display: grid/,
  );
  assert.match(refresh, /window\.scrollY > 2/);
  assert.match(refresh, /TRIGGER_DISTANCE = 76/);
  assert.doesNotMatch(refresh, /preventDefault/);
});
test("Emma overview has honest health labels and direct practice and improvement paths", () => {
  const emma = read("../components/receptionist/ReceptionistWorkspace.tsx");
  const mobileHome = read("../styles/client-workspace.css");
  assert.match(emma, /\? "Your receptionist"/);
  assert.match(
    emma,
    /aria-label=\{`\$\{w.name\}: \$\{healthCards\[0\].headline\}. Open status details`\}/,
  );
  assert.match(emma, /onClick=\{\(\) => setView\("practice"\)\}/);
  assert.match(emma, /onClick=\{\(\) => setView\("improvements"\)\}/);
  assert.match(emma, /\? "Healthy"[\s\S]*\? "Needs attention"[\s\S]*: "Evidence building"/);
  assert.match(mobileHome, /\.cp-emma-entry\s*\{[\s\S]*?background: #242337/);
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
  assert.match(home, /receptionist.data.launch_stage/);
  assert.match(home, /mainNumberStatus\(receptionist.data.launch_stage\)/);
  assert.match(home, /workspace-emma-calls/);
  assert.match(home, /isError/);
  assert.match(home, /refetch\(\)/);
  assert.doesNotMatch(home, /100%|All systems operational|createClient|service_role/);
});
