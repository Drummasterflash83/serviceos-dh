/** Adapt the same behavioral assertions to the complete hosted TEST schema.
 * The caller MUST enclose this probe in a rolled-back transaction/savepoint.
 * No identities, credentials, provider requests or persistent fixtures are created. */
import { readFileSync } from 'node:fs';
export function phoneProcessingHostedProbe() {
  let sql = readFileSync('scripts/verify/learn-phone-derived-attempts.assert.sql', 'utf8');
  const replaceOnce = (from, to) => {
    if (sql.split(from).length !== 2) throw Error('Phone assertion adapter changed; inspect explicitly');
    sql = sql.replace(from, to);
  };
  replaceOnce('insert into tenants(id) values(fixture_id(1)),(fixture_id(2));',
    `insert into tenants(id,slug,display_name,metadata)
     select fixture_id(n),'phone-processing-rollback-'||n,'Synthetic Phone rollback probe',
     '{"synthetic":true,"purpose":"phone-processing-rollback-probe"}'::jsonb from generate_series(1,2)n;`);
  replaceOnce("insert into feature_flags values(fixture_id(1),'learn.inputs.phone.enabled','false');",
    "insert into feature_flags(tenant_id,flag,value) values(fixture_id(1),'learn.inputs.phone.enabled','false');");
  // The offline fixture contains no other flags. The hosted database does.
  sql = sql.replace(/update feature_flags set value='(true|false)';/g,
    "update feature_flags set value='$1' where tenant_id=fixture_id(1) and flag='learn.inputs.phone.enabled';");
  sql = sql.replace(/\bfixture_(id|derived|derived_failure|intelligence_output|identity_failure)\(/g, 'pg_temp.fixture_$1(');
  // TEST revokes default function EXECUTE. Grant the existing service role only
  // the temporary assertion helpers; these grants disappear with the rollback.
  sql = sql.replace(/set role service_role;/g, `do $grant_probe$declare fn record;begin
    for fn in select p.oid::regprocedure as signature from pg_proc p
      where p.pronamespace=pg_my_temp_schema() and p.proname like 'fixture_%'
    loop execute format('grant execute on function %s to service_role',fn.signature);end loop;
  end $grant_probe$;set local role service_role;`);
  // Assertion SELECTs contain only literal PASS strings; keep one aggregate marker
  // from the enclosing rehearsal, rather than depending on multi-result API behavior.
  sql = sql.replace(/^select 'PASS:[^\n]*';$/gm, '');
  return `
set local plpgsql.check_asserts=on;
create function pg_temp.fixture_id(n integer) returns uuid language sql immutable as $$
 select ('fae019ce-714a-4f0f-971b-'||lpad(n::text,12,'0'))::uuid;
$$;
do $$begin
 if exists(select 1 from public.tenants where id in(pg_temp.fixture_id(1),pg_temp.fixture_id(2)))
 then raise exception 'Synthetic rollback identities already present';end if;
end$$;
${sql}
-- Exercise the exact attribution-loader projections under the deployed role.
-- LIMIT 0 validates authority/columns without returning any retained source data.
set local role service_role;
do $$begin
 perform id,recording_id,transcript_text from public.phone_transcripts limit 0;
 perform id,tenant_id,recording_id,created_at from public.phone_ai_insights limit 0;
 perform extension,e164_number,endpoint_ref,person_node_id,role,is_shared_device,
   confidence,source,metadata,tenant_id,active from public.telephony_directory limit 0;
 perform term,category,aliases,phonetic_variants,confidence,tenant_id,active from public.tenant_vocabulary limit 0;
 perform id,from_number,to_number,direction,raw_payload,tenant_id,provider_call_id,linked_id,started_at from public.phone_calls limit 0;
 perform related_person_id,related_company_id,tenant_id,source_table,source_id from public.interactions limit 0;
 perform id,label,node_type,tenant_id from public.graph_nodes limit 0;
 perform id,display_name from public.tenants limit 0;
end$$;
reset role;
`;
}
