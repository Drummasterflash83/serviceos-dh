/** Guarded TEST-first concurrent covering index for heavy customer-card reads. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

const mode = process.argv.slice(2).join(" ");
const LIVE_PROJECT = "tgbnakbxwcqjeimygroz";
const project = mode === "--test" ? TEST_PROJECT : mode === "--live" ? LIVE_PROJECT : null;
if (!project || (project === TEST_PROJECT ? process.env.LEARN_TEST_ALLOW_PROJECT_REF
  : process.env.LEARN_LIVE_ALLOW_PROJECT_REF) !== project)
  throw Error("Exact TEST or LIVE index release required");
const label = project === TEST_PROJECT ? "test" : "live";
const path = `.verification-results/build01-card-company-index-${label}.json`;
if (existsSync(path)) throw Error("Prior card company index release requires inspection");
const ddl = readFileSync(
  "supabase/migrations/20261104215000_learn_card_company_cover.sql", "utf8");
const sha = (v) => createHash("sha256").update(v).digest("hex");
const token = savedCliToken();
async function query(target, sql, readOnly) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${target}/database/query${readOnly ? "/read-only" : ""}`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(180000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql, ...(readOnly ? {} : { read_only: false }) }),
    });
  if (!response.ok) throw Error(`Card company index query HTTP ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw Error("Card company index response changed");
  return rows;
}
const catalog = `select c.relname index_name,i.indisvalid valid,i.indisready ready,
 pg_get_indexdef(i.indexrelid) definition,pg_relation_size(c.oid)::bigint::text bytes
 from pg_index i join pg_class c on c.oid=i.indexrelid
 join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname='learn_card_company_cover_idx'`;
const before = await query(project, catalog, true);
if (before.length !== 0) throw Error("Card company index already exists; inspect");
if (label === "live") {
  const tested = JSON.parse(readFileSync(
    ".verification-results/build01-card-company-index-test.json", "utf8"));
  const testRows = await query(TEST_PROJECT, catalog, true);
  if (tested.state !== "card_company_index_ready" ||
    tested.ddlSha256 !== sha(ddl) || testRows.length !== 1 ||
    testRows[0].valid !== true || testRows[0].ready !== true ||
    testRows[0].definition !== tested.definition)
    throw Error("Exact TEST covering index acceptance changed");
}
await query(project, ddl, false);
const after = await query(project, catalog, true);
if (after.length !== 1 || after[0].valid !== true || after[0].ready !== true ||
  !after[0].definition.includes("public.interactions") ||
  !after[0].definition.includes("INCLUDE") ||
  !/^\d+$/.test(after[0].bytes))
  throw Error("Created card company index requires inspection");
const result = { state: "card_company_index_ready", project,
  ddlSha256: sha(ddl), definition: after[0].definition,
  indexBytes: after[0].bytes, valid: true, ready: true,
  concurrent: true, sourceRowsChanged: false };
writeFileSync(path, JSON.stringify(result, null, 2) + "\n",
  { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ ...result, definition: "verified_covering_index" }));
