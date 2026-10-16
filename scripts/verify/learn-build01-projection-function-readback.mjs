/** Read-only TEST/LIVE catalog guard for the retained Email selector. */
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
const mode = process.argv.slice(2).join(" ");
if (!["--test-read-only","--live-read-only"].includes(mode))
  throw Error("Explicit project read-only mode required");
const project = mode === "--test-read-only" ? TEST_PROJECT : "tgbnakbxwcqjeimygroz";
const query = `select
  (select data_type from information_schema.columns
    where table_schema='public' and table_name='email_messages'
      and column_name='origin_campaign_id') origin_campaign_type,
  (select md5(pg_get_functiondef('public.learn_projection_pending(uuid,text,integer)'::regprocedure))) selector_md5,
  (select md5(pg_get_functiondef('public.learn_projection_pending_full(uuid,text,integer)'::regprocedure))) fallback_md5,
  (select md5(pg_get_functiondef('public.learn_projection_review_count(uuid,text)'::regprocedure))) review_md5,
  (select position('to_jsonb(m)->>''origin_campaign_id''' in
    pg_get_functiondef('public.learn_projection_pending(uuid,text,integer)'::regprocedure))>0) selector_full_row_json,
  (select position('to_jsonb(m)->>''origin_campaign_id''' in
    pg_get_functiondef('public.learn_projection_pending_full(uuid,text,integer)'::regprocedure))>0) fallback_full_row_json`;
const response = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query/read-only`,
  { method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
    headers: { Authorization: `Bearer ${savedCliToken()}`,
      "Content-Type": "application/json" }, body: JSON.stringify({ query }) },
);
if (!response.ok) throw Error(`Projection catalog HTTP ${response.status}`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length !== 1 ||
  !["selector_md5","fallback_md5","review_md5"].every((k) =>
    rows[0]?.[k] === null || /^[a-f0-9]{32}$/.test(rows[0][k])) ||
  typeof rows[0]?.selector_full_row_json !== "boolean" ||
  typeof rows[0]?.fallback_full_row_json !== "boolean")
  throw Error("Projection catalog shape changed");
console.log(JSON.stringify({ project, observedAt: new Date().toISOString(),
  ...rows[0], productionDataWrites: false }));
