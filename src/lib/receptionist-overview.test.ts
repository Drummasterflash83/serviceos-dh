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
