import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("OpenFolk public and workspace headers use the approved shared wordmark", () => {
  for (const path of [
    "src/components/OpenFolkHome.tsx",
    "src/routes/login.tsx",
    "src/components/Nav.tsx",
  ]) {
    const text = read(path);
    assert.match(text, /<OpenFolkWordmark[\s/>]/, path);
    assert.doesNotMatch(text, /openfolk-icon\.svg|of-brand-dot|OpenFolk<span>●/, path);
  }
});

test("brand remains lowercase, navy/white and gold, without a backing box or icon", () => {
  const source = read("src/components/OpenFolkWordmark.tsx");
  assert.match(source, /Helvetica, Arial, sans-serif/);
  assert.match(source, /fontWeight: 700/);
  assert.match(source, /onDark \? "#fff" : "#203F70"/);
  assert.match(source, /color: "#CC8625"/);
  assert.match(source, />open<\/span>/);
  assert.match(source, />folk<\/span>/);
  assert.doesNotMatch(source, /background|borderRadius|padding|<img|<svg|●/);
});

test("Drummonds uses its orange emblem and short name in both client headers", () => {
  assert.match(
    read("src/components/receptionist/ReceptionistWorkspace.tsx"),
    /<ClientHeaderBrand company=\{w\.company\}/,
  );
  assert.match(
    read("src/components/client-portal/ClientPortal.tsx"),
    /<ClientHeaderBrand company=\{p\?\.company/,
  );
  assert.match(read("src/components/ClientHeaderBrand.tsx"), /of-drummonds-emblem/);
  assert.match(read("src/lib/client-brand.ts"), /"Drummond's"/);
  assert.match(
    read("src/components/receptionist/ReceptionistWorkspace.tsx"),
    /Powered by OpenFolk/,
  );
});

test("workspace menu has a single navigation label below the client brand", () => {
  const menu = read("src/components/WorkspaceMenu.tsx");
  const css = read("src/styles/workspace-navigation.css");
  assert.match(menu, /hasDrummondsBrand\(company\)/);
  assert.doesNotMatch(menu, /of-drummonds-emblem/);
  assert.match(css, /Black%20Icon\.png/);
  assert.match(css, /background: #cc8625/);
  assert.match(menu, /className="of-workspace-label">Your Workspace<\/span>/);
  assert.doesNotMatch(menu, /<strong>\{clientDisplayName\(company\)\}/);
  assert.match(css, /\.of-workspace-switch\.is-drummonds \.of-workspace-label/);
});

test("homepage and login retain their existing responsive sizes", () => {
  for (const path of ["src/components/OpenFolkHome.tsx", "src/routes/login.tsx"]) {
    assert.match(read(path), /<OpenFolkWordmark size="inherit" \/>/);
  }
});
