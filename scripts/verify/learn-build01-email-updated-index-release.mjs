/** Concurrent index for bounded Email source-change selection. */
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
const mode = process.argv.slice(2).join(" ");
const project = mode === "--test" ? TEST_PROJECT
  : mode === "--live" ? "tgbnakbxwcqjeimygroz" : null;
if (!project || (project === TEST_PROJECT ? process.env.LEARN_TEST_ALLOW_PROJECT_REF
  : process.env.LEARN_LIVE_ALLOW_PROJECT_REF) !== project)
  throw Error("Exact TEST or LIVE project allowlist required");
const headers = { Authorization: `Bearer ${savedCliToken()}`,
  "Content-Type": "application/json" };
async function sql(query, readOnly) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${readOnly ? "/read-only" : ""}`, {
    method: "POST", headers, redirect: "error", signal: AbortSignal.timeout(120000),
    body: JSON.stringify({ query, ...(readOnly ? {} : { read_only: false }) }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw Error(`Email index query HTTP ${response.status} (${typeof body.code === "string" ? body.code : "unknown"})`);
  }
  return response.json();
}
const catalog = `select c.relname name,i.indisvalid valid,i.indisready ready,
 pg_get_indexdef(i.indexrelid) definition
 from pg_index i join pg_class c on c.oid=i.indexrelid
 join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname='learn_email_projection_updated_idx'`;
const before = await sql(catalog, true);
if (!Array.isArray(before) || before.length !== 0)
  throw Error("Email updated index already exists; inspect before changing");
if (project !== TEST_PROJECT) {
  const test = await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query/read-only`, {
    method: "POST", headers, redirect: "error", signal: AbortSignal.timeout(30000),
    body: JSON.stringify({ query: catalog }),
  });
  if (!test.ok) throw Error("TEST index preflight unavailable");
  const rows = await test.json();
  if (rows.length !== 1 || rows[0].valid !== true || rows[0].ready !== true ||
      !rows[0].definition.includes("updated_at DESC"))
    throw Error("TEST index acceptance changed");
}
await sql(`create index concurrently learn_email_projection_updated_idx
 on public.email_messages(tenant_id,updated_at desc,id desc)`, false);
const after = await sql(catalog, true);
if (after.length !== 1 || after[0].valid !== true || after[0].ready !== true ||
    !after[0].definition.includes("email_messages") ||
    !after[0].definition.includes("updated_at DESC"))
  throw Error("Created Email index requires inspection");
console.log(JSON.stringify({ state: "email_updated_index_ready", project,
  name: after[0].name, valid: true, ready: true,
  concurrent: true, sourceRowsChanged: false }));
