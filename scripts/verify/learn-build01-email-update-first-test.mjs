/** Rollback-only hosted TEST fixture for update priority and unlinked fallback. */
import { randomUUID } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
if (process.argv.slice(2).join(" ") !== "--test-rollback-only" ||
    process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT)
  throw Error("Exact TEST rollback-only Email selector mode required");
const tenant = randomUUID(), linked = randomUUID(), unlinked = randomUUID();
const interaction = randomUUID();
const headers = { Authorization: `Bearer ${savedCliToken()}`,
  "Content-Type": "application/json" };
async function query(sql, readOnly = true) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query${readOnly ? "/read-only" : ""}`, {
    method: "POST", headers, redirect: "error", signal: AbortSignal.timeout(55000),
    body: JSON.stringify({ query: sql, ...(!readOnly ? { read_only: false } : {}) }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok)
    throw Error(`TEST Email selector fixture HTTP ${response.status} (${result?.code ?? "unknown"})`);
  return result;
}
const fixture = `begin;
insert into public.tenants(id,slug,display_name,status,metadata)
 values('${tenant}'::uuid,'synthetic-email-update-${tenant}',
 'Synthetic Email update-first fixture','active','{"synthetic":true}'::jsonb);
insert into public.email_messages(id,tenant_id,provider,provider_message_id,
 received_at,created_at,updated_at,from_email,to_emails,subject,snippet,direction,raw_payload)
 values('${linked}'::uuid,'${tenant}'::uuid,'gmail','synthetic-${linked}',
 now()-interval '1 day',now()-interval '1 day',now()-interval '30 minutes',
 'synthetic@example.invalid','[]','Linked synthetic','Synthetic','inbound','{}'),
 ('${unlinked}'::uuid,'${tenant}'::uuid,'gmail','synthetic-${unlinked}',
 now()-interval '1 day',now()-interval '1 day',now()-interval '30 minutes',
 'synthetic@example.invalid','[]','Unlinked synthetic','Synthetic','inbound','{}');
insert into public.interactions(id,tenant_id,source_connector_id,source_type,
 source_table,source_id,interaction_type,occurred_at,metadata)
 select '${interaction}'::uuid,'${tenant}'::uuid,'email','email',
 'email_messages',m.id,'email_message',coalesce(m.received_at,m.created_at),
 jsonb_build_object('source_projection',jsonb_build_object('revision',
  public.learn_projection_revision(public.learn_email_source_fields(m),'')))
 from public.email_messages m where m.id='${linked}'::uuid;
insert into public.learn_interaction_projection_receipts
 (request_id,tenant_id,source_kind,source_id,source_revision,receipt,created_at)
 select gen_random_uuid(),'${tenant}'::uuid,'email',m.id,
 public.learn_projection_revision(public.learn_email_source_fields(m),''),
 '{"state":"committed","action":"created"}'::jsonb,now()-interval '1 hour'
 from public.email_messages m where m.id='${linked}'::uuid;
do $$declare selected uuid;
begin
 select source_id into selected from public.learn_projection_pending('${tenant}'::uuid,'email',1);
 if selected is distinct from '${linked}'::uuid
 then raise exception 'bounded_update_not_first';end if;
 insert into public.learn_interaction_projection_receipts
  (request_id,tenant_id,source_kind,source_id,source_revision,receipt,created_at)
 select gen_random_uuid(),'${tenant}'::uuid,'email',m.id,
  public.learn_projection_revision(public.learn_email_source_fields(m),''),
  '{"state":"committed","action":"unchanged"}'::jsonb,clock_timestamp()
 from public.email_messages m where m.id='${linked}'::uuid;
 select source_id into selected from public.learn_projection_pending('${tenant}'::uuid,'email',1);
 if selected is distinct from '${unlinked}'::uuid
 then raise exception 'unlinked_fallback_not_selected';end if;
end$$;
rollback;`;
await query(fixture, false);
const rows = await query(`select count(*)::int remaining from public.tenants where id='${tenant}'::uuid`);
if (rows.length !== 1 || rows[0].remaining !== 0)
  throw Error("TEST Email selector fixture rollback unconfirmed");
console.log(JSON.stringify({ state: "email_update_first_test_verified",
  project: TEST_PROJECT, indexedUpdateFirst: true, unlinkedFallbackRetained: true,
  rollbackVerified: true, providerRequests: 0, productionDataWrites: false }));
