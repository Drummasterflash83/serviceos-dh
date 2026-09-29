import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../components/receptionist/ReceptionistWorkspace.tsx", import.meta.url),
  "utf8",
);
test("Overview omits the call toolbar while call browsing keeps its controls", () => {
  assert.match(
    source,
    /\(view === "calls" \|\| view === "callers"\) &&\s*\(\s*<div className="rw-toolbar">/,
  );
  for (const label of ["Last 7 days", "Last 30 days", "All loaded calls"])
    assert.ok(source.includes(label));
  assert.ok(source.includes("Refresh calls"));
});
test("Overview is independent of hidden call-browser filters", () => {
  assert.match(source, /view === "today"\s*\? calls\s*:\s*calls\.filter/);
  assert.match(source, /emmaHealthCards\(calls,\s*\{/);
});

const css = readFileSync(
  new URL("../components/receptionist/receptionist.css", import.meta.url),
  "utf8",
);
const rule = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `Missing ${selector}`);
  return css.slice(start, css.indexOf("}", start));
};
test("Emma roadmap inverts the surfaces and insets its cards at all viewport sizes", () => {
  assert.match(rule(".rw-emma-roadmap"), /padding: clamp\(18px, 2.5vw, 25px\)/);
  assert.match(rule(".rw-emma-roadmap"), /background: #eee7f5/);
  assert.match(rule(".rw-emma-roadmap .rw-panel-title"), /padding: 0 0 18px/);
  assert.match(rule(".rw-emma-roadmap-steps > div"), /background: #fff/);
  assert.match(rule(".rw-emma-roadmap-steps > div"), /min-width: 0/);
  assert.match(
    css,
    /@media \(max-width: 680px\)\s*{\s*\.rw-emma-roadmap-steps\s*{\s*grid-template-columns: 1fr/,
  );
  assert.doesNotMatch(source, /Each connection will be checked before Emma uses it/);
});
test("Emma shortcuts use menu-purple with white text and retain both destinations", () => {
  assert.match(rule(".rw-emma-shortcuts button"), /background: #242337/);
  assert.match(rule(".rw-emma-shortcuts button"), /color: #fff/);
  assert.match(rule(".rw-emma-shortcuts button:focus-visible"), /outline:/);
  assert.match(source, /onClick=\{\(\) => setView\("practice"\)\}>\s*<Mic/);
  assert.match(source, /onClick=\{\(\) => setView\("improvements"\)\}>\s*<Sparkles/);
});
