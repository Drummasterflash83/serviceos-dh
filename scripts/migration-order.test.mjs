import test from "node:test";
import assert from "node:assert/strict";
import { migrationForwardReferences } from "./lib/migration-order.mjs";

test("schema prefixes are not mistaken for a table called public", () => {
  assert.deepEqual(
    migrationForwardReferences(
      "alter table public.workspaces add column ready boolean;\ncreate table public.sessions(id uuid);",
    ),
    [],
  );
});
test("public-qualified and unqualified references identify the same relation", () => {
  assert.deepEqual(
    migrationForwardReferences(
      "alter table public.jobs add column ready boolean;\ncreate table jobs(id uuid);",
    ),
    [{ name: "public.jobs", line: 1, kind: "alter", createdLine: 2 }],
  );
  assert.deepEqual(
    migrationForwardReferences(
      "insert into jobs values(1);\ncreate table public.jobs(id integer);",
    ),
    [{ name: "public.jobs", line: 1, kind: "insert", createdLine: 2 }],
  );
});
test("explicit distinct schemas remain distinct even when table names match", () => {
  assert.deepEqual(
    migrationForwardReferences(
      "alter table archive.jobs add column ready boolean;\ncreate table public.jobs(id uuid);",
    ),
    [],
  );
  assert.deepEqual(
    migrationForwardReferences(
      "alter table jobs add column ready boolean;\ncreate table archive.jobs(id uuid);",
    ),
    [],
  );
  assert.deepEqual(
    migrationForwardReferences(
      "alter table archive.jobs add column ready boolean;\ncreate table archive.jobs(id uuid);",
    ),
    [{ name: "archive.jobs", line: 1, kind: "alter", createdLine: 2 }],
  );
});
test("qualified foreign-key references retain the original forward-reference protection", () => {
  assert.deepEqual(
    migrationForwardReferences(
      "create table public.children(parent_id uuid references public.parents(id));\ncreate table public.parents(id uuid primary key);",
    ),
    [{ name: "public.parents", line: 1, kind: "fk", createdLine: 2 }],
  );
});
test("original dynamic RLS array regression is still refused", () => {
  assert.deepEqual(
    migrationForwardReferences(
      "foreach t in array array[\n 'outcome_verification_states',\n 'archive.jobs'\n] loop null;end loop;\ncreate table outcome_verification_states(id uuid);\ncreate table public.jobs(id uuid);",
    ),
    [{ name: "public.outcome_verification_states", line: 2, kind: "array", createdLine: 5 }],
  );
});
test("policy index and trigger ON references retain their relation namespace", () => {
  assert.deepEqual(
    migrationForwardReferences(
      "create policy own on public.jobs using(true);\ncreate index jobs_key on jobs(id);\ncreate trigger changed after insert on public.jobs execute function changed();\ncreate table public.jobs(id uuid);",
    ),
    [
      { name: "public.jobs", line: 1, kind: "on", createdLine: 4 },
      { name: "public.jobs", line: 2, kind: "on", createdLine: 4 },
      { name: "public.jobs", line: 3, kind: "on", createdLine: 4 },
    ],
  );
});
test("same-line, backward and external references remain outside this guard", () => {
  assert.deepEqual(
    migrationForwardReferences(
      "create table jobs(id uuid references jobs(id));alter table jobs enable row level security;\ninsert into public.jobs values(null);\nalter table other_table add column job_id uuid references jobs(id);",
    ),
    [],
  );
});
test("earliest CREATE controls a repeated IF NOT EXISTS declaration", () => {
  assert.deepEqual(
    migrationForwardReferences(
      "create table if not exists public.jobs(id uuid);\nalter table jobs add column name text;\ncreate table if not exists jobs(id uuid);",
    ),
    [],
  );
});
test("unquoted SQL identifiers are case folded and accept qualification whitespace", () => {
  assert.deepEqual(
    migrationForwardReferences(
      "ALTER TABLE IF EXISTS PUBLIC . JOBS ADD COLUMN x int;\nCREATE TABLE IF NOT EXISTS public.jobs(id uuid);",
    ),
    [{ name: "public.jobs", line: 1, kind: "alter", createdLine: 2 }],
  );
});
test("ordinary seed values are not treated as table declarations or DDL-array references", () => {
  assert.deepEqual(
    migrationForwardReferences(
      "insert into registry(name) values('jobs');\ncreate table public.jobs(id uuid);",
    ),
    [],
  );
});
test("unsupported quoted identifiers are not partially read as a schema-only relation", () => {
  assert.deepEqual(
    migrationForwardReferences(
      'alter table public . "Jobs" add column x int;\ncreate table public(id integer);',
    ),
    [],
  );
});
