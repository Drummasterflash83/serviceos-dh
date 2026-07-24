// Run: node --test supabase/functions/_shared/telephony/caller_id_labels.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCallerIdLabel } from "./caller_id_labels.ts";

test("parses an internal seat label into extension + name", () => {
  const p = parseCallerIdLabel("Mary - Clients <103>");
  assert.equal(p.extension, "103");
  assert.equal(p.label, "Mary - Clients");
  assert.equal(p.isExternalNumber, false);
});

test("single-name seat", () => {
  const p = parseCallerIdLabel("Larne <207>");
  assert.equal(p.extension, "207");
  assert.equal(p.label, "Larne");
});

test("IVR seat keeps its label (shared detection is downstream)", () => {
  const p = parseCallerIdLabel("Business Hours IVR <501>");
  assert.equal(p.extension, "501");
  assert.equal(p.label, "Business Hours IVR");
});

test("external phone number → no extension, external", () => {
  const p = parseCallerIdLabel("07700900123");
  assert.equal(p.extension, null);
  assert.equal(p.isExternalNumber, true);
});

test("anonymous / withheld → external, no extension", () => {
  for (const v of ["anonymous", "Withheld", "unknown"]) {
    const p = parseCallerIdLabel(v);
    assert.equal(p.extension, null);
    assert.equal(p.isExternalNumber, true);
  }
});

test("empty / null is safe", () => {
  assert.equal(parseCallerIdLabel("").extension, null);
  assert.equal(parseCallerIdLabel(null).isExternalNumber, false);
});

test("named line without a seat number is not external", () => {
  const p = parseCallerIdLabel("Reception");
  assert.equal(p.extension, null);
  assert.equal(p.isExternalNumber, false);
  assert.equal(p.label, "Reception");
});
