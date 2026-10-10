// Consume synthetic PostgreSQL output through the production reader and parser.
// fetch is replaced locally: this script cannot contact the supplied URL.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { loadAssessmentHistory, parseSavedAssessment } from "../../src/lib/learn-assessments.ts";
const pages = JSON.parse(
  readFileSync(
    new URL("../../.verification-results/learn-assessment-history-pages.json", import.meta.url),
  ),
);
assert.ok(pages.length >= 3);
const tenant = "00000000-0000-4000-8000-000000000001";
const subject = { kind: "member", id: "00000000-0000-4000-8000-000000000003" };
let index = 0,
  cursor = null;
const db = createClient("https://synthetic.invalid", "synthetic-public-key", {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: {
    fetch: async (input) => {
      const url = new URL(String(input)),
        page = pages[index++];
      assert.ok(page, "Unexpected extra request");
      assert.equal(url.pathname, "/rest/v1/learn_assessments");
      assert.equal(url.searchParams.get("tenant_id"), `eq.${tenant}`);
      assert.equal(url.searchParams.get("subject_id"), `eq.${subject.id}`);
      assert.equal(url.searchParams.get("subject_kind"), "eq.member");
      assert.equal(url.searchParams.get("order"), "recorded_at.desc,id.desc");
      assert.equal(url.searchParams.get("limit"), "20");
      assert.equal(
        url.searchParams.get("or"),
        cursor
          ? `(recorded_at.lt.${cursor.recordedAt},and(recorded_at.eq.${cursor.recordedAt},id.lt.${cursor.id}))`
          : null,
      );
      return new Response(JSON.stringify(page.data), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-range": `0-${page.data.length - 1}/${page.count}`,
        },
      });
    },
  },
});
const seen = [];
do {
  const page = await loadAssessmentHistory(db, tenant, subject, cursor);
  for (const row of page.rows) {
    parseSavedAssessment(row, tenant, subject);
    seen.push(row.id);
  }
  cursor = page.nextCursor;
} while (cursor);
assert.equal(index, pages.length);
assert.equal(new Set(seen).size, seen.length);
assert.deepEqual(
  seen,
  pages.flatMap((p) => p.data.map((r) => r.id)),
);
console.log(
  JSON.stringify({
    state: "passed",
    pages: index,
    assessments: seen.length,
    scope:
      "synthetic PostgreSQL output through production Supabase reader and frozen-snapshot parser",
  }),
);
