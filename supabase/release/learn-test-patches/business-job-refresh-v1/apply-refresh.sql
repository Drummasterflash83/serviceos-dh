begin;set local lock_timeout='5s';set local statement_timeout='30s';
do $release_guard$ begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy' or current_setting('serviceos.release_sha256',true) is distinct from '2441325c79dc575647fd567e42123f337270b2de5002b25a77f29b741cf38e4a' then raise exception 'Exact job refresh release target/source/role required';end if;
 if (select md5(pg_get_functiondef(oid))='a25a68be9299c292927072d5808dd4f0' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres}' from pg_proc where oid='public.learn_business_input_review_access(uuid,uuid)'::regprocedure) is not true then raise exception 'Job refresh prerequisite differs: learn_business_input_review_access';end if;
 if (select md5(pg_get_functiondef(oid))='7ddecc80b1969c17cdfcee8293c5b11c' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres}' from pg_proc where oid='public.learn_business_input_time_detail(jsonb)'::regprocedure) is not true then raise exception 'Job refresh prerequisite differs: learn_business_input_time_detail';end if;
 if (select md5(pg_get_functiondef(oid))='c9c46bc594b5008a9642bbcaa09d7e06' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres,learn_card_communication_reader=X/postgres}' from pg_proc where oid='public.learn_card_slack_job_context(uuid,uuid,uuid)'::regprocedure) is not true then raise exception 'Job refresh prerequisite differs: learn_card_slack_job_context';end if;
 if (select md5(pg_get_functiondef(oid))='84fc396441209fec479204f7c44a14d8' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres,authenticated=X/postgres}' from pg_proc where oid='public.learn_commusoft_confirm_work_record(uuid,uuid,uuid,text)'::regprocedure) is not true then raise exception 'Job refresh prerequisite differs: learn_commusoft_confirm_work_record';end if;
 if (select md5(pg_get_functiondef(oid))='7bfcf0fbaa474082cd5d0bca92e7a56f' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres}' from pg_proc where oid='public.learn_commusoft_property_owner(uuid,uuid,text,boolean)'::regprocedure) is not true then raise exception 'Job refresh prerequisite differs: learn_commusoft_property_owner';end if;
 if (select md5(pg_get_functiondef(oid))='0245d7c999f4393a42c58578d101085c' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres,authenticated=X/postgres}' from pg_proc where oid='public.learn_commusoft_work_review_page(uuid,uuid,text,text,integer)'::regprocedure) is not true then raise exception 'Job refresh prerequisite differs: learn_commusoft_work_review_page';end if;
 if (select md5(pg_get_functiondef(oid))='b488b788541a41110f485b04cb72febe' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres,authenticated=X/postgres}' from pg_proc where oid='public.learn_commusoft_work_review_search(uuid,uuid,text,text,text,integer)'::regprocedure) is not true then raise exception 'Job refresh prerequisite differs: learn_commusoft_work_review_search';end if;
 if (select md5(pg_get_functiondef(oid))='0aca3dac49b265d26a51034b00a7ce12' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres,authenticated=X/postgres}' from pg_proc where oid='public.learn_customer_business_context(uuid,uuid,text,uuid,text)'::regprocedure) is not true then raise exception 'Job refresh prerequisite differs: learn_customer_business_context';end if;
 if (select md5(pg_get_functiondef(oid))='c6a8d25c80288fd65a0b602750ef99ac' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres,authenticated=X/postgres}' from pg_proc where oid='public.openfolk_business_review(uuid,text,text,jsonb)'::regprocedure) is not true then raise exception 'Job refresh prerequisite differs: openfolk_business_review';end if;
 if to_regclass('public.learn_business_input_refreshes') is not null then raise exception 'Refresh objects already present; inspect before retry';end if;
 if to_regclass('public.learn_business_input_current_links') is not null then raise exception 'Refresh objects already present; inspect before retry';end if;
 if to_regclass('public.learn_business_input_refresh_cancellations') is not null then raise exception 'Refresh objects already present; inspect before retry';end if;
 if to_regprocedure('public.learn_commusoft_job_fields(jsonb,text)') is not null then raise exception 'Refresh functions already present; inspect before retry';end if;
 if to_regprocedure('public.learn_commusoft_job_refresh_plan(uuid,uuid)') is not null then raise exception 'Refresh functions already present; inspect before retry';end if;
 if to_regprocedure('public.learn_commusoft_job_refresh(uuid,uuid,uuid,uuid,text,text,text)') is not null then raise exception 'Refresh functions already present; inspect before retry';end if;
