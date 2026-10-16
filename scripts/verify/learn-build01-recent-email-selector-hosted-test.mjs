/** Synthetic TEST transaction proves recent-import selection and draft exclusion. */
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
if (process.argv.slice(2).join(" ") !== "--test-rollback" ||
  process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT)
  throw Error("Explicit TEST rollback mode required");
const project = TEST_PROJECT;
const tenant = "ac68d905-cccc-4000-8000-000000009001";
const selected = "ac68d905-cccc-4000-8000-000000009020";
const draft = "ac68d905-cccc-4000-8000-000000009021";
async function query(sql, readOnly = true) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${project}/database/query${readOnly ? "/read-only" : ""}`,
    { method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
      headers: { Authorization: `Bearer ${savedCliToken()}`,
        "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql, ...(readOnly ? {} : { read_only: false }) }) },
  );
  if (!response.ok) throw Error(`TEST selector probe HTTP ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw Error("TEST selector probe response changed");
  return rows;
}
const absentSql = `select not exists(select 1 from public.tenants where id='${tenant}'::uuid)
  and not exists(select 1 from public.email_messages where id in('${selected}'::uuid,'${draft}'::uuid)) absent`;
if ((await query(absentSql))[0]?.absent !== true)
  throw Error("Synthetic TEST identity already exists");
let rows;
try {
  rows = await query(`begin;
    set local lock_timeout='5s';set local statement_timeout='30s';
    insert into public.tenants(id,slug,display_name,metadata)
      values('${tenant}'::uuid,'learn-projection-recent-synthetic',
        'Synthetic recent import','{"synthetic":true}'::jsonb);
    insert into public.email_messages(id,tenant_id,provider,provider_message_id,
      from_email,to_emails,cc_emails,subject,snippet,direction,received_at,raw_payload)
    values('${selected}'::uuid,'${tenant}'::uuid,'gmail','synthetic-old-mail',
      'source@example.invalid','["office@example.invalid"]'::jsonb,'[]'::jsonb,
      'Synthetic recent import','Synthetic selector probe','inbound',
      '2020-01-01T00:00:00Z','{}'::jsonb),
      ('${draft}'::uuid,'${tenant}'::uuid,'gmail','synthetic-old-draft',
      'source@example.invalid','["office@example.invalid"]'::jsonb,'[]'::jsonb,
      'Synthetic draft','Synthetic selector probe','inbound',
      '2020-01-01T00:00:00Z','{"label_ids":["DRAFT"]}'::jsonb);
    set local role service_role;
    select count(*)::int selected,
      bool_and(source_id='${selected}'::uuid and source_kind='email'
        and source_revision~'^[a-f0-9]{64}$') exact
      from public.learn_projection_pending('${tenant}'::uuid,'email',20);
    rollback;`, false);
} catch (error) {
  if ((await query(absentSql))[0]?.absent !== true)
    throw Error("Synthetic TEST rollback unconfirmed; inspect before retry");
  throw error;
}
const result = rows.find((r) => Number.isInteger(r?.selected) &&
  typeof r?.exact === "boolean");
if (result?.selected !== 1 || result.exact !== true ||
  (await query(absentSql))[0]?.absent !== true)
  throw Error("Synthetic TEST selector or rollback unconfirmed");
console.log(JSON.stringify({ state: "recent_import_selected_draft_excluded_rolled_back",
  project, selected: 1, draftExcluded: true, oldOccurredAtSelected: true,
  sourceRowsChanged: false, providerRequests: 0 }));
