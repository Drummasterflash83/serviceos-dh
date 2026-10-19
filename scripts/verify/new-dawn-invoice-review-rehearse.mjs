/** Rollback-only TEST install and boundary check. No provider request or persistent write. */
import {readFileSync} from 'node:fs';
import {savedCliToken,TEST_PROJECT} from './learn-test-readiness.mjs';

export function rehearsalSql(){
  const migration=readFileSync(new URL('../../supabase/migrations/20261108110000_new_dawn_invoice_review_candidates.sql',import.meta.url),'utf8');
  if(!/\nbegin;\n/i.test(migration)||!/\ncommit;\s*$/i.test(migration)) throw Error('Migration wrapper changed');
  const body=migration.replace(/\nbegin;\n/i,'\n').replace(/\ncommit;\s*$/i,'\n');
  return `begin;
set local lock_timeout='5s';
set local statement_timeout='45s';
${body}
do $verify$
declare tenant uuid; actor uuid; def text; app_id uuid:='decccccc-0000-4000-8000-000000000001';
 connection_id uuid:='decccccc-0000-4000-8000-000000000002';
 realm text:='9876543210123456789'; source_id text; version_id uuid;
 payload jsonb; source_updated timestamptz; observed timestamptz; got jsonb; i integer;
begin
 if has_function_privilege('anon','public.new_dawn_invoice_review_candidates(uuid,text)','EXECUTE')
  or has_function_privilege('service_role','public.new_dawn_invoice_review_candidates(uuid,text)','EXECUTE')
  or not has_function_privilege('authenticated','public.new_dawn_invoice_review_candidates(uuid,text)','EXECUTE') then
  raise exception 'invoice_review_grant_boundary_failed';end if;
 select pg_get_functiondef('public.new_dawn_invoice_review_candidates(uuid,text)'::regprocedure) into def;
 if position('not l.conflicted' in def)=0
  or position('v.tenant_id=l.tenant_id' in def)=0
  or position('v.realm_id=l.realm_id' in def)=0
  or position('v.external_id=l.external_id' in def)=0
  or position('source_updated_at>=read_at' in def)=0
  or position('last_observed_at>=read_at' in def)=0 then
  raise exception 'invoice_review_source_guard_missing';end if;
 select id into tenant from public.tenants where status='active' order by id limit 1;
 select g.profile_id into actor from public.platform_authority_grants g
  join public.profiles p on p.id=g.profile_id join auth.users u on u.id=p.id
  where g.permission='platform.controlplane.admin' and u.deleted_at is null
   and (u.banned_until is null or u.banned_until<=clock_timestamp())
   and coalesce(g.effective_from,'-infinity')<=clock_timestamp()
   and coalesce(g.effective_to,'infinity')>clock_timestamp()
   and not exists(select 1 from public.view_as_context x where x.actor_user_id=g.profile_id
    and x.ended_at is null and (x.expires_at is null or x.expires_at>clock_timestamp()))
  order by g.profile_id limit 1;
 if tenant is null or actor is null then raise exception 'invoice_review_fixture_unavailable';end if;
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claim.sub',actor::text,true);
 begin
  perform public.new_dawn_invoice_review_candidates(tenant,'Synthetic default-off denial');
  raise exception 'invoice_review_flag_off_allowed';
 exception when sqlstate '42501' then
  if sqlerrm<>'invoice_review_disabled' then raise;end if;
 end;
 insert into public.learn_quickbooks_apps(id,environment,client_id,redirect_uri,client_secret_id)
 values(app_id,'production','synthetic_invoice_rehearsal','https://test.openfolk.ai/rollback-only',gen_random_uuid());
 insert into public.learn_quickbooks_connections(id,tenant_id,environment,app_id,realm_id,
  status,created_by,confirmed_at,confirmed_by)
 values(connection_id,tenant,'production',app_id,realm,'paused',actor,clock_timestamp(),actor);
 for i in 1..7 loop
  source_id:=(900000+i)::text;version_id:=gen_random_uuid();
  source_updated:=case when i=6 then clock_timestamp()-interval '35 days'
   else clock_timestamp()-interval '1 day' end;
  observed:=case when i=5 then clock_timestamp()-interval '8 days'
   else clock_timestamp()-interval '1 hour' end;
  payload:=jsonb_build_object('Id',source_id,'Balance',
   case when i=3 then 0::numeric when i=7 then -5::numeric else 10.25::numeric end,
   'CurrencyRef',jsonb_build_object('value','GBP'),'DocNumber','SYNTH-'||i::text);
  if i<>4 then payload:=payload||jsonb_build_object('DueDate',
   ((clock_timestamp() at time zone 'UTC')::date-5)::text);end if;
  insert into public.learn_quickbooks_source_versions(id,tenant_id,environment,realm_id,
   entity,external_id,content_hash,payload,sync_token,source_updated_at)
  values(version_id,tenant,'production',realm,'Invoice',source_id,repeat(chr(96+i),64),
   payload,1,source_updated);
  insert into public.learn_quickbooks_latest(tenant_id,environment,realm_id,entity,
   external_id,version_id,sync_token,source_updated_at,conflicted,last_observed_at)
  values(tenant,'production',realm,'Invoice',source_id,version_id,1,source_updated,i=2,observed);
 end loop;
 update public.feature_flags set value='true'::jsonb
  where tenant_id=tenant and flag='new_dawn.invoice_review_candidates_preview';
 if not found then insert into public.feature_flags(tenant_id,flag,value)
  values(tenant,'new_dawn.invoice_review_candidates_preview','true'::jsonb);end if;
 got:=public.new_dawn_invoice_review_candidates(tenant,'Synthetic saved invoice review');
 if got->>'audience'<>'openfolk_operator_only' or got->>'realm_id'<>realm
  or got->>'currency'<>'GBP' or got->>'eligible_count'<>'1'
  or jsonb_array_length(got->'candidates')<>1
  or got#>>'{candidates,0,invoice_id}'<>'900001'
  or got#>>'{candidates,0,balance}'<>'10.25'
  or got#>>'{candidates,0,source_updated_at}' is null
  or got#>>'{candidates,0,source_observed_at}' is null
  or not exists(select 1 from public.learn_quickbooks_finance_events
   where id=(got->>'audit_id')::uuid and event='invoice.review_candidates_read'
    and actor_id=actor and detail->>'eligible_count'='1') then
  raise exception 'invoice_review_synthetic_filter_failed';end if;
 begin
  perform public.new_dawn_invoice_review_candidates('00000000-0000-0000-0000-000000000099'::uuid,
   'Synthetic cross-tenant denial');
  raise exception 'invoice_review_cross_tenant_allowed';
 exception when sqlstate '42501' then null;end;
end $verify$;
select 'new-dawn-invoice-review/1' as marker;
rollback;`;
}

export async function rehearse(fetcher=fetch,token=savedCliToken()){
  const response=await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query`,{
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:rehearsalSql()}),redirect:'error',signal:AbortSignal.timeout(60_000),
  });
  if(!response.ok){
    const problem=await response.json().catch(()=>null);
    const code=typeof problem?.code==='string'&&/^[A-Z0-9]{5}$/.test(problem.code)?problem.code:'unknown';
    const detail=typeof problem?.message==='string'?problem.message.replace(/[^A-Za-z0-9_ .:-]/g,'').slice(0,160):'no public diagnostic';
    throw Error(`TEST rollback invoice review failed (HTTP ${response.status}, SQLSTATE ${code}: ${detail})`);
  }
  const rows=await response.json();
  if(!Array.isArray(rows)||rows.length!==1||rows[0]?.marker!=='new-dawn-invoice-review/1')
    throw Error('TEST rollback invoice review marker missing');
  return {state:'passed_rolled_back',project:TEST_PROJECT,providerRequests:0};
}
if(process.argv[1]&&import.meta.url===new URL(`file://${process.argv[1]}`).href){
  try{console.log(JSON.stringify(await rehearse()));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
