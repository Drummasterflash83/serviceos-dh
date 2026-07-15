#!/usr/bin/env node
// Migration execution-order guard.
//
// Postgres runs a migration top-to-bottom, so a relation must be CREATED before it is
// referenced (FK, insert, alter, RLS/policy/trigger `on <table>`, or a table name in a
// dynamic `array[...]` DDL loop). This static check parses each migration file and fails
// if any reference points at a table that the SAME file creates on a LATER line — the
// exact class of bug that made 20260722120000 fail in production
// (`outcome_verification_states` referenced in the RLS loop before its CREATE).
//
// It deliberately only flags same-file forward references: a table created by an EARLIER
// migration is never in this file's create-set, so cross-migration dependencies are not
// touched. Run: `node scripts/check-migration-order.mjs`
//
// This is a heuristic linter, not a SQL parser — it is conservative (only same-file,
// created-later references), so it has no false positives on external tables.

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "supabase/migrations");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const IDENT = "[a-z_][a-z0-9_]*";
let failures = 0;
let checked = 0;

for (const file of files) {
  const lines = readFileSync(join(dir, file), "utf8").split("\n");

  // 1) tables this file CREATES → earliest 1-indexed line.
  const created = new Map();
  lines.forEach((ln, i) => {
    const m = ln.match(
      new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(${IDENT})`, "i"),
    );
    if (m) {
      const name = m[1].toLowerCase();
      if (!created.has(name)) created.set(name, i + 1);
    }
  });

  // 2) references to a table, with the line they occur on.
  const refs = [];
  let inArray = false;
  lines.forEach((ln, i) => {
    const line = i + 1;
    const push = (re, kind) => {
      for (const m of ln.matchAll(re)) refs.push({ name: m[1].toLowerCase(), line, kind });
    };
    push(new RegExp(`references\\s+(${IDENT})\\s*\\(`, "gi"), "fk");
    push(new RegExp(`insert\\s+into\\s+(${IDENT})`, "gi"), "insert");
    push(new RegExp(`alter\\s+table\\s+(?:if\\s+exists\\s+)?(${IDENT})`, "gi"), "alter");
    push(new RegExp(`\\bon\\s+(${IDENT})`, "gi"), "on"); // create index/policy/trigger ... on <table>

    // Table names inside a (possibly multi-line) `array[ ... ]` literal — the dynamic
    // RLS/registry loops. Only scan within the array so seed VALUES are never mistaken.
    if (/array\s*\[/i.test(ln)) inArray = true;
    if (inArray) {
      for (const m of ln.matchAll(new RegExp(`'(${IDENT})'`, "g"))) {
        refs.push({ name: m[1].toLowerCase(), line, kind: "array" });
      }
    }
    if (inArray && /\]/.test(ln)) inArray = false;
  });

  // 3) flag any reference to a same-file table created on a LATER line.
  for (const r of refs) {
    const createdLine = created.get(r.name);
    if (createdLine !== undefined && createdLine > r.line) {
      console.log(
        `  [FAIL] ${file}:${r.line} references '${r.name}' (${r.kind}) but it is created later at line ${createdLine}`,
      );
      failures++;
    }
  }
  checked++;
}

console.log(
  failures === 0
    ? `MIGRATION ORDER: PASS (${checked} migration files, no forward references)`
    : `MIGRATION ORDER: FAIL (${failures} forward reference(s))`,
);
process.exit(failures === 0 ? 0 : 1);
