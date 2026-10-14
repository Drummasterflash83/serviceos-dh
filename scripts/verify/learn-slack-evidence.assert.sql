-- Synthetic authenticated reads in one rolled-back isolated transaction.
set local plpgsql.check_asserts=on;set local statement_timeout='30s';
__SOURCE_FIXTURE__
update public.slack_messages s set source_version=v.source_version from public.slack_message_versions v where s.id=pg_temp.sr(112) and v.message_id=s.id;
create function pg_temp.observation(n int) returns void language plpgsql as $$
declare s public.slack_messages%rowtype;oid uuid:=pg_temp.sr(1000+n);iid uuid:=pg_temp.sr(500+n);jid uuid:=pg_temp.sr(900+n);ctx jsonb;
begin
 select * into strict s from public.slack_messages where id=pg_temp.sr(100+n);
 ctx:=jsonb_build_object('version','learn-retained-source-context/1','scope','company_source','attribution','unresolved',
  'tenant_id',s.tenant_id,'interaction_id',iid,'source_id',s.id,'source_version',s.source_version);
 insert into public.interactions(id,tenant_id,source_type,source_connector_id,source_table,source_id,interaction_type,direction,processing_status,body_preview,metadata,occurred_at)
 values(iid,s.tenant_id,'chat','slack','slack_messages',s.id,'slack_message','unknown','identity_review',left(s.message_text,2000),jsonb_build_object('source_version',s.source_version),to_timestamp(s.provider_timestamp::numeric));
 insert into public.intelligence_objects(id,tenant_id,domain,object_type,object_class,subject,status,source_interactions,created_from,attributes)
 values(oid,s.tenant_id,'core','Observation','observation','Synthetic saved request','monitoring',array[iid],'intelligence.ingest_interaction',jsonb_build_object('retained_source_context',ctx));
 insert into public.platform_jobs(id,tenant_id,job_type,job_key,status,payload)values(jid,s.tenant_id,'intelligence.observe','evidence-'||n,'succeeded','{}');
 insert into public.intelligence_ingestions(tenant_id,interaction_id,mapper_version,ingest_key,observe_job_id,observation_id,status)
 values(s.tenant_id,iid,'obs-ingest/2','evidence-'||n,jid,oid,'observed');
 insert into public.learn_observation_receipts(job_id,tenant_id,interaction_id,observation_id,receipt)
 values(jid,s.tenant_id,iid,oid,jsonb_build_object('version','learn-observation-delivery/1','state','committed','tenant_id',s.tenant_id,
  'interaction_id',iid,'observation_id',oid,'job_id',jid,'can_execute',false,'action_ids','[]'::jsonb));
end$$;
select pg_temp.message(n,'{}',n>=63) from generate_series(13,100)n;
-- Current LIVE also prevents creating a new derivation from a tombstone. Keep
-- that stronger prerequisite intact rather than weakening it for this fixture.
select pg_temp.observation(n) from generate_series(1,100)n where n<>10;
do $$begin
 if exists(select 1 from pg_trigger where tgrelid='public.intelligence_objects'::regclass and tgname='slack_withheld_observation_guard') then
  begin perform pg_temp.observation(10);raise exception 'Withheld derivation guard was bypassed';exception when sqlstate 'PT409' then null;end;
 end if;
end$$;
-- One source changed after the saved observation; it must not appear as current.
update public.slack_messages set source_version=repeat('b',64) where id=pg_temp.sr(112);
create temp table evidence_sources_before as select id,md5(to_jsonb(s)::text) h from public.slack_messages s;
create temp table evidence_notes_before as select id,md5(to_jsonb(o)::text) h from public.intelligence_objects o;
set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='caa14000-aaaa-4000-8000-000000000010';set local role authenticated;
do $$declare p jsonb;cur uuid;seen uuid[]:='{}';e jsonb;n int:=0;begin
 loop
  p:=public.learn_slack_evidence_read(pg_temp.sr(1),cur);
  assert jsonb_array_length(p->'rows')<=25 and (p->>'scanned')::int<=50;
  assert p->'operator_mode'='false' and p->'audit_id'='null';
  assert p::text not like '%DO_NOT_RETURN%' and p::text not like '%provider_payload%' and p::text not like '%secret%';
  for e in select * from jsonb_array_elements(p->'rows') loop
   assert e->>'attribution'='unresolved' and not (e->>'id')::uuid=any(seen);
   seen:=array_append(seen,(e->>'id')::uuid);
  end loop;
  cur:=(p->>'next_after')::uuid;n:=n+1;exit when cur is null;assert n<10;
 end loop;
 assert cardinality(seen)=40,'Valid Unicode/public sources plus 38 later records must remain browsable';
 assert not pg_temp.sr(1012)=any(seen),'Edited source exposed';
 begin perform public.learn_slack_evidence_read(pg_temp.sr(2));raise exception 'Foreign tenant admitted';exception when insufficient_privilege then null;end;
