import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("all public and client headers use the approved shared wordmark", () => {
  for (const path of [
    "src/components/OpenFolkHome.tsx",
    "src/routes/login.tsx",
    "src/components/Nav.tsx",
    "src/components/client-portal/ClientPortal.tsx",
    "src/components/receptionist/ReceptionistWorkspace.tsx",
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

test("Emma uses the dark-background variant without legacy dot styling", () => {
  assert.match(
    read("src/components/receptionist/ReceptionistWorkspace.tsx"),
    /<OpenFolkWordmark onDark \/>/,
  );
  assert.doesNotMatch(
    read("src/components/receptionist/receptionist.css"),
    /\.rw-brand > span\s*\{/,
  );
});

test("homepage and login retain their existing responsive sizes", () => {
  for (const path of ["src/components/OpenFolkHome.tsx", "src/routes/login.tsx"]) {
    assert.match(read(path), /<OpenFolkWordmark size="inherit" \/>/);
  }
});
