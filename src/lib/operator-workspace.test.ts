import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  findOperatorTenant,
  operatorModule,
  healthSignal,
  type OperatorHealth,
} from "./operator-workspace.ts";
const base: OperatorHealth = {
  receptionist: { name: "Emma", launch_stage: "Testing" },
  programme: true,
  open: 0,
  urgent: 0,
  failed: 0,
  overdue: 0,
  checkedAt: "2026-09-28T10:00:00Z",
};
test("tenant names and old IDs resolve only through the authorised directory", () => {
  const rows = [
    { tenant_id: "id-one", slug: "drummonds" },
    { tenant_id: "id-two", slug: "another-client" },
  ];
  assert.equal(findOperatorTenant(rows, "drummonds")?.tenant_id, "id-one");
  assert.equal(findOperatorTenant(rows, "id-one")?.slug, "drummonds");
  assert.equal(findOperatorTenant(rows, "unknown"), undefined);
  assert.equal(findOperatorTenant([], "drummonds"), undefined);
});
test("module links are validated", () => {
  for (const module of ["home", "receptionist", "modules", "invoices"])
    assert.equal(operatorModule(module), module);
  for (const legacy of ["programme", "outcomes"]) assert.equal(operatorModule(legacy), "modules");
  for (const invalid of [null, {}, "../bad", "phones"])
    assert.equal(operatorModule(invalid), "home");
});
test("missing health never becomes healthy or zero", () =>
  assert.equal(healthSignal(undefined).tone, "waiting"));
test("clear saved signals do not claim phone health", () =>
  assert.equal(healthSignal(base).label, "No reported issues"));
test("normal feedback is review, not an outage", () =>
  assert.equal(healthSignal({ ...base, open: 1 }).tone, "review"));
test("urgent unresolved feedback takes precedence", () =>
  assert.equal(healthSignal({ ...base, open: 3, urgent: 1 }).label, "Urgent attention"));
test("failed and overdue notifications need attention", () => {
  assert.equal(healthSignal({ ...base, failed: 1 }).tone, "urgent");
  assert.equal(healthSignal({ ...base, overdue: 1 }).tone, "urgent");
});
test("empty module installation is not healthy", () =>
  assert.equal(healthSignal({ ...base, receptionist: null, programme: false }).tone, "waiting"));
const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
test("legacy tools remain accessible under one dropdown", () => {
  const source = read("components/app/OperatorShell.tsx");
  assert.match(source, /Future tools/);
  assert.match(source, /NAV_GROUPS.map/);
  assert.match(source, /aria-expanded=\{future\}/);
});
test("operator branding is isolated from the client shell", () => {
  const shell = read("components/app/OperatorShell.tsx");
  assert.match(shell, /<span>open<\/span>folk/);
  const client = read("components/client-portal/ClientPortal.tsx");
  assert.match(client, /<ClientHeaderBrand company=\{company\}/);
  assert.match(client, /operator\.data === true && \(operatorTools \|\| operatorEmbedded\)/);
});
test("active route highlighting never paints a box behind the operator logo", () => {
  const css = read("styles/operator-workspace.css");
  assert.match(css, /\.op-brand\s*\{[^}]*background: transparent;/);
  assert.match(css, /\.op-sidebar \[aria-current="page"\]:not\(\.op-brand\)/);
  assert.doesNotMatch(css, /\.op-sidebar \[aria-current="page"\]\s*\{/);
  assert.match(css, /\.op-sidebar a:not\(\.op-brand\):hover/);
});
test("health uses exact counts, safe columns and refuses failed reads", () => {
  const source = read("components/app/useOperatorHealth.ts");
  assert.match(source, /head: true, count: "exact"/);
  assert.match(source, /results.some\(\(result\) => result.error\)/);
  assert.doesNotMatch(source, /select\("\*"\)|\.limit\(/);
});
test("shared editors retain optimistic concurrency", () => {
  const source = read("components/client-portal/ClientPortal.tsx");
  assert.match(source, /\.eq\("version", editorVersion \?\? row.version\)/);
  const edit = read("components/app/OperatorDelivery.tsx");
  assert.match(edit, /p_version: edit.version/);
  assert.match(edit, /Publish to client/);
});
