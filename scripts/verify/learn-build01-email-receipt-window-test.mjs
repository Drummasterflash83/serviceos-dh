/** Rollback-only hosted TEST fixture for Email revision selection and holds. */
import { randomUUID } from "node:crypto";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
if (process.argv.slice(2).join(" ") !== "--test-rollback-only" ||
    process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT)
  throw Error("Exact TEST rollback-only mode required");
const tenant = randomUUID(), source = randomUUID(), interaction = randomUUID();
const headers = { Authorization: `Bearer ${savedCliToken()}`,
  "Content-Type": "application/json" };
async function query(sql, readOnly) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query${readOnly ? "/read-only" : ""}`, {
    method: "POST", headers, redirect: "error", signal: AbortSignal.timeout(60000),
    body: JSON.stringify({ query: sql, ...(readOnly ? {} : { read_only: false }) }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw Error(`Email fixture HTTP ${response.status} (${typeof detail.code === "string" ? detail.code : "unknown"})`);
  }
  return response.json();
}
const fixture = `begin;
set local statement_timeout='40s';
insert into public.tenants(id,slug,display_name)
 values('${tenant}'::uuid,'synthetic-email-revision-${tenant.slice(0,8)}','Synthetic Email revision fixture');
insert into public.email_messages(id,tenant_id,provider,provider_message_id,
 received_at,created_at,updated_at,from_email,to_emails,subject,snippet,direction,raw_payload)
 values('${source}'::uuid,'${tenant}'::uuid,'gmail','synthetic-${source}',
 now()-interval '1 day',now()-interval '1 day',now()-interval '1 day',
 'synthetic@example.invalid','[]','Initial synthetic subject','Synthetic only','inbound','{}');
insert into public.interactions(id,tenant_id,source_connector_id,source_type,
 source_table,source_id,interaction_type,occurred_at,metadata)
 select '${interaction}'::uuid,'${tenant}'::uuid,'email','email','email_messages',m.id,
 'email_message',coalesce(m.received_at,m.created_at),
 jsonb_build_object('source_projection',jsonb_build_object('revision',
  public.learn_projection_revision(public.learn_email_source_fields(m),'')))
 from public.email_messages m where m.id='${source}'::uuid;
insert into public.learn_interaction_projection_receipts
 (request_id,tenant_id,source_kind,source_id,source_revision,receipt,created_at)
 select gen_random_uuid(),'${tenant}'::uuid,'email',m.id,
 public.learn_projection_revision(public.learn_email_source_fields(m),''),
 '{"state":"committed","action":"created"}'::jsonb,now()-interval '1 hour'
 from public.email_messages m where m.id='${source}'::uuid;
do $$declare first_revision text; changed_revision text; new_revision text;
begin
 if exists(select 1 from public.learn_projection_pending_email_updates('${tenant}'::uuid,10))
 then raise exception 'initial_current_email_selected';end if;
 select metadata#>>'{source_projection,revision}' into first_revision
  from public.interactions where id='${interaction}'::uuid;
 update public.email_messages set subject='Changed synthetic subject' where id='${source}'::uuid;
 select source_revision into changed_revision from public.learn_projection_pending_email_updates('${tenant}'::uuid,10);
 if changed_revision is null or changed_revision=first_revision
 then raise exception 'changed_email_not_selected';end if;
 insert into public.learn_interaction_projection_receipts
  (request_id,tenant_id,source_kind,source_id,source_revision,receipt,created_at)
 values(gen_random_uuid(),'${tenant}'::uuid,'email','${source}'::uuid,
  changed_revision,'{"state":"review_required"}'::jsonb,now()-interval '1 hour');
 if exists(select 1 from public.learn_projection_pending_email_updates('${tenant}'::uuid,10))
 then raise exception 'held_revision_selected';end if;
 update public.email_messages set subject='Newer synthetic subject' where id='${source}'::uuid;
 select source_revision into new_revision from public.learn_projection_pending_email_updates('${tenant}'::uuid,10);
 if new_revision is null or new_revision=changed_revision
 then raise exception 'changed_held_source_not_reentered';end if;
 update public.email_messages set raw_payload='{"availability":"synthetic"}'::jsonb
  where id='${source}'::uuid;
 if (select source_revision from public.learn_projection_pending_email_updates('${tenant}'::uuid,10))<>new_revision
 then raise exception 'metadata_only_update_not_selected';end if;
 insert into public.learn_interaction_projection_receipts
  (request_id,tenant_id,source_kind,source_id,source_revision,receipt,created_at)
 values(gen_random_uuid(),'${tenant}'::uuid,'email','${source}'::uuid,
  new_revision,'{"state":"committed","action":"unchanged"}'::jsonb,clock_timestamp());
 if exists(select 1 from public.learn_projection_pending_email_updates('${tenant}'::uuid,10))
 then raise exception 'committed_revision_reselected';end if;
end$$;
rollback;`;
try {
  await query(fixture, false);
} finally {
  const after = await query(`select count(*)::int remaining from public.tenants
   where id='${tenant}'::uuid`, true);
  if (after?.length !== 1 || after[0]?.remaining !== 0)
    throw Error("TEST rollback preservation unconfirmed");
}
console.log(JSON.stringify({ state: "email_receipt_window_test_verified",
  project: TEST_PROJECT, changedRevisionSelected: true,
  exactHoldSkipped: true, changedHoldReentered: true,
  metadataOnlyUpdateSelected: true, unchangedReceiptAdvances: true,
  rollbackVerified: true, syntheticOnly: true,
  productionDataWrites: false, providerRequests: 0 }));
