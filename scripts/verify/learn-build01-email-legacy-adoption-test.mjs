/** Rollback-only hosted TEST rehearsal of the exact legacy Email migration. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';

const mode = process.argv.slice(2).join(' ');
if (!['--test-rollback-only', '--test-installed-rollback-only'].includes(mode) ||
    process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT)
  throw Error('Exact TEST rollback-only mode required');
const tenant = '00000000-0000-0000-0000-000000000001';
const sourceIds = Array.from({ length: 3 }, () => randomUUID());
const interactionIds = Array.from({ length: 3 }, () =>
  `00000000-0000-4000-8000-${randomUUID().replaceAll('-', '').slice(0, 12)}`).sort();
const migration = readFileSync(new URL('../../supabase/migrations/20261104223000_learn_email_legacy_equivalent_adoption.sql', import.meta.url), 'utf8');
assert(migration.startsWith('-- One-time Drummonds adoption'));
assert(/\nbegin;\n/.test(migration) && /\ncommit;\n$/.test(migration));
const body = mode === '--test-rollback-only' ?
  migration.replace(/\nbegin;\n/, '\n').replace(/\ncommit;\n$/, '\n') : '';
const values = sourceIds.map((id, n) =>
  `('${id}'::uuid,'${tenant}'::uuid,'gmail','synthetic-${id}',now()-interval '1 day',now()-interval '1 day',
   'synthetic@example.invalid','[]'::jsonb,'Synthetic Email ${n}','Synthetic only','inbound','{}'::jsonb)`).join(',\n');
const associations = sourceIds.map((id, n) =>
  `('${id}'::uuid,'${interactionIds[n]}'::uuid,${n === 2 ? "'email'" : "'google-workspace'"})`).join(',\n');
const sql = `begin;
${body}
insert into public.tenants(id,slug,display_name)
 values('${tenant}'::uuid,'synthetic-legacy-${randomUUID().slice(0, 8)}','Synthetic legacy Email fixture');
insert into public.email_messages(id,tenant_id,provider,provider_message_id,
 received_at,created_at,from_email,to_emails,subject,snippet,direction,raw_payload)
 values ${values};
with a(source_id,interaction_id,connector) as (values ${associations})
insert into public.interactions(id,tenant_id,source_connector_id,source_type,
 source_table,source_id,source_external_id,interaction_type,direction,occurred_at,
 subject,summary,body_preview,from_address,from_name,to_addresses,cc_addresses,
 related_thread_id,processing_status,metadata)
select a.interaction_id,'${tenant}'::uuid,a.connector,'email','email_messages',m.id,
 m.provider_message_id,'email_message','inbound',m.received_at,m.subject,null,m.snippet,
 m.from_email,m.from_name,array(select jsonb_array_elements_text(m.to_emails)),
 array(select jsonb_array_elements_text(m.cc_emails)),m.provider_thread_id,'ready','{}'::jsonb
from a join public.email_messages m on m.id=a.source_id;
update public.interactions set subject='Different manual subject'
 where id='${interactionIds[1]}'::uuid;
do $test$ declare result jsonb; same jsonb; changed jsonb; revision text;
begin
 result:=public.learn_email_adopt_equivalent_legacy('${tenant}'::uuid,null,50);
 if (result->>'adopted')::int<>2 then raise exception 'equivalent_adoption_count_changed: %',result->>'adopted';end if;
 if (select count(*) from public.interactions where id=any(array[
  '${interactionIds[0]}'::uuid,'${interactionIds[2]}'::uuid]) and metadata?'source_projection')<>2
 then raise exception 'equivalent_projection_metadata_missing';end if;
 if (select metadata?'source_projection' from public.interactions where id='${interactionIds[1]}'::uuid)
 then raise exception 'different_interaction_adopted';end if;
 if (select source_connector_id from public.interactions where id='${interactionIds[0]}'::uuid)<>'google-workspace'
 then raise exception 'legacy_connector_label_changed';end if;
 if (select subject from public.interactions where id='${interactionIds[1]}'::uuid)<>'Different manual subject'
 then raise exception 'manual_subject_changed';end if;
 if (select count(*) from public.learn_interaction_projection_receipts
  where source_id=any(array['${sourceIds[0]}'::uuid,'${sourceIds[1]}'::uuid,'${sourceIds[2]}'::uuid]))<>2
 then raise exception 'adoption_receipt_count_changed';end if;
 select public.learn_projection_revision(public.learn_email_source_fields(m),'') into revision
  from public.email_messages m where id='${sourceIds[0]}'::uuid;
 same:=public.learn_project_interaction('${tenant}'::uuid,gen_random_uuid(),'email',
  '${sourceIds[0]}'::uuid,revision,'publish');
 if same->>'state'<>'committed' or same->>'action'<>'unchanged'
 then raise exception 'equivalent_same_revision_not_unchanged';end if;
 update public.email_messages set subject='Changed synthetic source'
  where id='${sourceIds[0]}'::uuid;
 select public.learn_projection_revision(public.learn_email_source_fields(m),'') into revision
  from public.email_messages m where id='${sourceIds[0]}'::uuid;
 changed:=public.learn_project_interaction('${tenant}'::uuid,gen_random_uuid(),'email',
  '${sourceIds[0]}'::uuid,revision,'publish');
 if changed->>'state'<>'review_required' or changed->>'reason'<>'legacy_projection_review'
 then raise exception 'changed_alias_not_held';end if;
 if (select source_connector_id from public.interactions where id='${interactionIds[0]}'::uuid)<>'google-workspace'
 then raise exception 'changed_alias_overwritten';end if;
end $test$;
select jsonb_build_object('synthetic_adopted',2,'mismatch_skipped',true,
 'same_revision_unchanged',true,'future_alias_change_held',true,
 'rollback_only',true) result;
rollback;`;
const response = await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query`, {
  method: 'POST', redirect: 'error', signal: AbortSignal.timeout(85000),
  headers: { Authorization: `Bearer ${savedCliToken()}`,
    'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql, read_only: false }),
});
if (!response.ok) {
  const error = await response.json().catch(() => ({}));
  throw Error(`TEST rollback rehearsal HTTP ${response.status}: ${String(error.message ?? error.code ?? '').slice(0, 500)}`);
}
const result = await response.json();
assert(Array.isArray(result) && result.length === 1 && result[0]?.result?.rollback_only === true);
const check = await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query/read-only`, {
  method: 'POST', redirect: 'error', signal: AbortSignal.timeout(35000),
  headers: { Authorization: `Bearer ${savedCliToken()}`,
    'Content-Type': 'application/json' },
  body: JSON.stringify({ query: `select count(*)::int rows_remaining from public.tenants where id='${tenant}'::uuid` }),
});
if (!check.ok) throw Error(`TEST rollback check HTTP ${check.status}`);
const rows = await check.json();
assert(rows?.[0]?.rows_remaining === 0, 'Synthetic tenant remained after rollback');
console.log(JSON.stringify({ state: 'legacy_email_adoption_test_verified', project: TEST_PROJECT,
  ...result[0].result, synthetic_rows_remaining: 0, production_data_writes: false }));
