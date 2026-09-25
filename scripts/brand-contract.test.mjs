import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("OpenFolk public and workspace headers use the approved shared wordmark", () => {
  for (const path of [
    "src/components/OpenFolkHome.tsx",
    "src/routes/login.tsx",
    "src/components/Nav.tsx",
    "src/components/client-portal/ClientPortal.tsx",
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

test("Drummonds Emma workspace uses the client's mark in white without a logo box", () => {
  assert.match(
    read("src/components/receptionist/ReceptionistWorkspace.tsx"),
    /w\.company === "Drummond Heating"[\s\S]*src="\/brand\/drummond-logo\.png"/,
  );
  assert.match(read("src/components/receptionist/receptionist.css"), /\.rw-brand \.rw-client-logo\s*\{\s*filter: brightness\(0\) invert\(1\)/);
  assert.match(read("src/components/receptionist/ReceptionistWorkspace.tsx"), /Powered by OpenFolk/);
});

test("Drummonds workspace menu reuses the supplied emblem in OpenFolk gold", () => {
  const menu = read("src/components/WorkspaceMenu.tsx");
  const css = read("src/styles/workspace-navigation.css");
  assert.match(menu, /company === "Drummond Heating"/);
  assert.match(menu, /of-drummonds-emblem/);
  assert.match(css, /Black%20Icon\.png/);
  assert.match(css, /background: #cc8625/);
  assert.match(menu, /company\.slice\(0, 1\)/);
});

test("homepage and login retain their existing responsive sizes", () => {
  for (const path of ["src/components/OpenFolkHome.tsx", "src/routes/login.tsx"]) {
    assert.match(read(path), /<OpenFolkWordmark size="inherit" \/>/);
  }
});
