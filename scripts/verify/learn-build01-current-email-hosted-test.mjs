/** Rollback-only hosted TEST proof of the installed service-only current-mail selector. */
import { randomUUID } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--test-rollback" ||
    process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT)
  throw Error("Exact rollback-only TEST mode required");

const tenant = randomUUID(), current = randomUUID(), old = randomUUID(), draft = randomUUID();
const sql = `begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
insert into public.tenants(id,slug,display_name)
 values('${tenant}'::uuid,'build01-current-${tenant.slice(0,8)}','Synthetic current Email');
insert into public.email_messages(id,tenant_id,provider,provider_message_id,
 received_at,created_at,from_email,to_emails,subject,snippet,direction,raw_payload)
values
 ('${current}'::uuid,'${tenant}'::uuid,'gmail','synthetic-current-${current}',
  now()-interval '1 hour',now(),'customer@example.invalid','[]',
  'Synthetic current message','Synthetic only','inbound','{}'),
 ('${old}'::uuid,'${tenant}'::uuid,'gmail','synthetic-old-${old}',
  now()-interval '2 days',now(),'customer@example.invalid','[]',
  'Synthetic old message','Synthetic only','inbound','{}'),
 ('${draft}'::uuid,'${tenant}'::uuid,'gmail','synthetic-draft-${draft}',
  now()-interval '1 hour',now(),'customer@example.invalid','[]',
  'Synthetic draft','Synthetic only','outbound','{"label_ids":["DRAFT"]}');
set local role service_role;
set local request.jwt.claim.role='service_role';
select source_kind||'|'||source_id::text||'|'||source_revision as selected
 from public.learn_projection_pending_current_email('${tenant}'::uuid,50);
rollback;`;

const response = await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query`, {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
  headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql, read_only: false }),
});
if (!response.ok) throw Error(`Hosted current Email rehearsal HTTP ${response.status}`);
const rows = await response.json();
const selected = rows.filter(row => typeof row?.selected === "string");
if (selected.length !== 1 || !selected[0].selected.startsWith(`email|${current}|`) ||
    !/^email\|[a-f0-9-]{36}\|[a-f0-9]{64}$/.test(selected[0].selected))
  throw Error("Hosted current Email selector result changed");
console.log(JSON.stringify({ state: "hosted_test_rolled_back", project: TEST_PROJECT,
  currentSelected: true, oldAndDraftExcluded: true, syntheticRowsPersisted: false,
  providerRequests: 0, customerContentReturned: false }));