end$$;reset role;
-- A whole scan of inaccessible candidates still carries an honest continuation.
set local role authenticated;
do $$declare p jsonb;begin
 p:=public.learn_slack_evidence_read(pg_temp.sr(1),pg_temp.sr(1012));
 assert p->'rows'='[]' and p->>'next_after'=pg_temp.sr(1062)::text and p->>'scanned'='50';
end$$;reset role;
-- Capture pause does not revoke historical read authority.
update public.connector_accounts set status='disabled' where id=pg_temp.sr(22);set local role authenticated;
do $$begin assert jsonb_array_length(public.learn_slack_evidence_read(pg_temp.sr(1))->'rows')>0;end$$;reset role;
-- Revocation withholds source content and no raw fallback is possible.
update public.provider_connections set revoked_at=clock_timestamp() where id=pg_temp.sr(20);set local role authenticated;
do $$begin assert public.learn_slack_evidence_read(pg_temp.sr(1))->'rows'='[]';end$$;reset role;
update public.provider_connections set revoked_at=null where id=pg_temp.sr(20);
update public.profiles set tenant_id=pg_temp.sr(2),role='owner' where id=pg_temp.sr(10);set local role authenticated;
do $$begin assert public.learn_slack_evidence_read(pg_temp.sr(2))->'rows'='[]';
 begin perform public.learn_slack_evidence_read(pg_temp.sr(1));raise exception 'Cross-client owner admitted';exception when insufficient_privilege then null;end;end$$;reset role;
insert into public.platform_authority_grants(profile_id,permission,granted_by,effective_to)values(pg_temp.sr(10),'platform.controlplane.admin','isolated fixture',clock_timestamp()+interval '5 minutes');
set local role authenticated;
do $$declare p jsonb;begin
 p:=public.learn_slack_evidence_read(pg_temp.sr(1),null,'Review selected client evidence');
 assert p->>'audit_id' is not null and p->'operator_mode'='true' and jsonb_array_length(p->'rows')>0;
 begin perform public.learn_slack_evidence_read(pg_temp.sr(1),null,'');raise exception 'Blank reason admitted';exception when invalid_parameter_value then null;end;
end$$;reset role;
create function pg_temp.evidence_audit_fail() returns trigger language plpgsql as $$begin raise exception 'synthetic_evidence_audit_failure';end$$;
create trigger evidence_audit_fail before insert on public.controlplane_change_log for each row execute function pg_temp.evidence_audit_fail();set local role authenticated;
do $$begin begin perform public.learn_slack_evidence_read(pg_temp.sr(1),null,'Audit failure');raise exception 'Unaudited content returned';exception when raise_exception then if sqlerrm<>'synthetic_evidence_audit_failure' then raise;end if;end;end$$;reset role;
drop trigger evidence_audit_fail on public.controlplane_change_log;
update public.platform_authority_grants set effective_to=clock_timestamp()-interval '1 second' where profile_id=pg_temp.sr(10);set local role authenticated;
do $$begin begin perform public.learn_slack_evidence_read(pg_temp.sr(1),null,'Revoked operator');raise exception 'Revoked operator admitted';exception when insufficient_privilege then null;end;end$$;reset role;
do $$begin
 assert not has_function_privilege('anon','public.learn_slack_evidence_read(uuid,uuid,text)','execute');
 assert not has_function_privilege('service_role','public.learn_slack_evidence_read(uuid,uuid,text)','execute');
 assert not exists(select 1 from evidence_sources_before b join public.slack_messages s using(id) where b.h<>md5(to_jsonb(s)::text));
 assert not exists(select 1 from evidence_notes_before b join public.intelligence_objects o using(id) where b.h<>md5(to_jsonb(o)::text));
end$$;