end $release_guard$;
-- Append-only revisions of reviewed business projections. Source history and
-- original identity links remain immutable. No refresh occurs on installation.
create table public.learn_business_input_refreshes (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,
 request_id uuid not null,link_id uuid not null references public.learn_business_input_links(id) on delete restrict,
 revision integer not null check(revision>0),actor_id uuid not null,
 previous_version_id uuid not null references public.learn_business_input_versions(id) on delete restrict,
 source_version_id uuid not null references public.learn_business_input_versions(id) on delete restrict,
 definition jsonb not null,before_record jsonb not null,after_record jsonb not null,
 receipt jsonb not null,created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,request_id),unique(link_id,revision)
);
alter table public.learn_business_input_refreshes enable row level security;
revoke all on public.learn_business_input_refreshes from public,anon,authenticated,service_role;
create trigger retain_rows before update or delete on public.learn_business_input_refreshes
 for each row execute function public.learn_business_input_retain();
create trigger retain_all before truncate on public.learn_business_input_refreshes
 for each statement execute function public.learn_business_input_retain();
-- Same columns as the immutable initial links. Only the effective source version
-- advances; actor/request/created_at still identify the initial identity review.
create view public.learn_business_input_current_links as
 select l.id,l.tenant_id,l.connection_id,l.provider,l.collection,l.external_id,
  coalesce(r.source_version_id,l.source_version_id) source_version_id,
  l.entity_kind,l.entity_table,l.entity_id,l.card_id,l.request,l.actor_id,l.created_at
 from public.learn_business_input_links l left join lateral(
  select x.source_version_id from public.learn_business_input_refreshes x
  where x.tenant_id=l.tenant_id and x.link_id=l.id order by x.revision desc limit 1
 )r on true;
revoke all on public.learn_business_input_current_links from public,anon,authenticated,service_role;
grant select on public.learn_business_input_current_links to learn_card_communication_reader;

-- Reuse the installed timestamp classifier; unzoned times remain evidence only.
create function public.learn_commusoft_job_fields(p_payload jsonb,p_external text)
returns jsonb language plpgsql stable set search_path=pg_catalog as $$
declare k text;detail jsonb;times jsonb:='{}';created timestamptz;completed timestamptz;state text;description text;
begin
 if jsonb_typeof(p_payload->'id') is distinct from 'number' or p_payload->>'id' is distinct from p_external
  then return jsonb_build_object('state','held','reason','source_identity_invalid');end if;
 if jsonb_typeof(p_payload->'status') is distinct from 'string' or p_payload->>'status' not in ('Open','Complete','Closed','ongoing','completed','on_hold','pending')
  then return jsonb_build_object('state','held','reason','job_status_unrecognised');end if;
 if p_payload ? 'description' and p_payload->'description'<>'null'::jsonb
  and (jsonb_typeof(p_payload->'description')<>'string' or length(p_payload->>'description')>1000)
  then return jsonb_build_object('state','held','reason','job_field_invalid');end if;
 if p_payload ? 'completed' and p_payload->'completed'<>'null'::jsonb and jsonb_typeof(p_payload->'completed')<>'object'
  then return jsonb_build_object('state','held','reason','job_timestamp_invalid');end if;
 foreach k in array array['created','completed'] loop
  detail:=public.learn_business_input_time_detail(case when k='created' then p_payload->'createdOnDateTime' else p_payload->'completed'->'completedOnDateTime' end);
  if detail->>'state'='invalid' then return jsonb_build_object('state','held','reason','job_timestamp_invalid');end if;
  if detail->>'state'='zoned' then
   if k='created' then created:=(detail->>'instant')::timestamptz;else completed:=(detail->>'instant')::timestamptz;end if;
  end if;
  times:=times||jsonb_build_object(k,detail);
 end loop;
 state:=case p_payload->>'status' when 'Open' then 'open' when 'ongoing' then 'open' when 'Complete' then 'completed' when 'completed' then 'completed' when 'Closed' then 'closed' else p_payload->>'status' end;
 description:=public.learn_business_input_text(p_payload,'description');
 return jsonb_build_object('state','ready','fields',jsonb_build_object('title',coalesce(description,'Job '||p_external),
  'description',description,'status',state,'created_date',created,'completed_date',completed),'timestamps',times);
