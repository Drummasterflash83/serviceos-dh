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
  const blocks = css.split(`${selector} {`).slice(1);
  assert.ok(blocks.length > 0, `Missing ${selector}`);
  return blocks.map((block) => block.slice(0, block.indexOf("}"))).join("\n");
};
test("Emma roadmap uses menu-purple with white headings and unchanged inset cards", () => {
  assert.match(rule(".rw-emma-roadmap"), /padding: clamp\(18px, 2.5vw, 25px\)/);
  assert.match(rule(".rw-emma-roadmap"), /background: #242337/);
  assert.match(rule(".rw-emma-roadmap"), /border-color: #242337/);
  assert.match(
    css,
    /\.rw-emma-roadmap \.rw-panel-title h2,\s*\.rw-emma-roadmap \.rw-panel-title \.rw-eyebrow\s*\{\s*color: #fff/,
  );
  assert.match(rule(".rw-emma-roadmap .rw-panel-title"), /padding: 0 0 18px/);
  assert.match(rule(".rw-emma-roadmap-steps > div"), /background: #fff/);
  assert.match(rule(".rw-emma-roadmap-steps > div"), /min-width: 0/);
  assert.match(rule(".rw-emma-roadmap-steps small"), /color: #765b93/);
  assert.match(rule(".rw-emma-roadmap-steps strong"), /color: #302b40/);
  assert.match(rule(".rw-emma-roadmap-steps span"), /color: #71677a/);
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
test("active border is faint, good-status-only and respects reduced motion", () => {
  assert.match(rule(".rw-emma-pulse-main.rw-emma-tone-good::after"), /border: 1px solid #242337/);
  assert.match(rule(".rw-emma-pulse-main.rw-emma-tone-good::after"), /pointer-events: none/);
  assert.match(rule(".rw-emma-pulse-main.rw-emma-tone-good::after"), /4s ease-in-out infinite/);
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.rw-emma-pulse-main\.rw-emma-tone-good::after\s*\{\s*animation: none/,
  );
});
test("roadmap cards have consistent numbered circles in the top right", () => {
  for (const n of [1, 2, 3])
    assert.match(
      source,
      new RegExp(`className="rw-emma-step-number" aria-hidden="true">\\s*${n}\\s*</span>`),
    );
  assert.match(rule(".rw-emma-roadmap-steps span.rw-emma-step-number"), /border-radius: 50%/);
  assert.match(rule(".rw-emma-roadmap-steps span.rw-emma-step-number"), /right: 12px/);
});
test("client Emma card has a solid 2pt menu-purple border without the pulse", () => {
  assert.match(rule(".cp-root:not(.op-embedded) .rw-emma-pulse-main"), /border: 2pt solid #242337/);
  const overlay = rule(".cp-root:not(.op-embedded) .rw-emma-pulse-main::after");
  assert.match(overlay, /content: none/);
  assert.match(overlay, /animation: none/);
  assert.doesNotMatch(
    rule(".cp-root:not(.op-embedded) .rw-emma-pulse-main"),
    /background:|padding:|color:/,
  );
});
test("client overview uses calm, distinct sections without restyling the operator surface", () => {
  const scope = ".cp-root:not(.op-embedded)";
  assert.match(rule(`${scope} .rw-emma-roadmap`), /background: #f3eff7/);
  assert.match(rule(`${scope} .rw-emma-roadmap .rw-panel-title h2`), /color: #302b40/);
  assert.match(rule(`${scope} .rw-emma-roadmap .rw-panel-title .rw-eyebrow`), /color: #6d587e/);
  for (const section of [".rw-emma-roadmap", ".rw-journal", ".rw-emma-pulse-main"])
    assert.match(rule(`${scope} ${section}`), /border-radius: 22px/);
  assert.match(rule(`${scope} .rw-emma-pulse`), /margin: 24px 0/);
  assert.match(rule(`${scope} .rw-emma-roadmap`), /margin: 24px 0/);
  assert.match(rule(`${scope} .rw-journal`), /margin-top: 24px/);
  assert.match(rule(`${scope} .rw-emma-roadmap-steps > div`), /padding: 18px/);
  assert.match(rule(".rw-emma-roadmap-steps > div"), /background: #fff/);
  assert.match(rule(".rw-emma-shortcuts button"), /background: #242337/);
});
