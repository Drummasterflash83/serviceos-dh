import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../components/receptionist/ReceptionistWorkspace.tsx", import.meta.url),
  "utf8",
);
test("Overview omits date controls while call browsing keeps them", () => {
  assert.match(
    source,
    /view !== "today" &&\s*\(?\s*<div className="rw-segment" aria-label="Call period">/,
  );
  for (const label of ["Last 7 days", "Last 30 days", "All loaded calls"])
    assert.ok(source.includes(label));
  assert.ok(source.includes("Refresh calls"));
});
test("Overview is independent of hidden call-browser filters", () => {
  assert.match(source, /view === "today"\s*\? calls\s*:\s*calls\.filter/);
  assert.ok(source.includes("Each card uses the available call records."));
});