end$$;
revoke all on function public.learn_commusoft_job_fields(jsonb,text) from public,anon,authenticated,service_role;

create function public.learn_commusoft_job_refresh_plan(p_tenant uuid,p_link uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare l public.learn_business_input_links%rowtype;old public.learn_business_input_versions%rowtype;
 v public.learn_business_input_versions%rowtype;j public.jobs%rowtype;
 parent text;owner jsonb;prior jsonb;next jsonb;fields jsonb;revision text;result jsonb;
begin
 perform public.learn_business_input_review_access(p_tenant);
 select * into l from public.learn_business_input_current_links where tenant_id=p_tenant and id=p_link
  and provider='commusoft' and collection='jobs' and entity_kind='job' and entity_table='jobs';
 if not found then raise exception 'business_refresh_link_unavailable' using errcode='42501';end if;
 perform public.learn_business_input_review_access(p_tenant,l.connection_id);
 select * into j from public.jobs where tenant_id=p_tenant and id=l.entity_id;
 if not found then raise exception 'business_refresh_job_unavailable' using errcode='42501';end if;
 select * into old from public.learn_business_input_versions where tenant_id=p_tenant and id=l.source_version_id
  and connection_id=l.connection_id and provider=l.provider and collection=l.collection and external_id=l.external_id;
 v:=public.learn_business_input_latest(p_tenant,l.connection_id,l.provider,l.collection,l.external_id);
 result:=jsonb_build_object('version','learn-business-refresh/1','tenant_id',p_tenant,'link_id',l.id,'job_id',j.id,
  'previous_version_id',l.source_version_id,'source_version_id',v.id,'job_number',j.job_number);
 if old.id is null or v.id is null then return result||jsonb_build_object('state','held','reason','source_changed_or_ambiguous');end if;
 if v.id=old.id then return result||jsonb_build_object('state','current');end if;
 parent:=v.payload->>'propertyID';
 if jsonb_typeof(v.payload->'propertyID') is distinct from 'number' or parent!~'^[1-9][0-9]{0,15}$'
  or parent::numeric>9007199254740991 or old.payload->'propertyID' is distinct from v.payload->'propertyID'
  then return result||jsonb_build_object('state','held','reason','source_owner_changed');end if;
 owner:=public.learn_commusoft_property_owner(p_tenant,l.connection_id,parent,true);
 if owner->>'state' is distinct from 'ready' then return result||jsonb_build_object('state','held','reason',owner->>'reason');end if;
 if j.customer_person_id is distinct from (owner->>'person_id')::uuid or j.customer_company_id is distinct from (owner->>'company_id')::uuid
  or j.site_id is distinct from (owner->>'site_id')::uuid or l.card_id is distinct from (owner->>'card_id')::uuid
  then return result||jsonb_build_object('state','held','reason','canonical_owner_changed');end if;
 if j.source_system is distinct from 'commusoft:connection:'||l.connection_id::text or j.external_id is distinct from l.external_id
  or j.job_number is distinct from l.external_id or j.metadata#>>'{learn_business_input,connection_id}' is distinct from l.connection_id::text
  or j.metadata#>>'{learn_business_input,source_version_id}' is distinct from old.id::text
  or j.metadata#>>'{learn_business_input,property_external_id}' is distinct from parent
  then return result||jsonb_build_object('state','held','reason','canonical_source_changed');end if;
 prior:=public.learn_commusoft_job_fields(old.payload,l.external_id);next:=public.learn_commusoft_job_fields(v.payload,l.external_id);
 if prior->>'state'<>'ready' or next->>'state'<>'ready' then return result||jsonb_build_object('state','held','reason',case when prior->>'state'<>'ready' then prior->>'reason' else next->>'reason' end);end if;
 fields:=jsonb_build_object('title',j.title,'description',j.description,'status',j.status,'created_date',j.created_date,'completed_date',j.completed_date);
 if fields is distinct from prior->'fields' or j.metadata#>'{learn_business_input,timestamps}' is distinct from prior->'timestamps'
  then return result||jsonb_build_object('state','held','reason','local_fields_changed');end if;
 revision:=md5(jsonb_build_object('job',to_jsonb(j),'previous',old.id,'source',v.id,'owner',owner)::text);
 return result||jsonb_build_object('state','ready','revision',revision,'before',fields,'after',next->'fields',
  'timestamps',next->'timestamps','changed_fields',(select coalesce(jsonb_agg(key order by key),'[]'::jsonb)
   from jsonb_each(next->'fields') where value is distinct from fields->key),
  'timing_limitations',(select coalesce(jsonb_agg(key order by key),'[]'::jsonb) from jsonb_each(next->'timestamps') where value->>'state'='timezone_required'));
end$$;
revoke all on function public.learn_commusoft_job_refresh_plan(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_commusoft_job_refresh_plan(uuid,uuid) to authenticated;

create function public.learn_commusoft_job_refresh(p_tenant uuid,p_request uuid,p_link uuid,p_source uuid,p_revision text,p_reason text,p_action text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare l public.learn_business_input_links%rowtype;saved public.learn_business_input_refreshes%rowtype;
 j public.jobs%rowtype;after_job public.jobs%rowtype;plan jsonb;definition jsonb;receipt jsonb;next_revision integer;
begin
 perform public.learn_business_input_review_access(p_tenant);
 if p_request is null or p_link is null or p_source is null or p_revision is null or p_revision!~'^[a-f0-9]{32}$'
  or p_reason is null or length(btrim(p_reason)) not between 3 and 1000 or p_action is null or p_action not in ('check','apply')
  then raise exception 'business_refresh_request_invalid' using errcode='22023';end if;
 definition:=jsonb_build_object('link_id',p_link,'source_version_id',p_source,'revision',p_revision,'reason',btrim(p_reason),'actor_id',auth.uid());
 select * into l from public.learn_business_input_links where tenant_id=p_tenant and id=p_link
  and provider='commusoft' and collection='jobs' and entity_kind='job' and entity_table='jobs';
 if not found then raise exception 'business_refresh_link_unavailable' using errcode='42501';end if;
 perform public.learn_business_input_review_access(p_tenant,l.connection_id);
 perform 1 from public.provider_connections where tenant_id=p_tenant and id=l.connection_id for update;
 select * into saved from public.learn_business_input_refreshes where tenant_id=p_tenant and request_id=p_request;
 if found then
  if saved.definition is distinct from definition then raise exception 'business_refresh_request_conflict' using errcode='PT409';end if;
  return saved.receipt;
 end if;
 if p_action='check' then return jsonb_build_object('state','pending','request_id',p_request);end if;
 select * into j from public.jobs where tenant_id=p_tenant and id=l.entity_id for update;
 if not found then raise exception 'business_refresh_job_unavailable' using errcode='42501';end if;
 plan:=public.learn_commusoft_job_refresh_plan(p_tenant,p_link);
 if plan->>'state' is distinct from 'ready' or plan->>'revision' is distinct from p_revision or plan->>'source_version_id' is distinct from p_source::text
  then raise exception 'business_refresh_plan_changed' using errcode='PT409';end if;
 select coalesce(max(revision),0)+1 into next_revision from public.learn_business_input_refreshes where tenant_id=p_tenant and link_id=p_link;
 update public.jobs set title=plan#>>'{after,title}',description=plan#>>'{after,description}',status=plan#>>'{after,status}',
  created_date=(plan#>>'{after,created_date}')::timestamptz,completed_date=(plan#>>'{after,completed_date}')::timestamptz,
  metadata=jsonb_set(jsonb_set(metadata,'{learn_business_input,source_version_id}',to_jsonb(p_source::text)),
   '{learn_business_input,timestamps}',plan->'timestamps')
 where tenant_id=p_tenant and id=j.id returning * into after_job;
 receipt:=jsonb_build_object('version','learn-business-refresh/1','state','committed','tenant_id',p_tenant,'request_id',p_request,
  'link_id',p_link,'job_id',j.id,'source_version_id',p_source,'previous_version_id',plan->'previous_version_id',
  'revision',next_revision,'changed_fields',plan->'changed_fields','timing_limitations',plan->'timing_limitations');
 insert into public.learn_business_input_refreshes(tenant_id,request_id,link_id,revision,actor_id,previous_version_id,source_version_id,definition,before_record,after_record,receipt)
  values(p_tenant,p_request,p_link,next_revision,auth.uid(),(plan->>'previous_version_id')::uuid,p_source,definition,to_jsonb(j),to_jsonb(after_job),receipt);
 perform public.learn_business_input_review_access(p_tenant,l.connection_id);
 return receipt;
end$$;
revoke all on function public.learn_commusoft_job_refresh(uuid,uuid,uuid,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_commusoft_job_refresh(uuid,uuid,uuid,uuid,text,text,text) to authenticated;

-- Only readers of the effective published version change. Insertions and immutable
-- initial-review receipts continue to use learn_business_input_links.
do $$declare signature text;d text;needle text;replacement text;begin
 foreach signature in array array[
  'public.learn_card_slack_job_context(uuid,uuid,uuid)',
  'public.learn_customer_business_context(uuid,uuid,text,uuid,text)',
  'public.learn_commusoft_work_review_page(uuid,uuid,text,text,integer)',
  'public.learn_commusoft_work_review_search(uuid,uuid,text,text,text,integer)'
 ] loop
  d:=pg_get_functiondef(signature::regprocedure);
  if position('public.learn_business_input_links' in d)=0 then raise exception 'Refresh reader baseline differs: %',signature;end if;
  execute replace(d,'learn_business_input_links','learn_business_input_current_links');
 end loop;
 d:=pg_get_functiondef('public.learn_commusoft_confirm_work_record(uuid,uuid,uuid,text)'::regprocedure);
 needle:='select * into l from public.learn_business_input_links where';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Refresh work writer baseline differs';end if;
 execute replace(d,needle,'select * into l from public.learn_business_input_current_links where');
 d:=pg_get_functiondef('public.openfolk_business_review(uuid,text,text,jsonb)'::regprocedure);
 needle:=$old$  when 'learn_commusoft_job_details' then array['p_tenant','p_connection','p_version']$old$;
 replacement:=needle||E'\n'||$new$  when 'learn_commusoft_job_refresh_plan' then array['p_tenant','p_link']
  when 'learn_commusoft_job_refresh' then array['p_tenant','p_request','p_link','p_source','p_revision','p_reason','p_action']$new$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Refresh operator actions differ';end if;
 d:=replace(d,needle,replacement);
 needle:=$old$  when 'learn_commusoft_job_details' then result:=public.learn_commusoft_job_details(p_tenant,(p_args->>'p_connection')::uuid,(p_args->>'p_version')::uuid);$old$;
 replacement:=needle||E'\n'||$new$  when 'learn_commusoft_job_refresh_plan' then result:=public.learn_commusoft_job_refresh_plan(p_tenant,(p_args->>'p_link')::uuid);
  when 'learn_commusoft_job_refresh' then result:=public.learn_commusoft_job_refresh(p_tenant,(p_args->>'p_request')::uuid,(p_args->>'p_link')::uuid,(p_args->>'p_source')::uuid,p_args->>'p_revision',p_args->>'p_reason',p_args->>'p_action');$new$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Refresh operator dispatch differs';end if;
 execute replace(d,needle,replacement);
end$$;
-- Expose the reviewed link identifier only through the existing authorized work
-- readers, enabling a source update to be reviewed against that same identity.
do $$declare signature text;d text;needle text;begin
 foreach signature in array array[
  'public.learn_commusoft_work_review_page(uuid,uuid,text,text,integer)',
  'public.learn_commusoft_work_review_search(uuid,uuid,text,text,text,integer)'
 ]loop
  d:=pg_get_functiondef(signature::regprocedure);
  needle:='''linked_version_id'',l.source_version_id';
  if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Refresh link field baseline differs';end if;
  execute replace(d,needle,'''linked_id'',l.id,'||needle);
 end loop;
end$$;
-- Durable cancellation fences delayed refreshes without changing canonical data.
create table public.learn_business_input_refresh_cancellations (
 tenant_id uuid not null,request_id uuid not null,
 link_id uuid not null references public.learn_business_input_links(id) on delete restrict,
 source_version_id uuid not null references public.learn_business_input_versions(id) on delete restrict,
 actor_id uuid not null,definition jsonb not null,receipt jsonb not null,
 created_at timestamptz not null default clock_timestamp(),primary key(tenant_id,request_id)
);
alter table public.learn_business_input_refresh_cancellations enable row level security;
revoke all on public.learn_business_input_refresh_cancellations from public,anon,authenticated,service_role;
create trigger retain_rows before update or delete on public.learn_business_input_refresh_cancellations
 for each row execute function public.learn_business_input_retain();
create trigger retain_all before truncate on public.learn_business_input_refresh_cancellations
 for each statement execute function public.learn_business_input_retain();
do $$declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.learn_commusoft_job_refresh(uuid,uuid,uuid,uuid,text,text,text)'::regprocedure);
 needle:='j public.jobs%rowtype;after_job public.jobs%rowtype;';
 replacement:=needle||'cancelled public.learn_business_input_refresh_cancellations%rowtype;';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Refresh cancellation declaration differs';end if;
 d:=replace(d,needle,replacement);
 needle:='p_action not in (''check'',''apply'')';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Refresh cancellation action differs';end if;
 d:=replace(d,needle,'p_action not in (''check'',''apply'',''cancel'')');
 needle:=$old$ if p_action='check' then return jsonb_build_object('state','pending','request_id',p_request);end if;$old$;
 replacement:=$new$ select * into cancelled from public.learn_business_input_refresh_cancellations where tenant_id=p_tenant and request_id=p_request;
 if found then
  if cancelled.definition is distinct from definition then raise exception 'business_refresh_request_conflict' using errcode='PT409';end if;
  return cancelled.receipt;
 end if;
 if p_action='check' then return jsonb_build_object('state','pending','request_id',p_request);end if;
 if p_action='cancel' then
  -- Cancellation can retire an obsolete preview, but never bind another tenant,
  -- connection or provider identity into this request's retained evidence.
  perform 1 from public.learn_business_input_versions where tenant_id=p_tenant and id=p_source
   and connection_id=l.connection_id and provider=l.provider and collection=l.collection and external_id=l.external_id;
  if not found then raise exception 'business_refresh_source_unavailable' using errcode='42501';end if;
  receipt:=jsonb_build_object('version','learn-business-refresh/1','state','cancelled','tenant_id',p_tenant,
   'request_id',p_request,'link_id',p_link,'job_id',l.entity_id,'source_version_id',p_source,'actor_id',auth.uid());
  insert into public.learn_business_input_refresh_cancellations(tenant_id,request_id,link_id,source_version_id,actor_id,definition,receipt)
   values(p_tenant,p_request,p_link,p_source,auth.uid(),definition,receipt);
  perform public.learn_business_input_review_access(p_tenant,l.connection_id);
  return receipt;
 end if;$new$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Refresh cancellation dispatch differs';end if;
 execute replace(d,needle,replacement);
end$$;

commit;
