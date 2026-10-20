-- One operator-requested Commusoft /users page. The source_sync job, approval,
-- cursor and phase are deliberately absent from this route. Installation makes
-- no provider call and enables no tenant flag.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- The existing credential lease serializes this route with source pages and
-- all manual reads. Extend its closed owner-kind list without changing pacing.
do $patch$ declare d text; old text := $old$'source_page','job_detail','opportunity','verification'$old$; begin
 d:=pg_get_functiondef('public.learn_commusoft_shared_lease_acquire(text,text,text)'::regprocedure);
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then
  raise exception 'commusoft_users_lease_contract_changed';end if;
 d:=replace(d,old,$new$'source_page','job_detail','opportunity','verification','users_page'$new$);
 -- Users sampling has no manual priority: it never installs a waiter that
 -- would make the recurring source worker yield its current page.
 if (length(d)-length(replace(d,$old$p_kind='source_page'$old$,'')))/length($old$p_kind='source_page'$old$)<>1
  or (length(d)-length(replace(d,$old$p_kind<>'source_page'$old$,'')))/length($old$p_kind<>'source_page'$old$)<>2 then
  raise exception 'commusoft_users_waiter_contract_changed';end if;
 d:=replace(d,$old$p_kind='source_page'$old$,$new$p_kind in('source_page','users_page')$new$);
 d:=replace(d,$old$p_kind<>'source_page'$old$,$new$p_kind not in('source_page','users_page')$new$);
 execute d;
 d:=pg_get_functiondef('public.learn_commusoft_shared_lease_release(text,text)'::regprocedure);
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then
  raise exception 'commusoft_users_release_contract_changed';end if;
 execute replace(d,old,$new$'source_page','job_detail','opportunity','verification','users_page'$new$);
end $patch$;

create table public.new_dawn_commusoft_users_page_reads (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 actor_id uuid not null references public.profiles(id),
 connection_id uuid not null references public.provider_connections(id),
 connection_revision timestamptz not null,
 secret_id uuid not null,
 credential_fingerprint text references public.learn_business_input_request_gates(credential_fingerprint),
 after_id bigint check(after_id between 1 and 9007199254740991),
 reason text not null check(length(btrim(reason)) between 3 and 500),
 state text not null default 'prepared' check(state in ('prepared','claimed','complete','failed')),
 created_at timestamptz not null default clock_timestamp(),
 claimed_at timestamptz,
 checked_at timestamptz,
 raw_sha256 text,
 record_count integer check(record_count between 0 and 10),
 has_more boolean,
 next_cursor bigint,
 failure_code text
);
create table public.new_dawn_commusoft_users_page_versions (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.new_dawn_commusoft_users_page_reads(id) on delete restrict,
 tenant_id uuid not null,
 connection_id uuid not null,
 external_id text not null check(external_id ~ '^[1-9][0-9]{0,15}$'),
 ordinal integer not null check(ordinal between 1 and 10),
 content_hash text not null check(content_hash ~ '^[0-9a-f]{64}$'),
 payload jsonb not null,
 observed_at timestamptz not null default clock_timestamp(),
 unique(request_id,ordinal),unique(request_id,external_id)
);
create index new_dawn_commusoft_users_page_versions_latest
 on public.new_dawn_commusoft_users_page_versions(tenant_id,connection_id,external_id,observed_at desc);
alter table public.new_dawn_commusoft_users_page_reads enable row level security;
alter table public.new_dawn_commusoft_users_page_versions enable row level security;
revoke all on public.new_dawn_commusoft_users_page_reads,public.new_dawn_commusoft_users_page_versions
 from public,anon,authenticated,service_role;
create trigger retained_users_page_versions before update or delete on public.new_dawn_commusoft_users_page_versions
 for each row execute function public.learn_business_input_retain();
create trigger retained_users_page_versions_all before truncate on public.new_dawn_commusoft_users_page_versions
 for each statement execute function public.learn_business_input_retain();

create function public.new_dawn_commusoft_users_page_guard(p_request uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare r public.new_dawn_commusoft_users_page_reads%rowtype;c public.provider_connections%rowtype;
begin
 if auth.role() is distinct from 'service_role' or current_setting('transaction_isolation')<>'read committed' then return false;end if;
 select * into r from public.new_dawn_commusoft_users_page_reads where id=p_request
  and state='claimed' and claimed_at>clock_timestamp()-interval '40 seconds';
 if not found then return false;end if;
 perform public.new_dawn_commusoft_job_actor_access(r.tenant_id,r.actor_id);
 perform 1 from public.feature_flags where tenant_id=r.tenant_id
  and flag='learn.enabled' and value='true'::jsonb for share;
 if not found then return false;end if;
 perform 1 from public.feature_flags where tenant_id=r.tenant_id
  and flag='learn.inputs.commusoft.enabled' and value='true'::jsonb for share;
 if not found then return false;end if;
 perform 1 from public.feature_flags where tenant_id=r.tenant_id
  and flag='learn.inputs.commusoft.users.enabled' and value='true'::jsonb for share;
 if not found then return false;end if;
 select * into c from public.provider_connections where id=r.connection_id and tenant_id=r.tenant_id
  and provider='commusoft' and status='configured' and auth_mode='private_api_key'
  and revoked_at is null and verified_at is not null and verified_at<=clock_timestamp()
  and updated_at=r.connection_revision
  and secret_refs->>'api_key'=r.secret_id::text
  and non_secret_config->>'region' in('uk','us') for share;
 if not found then return false;end if;
 if r.credential_fingerprint is not null then
  perform 1 from public.learn_business_input_request_gates
   where credential_fingerprint=r.credential_fingerprint and lease_owner_kind='users_page'
    and lease_owner_id=r.id::text and lease_expires_at>clock_timestamp() for share;
  if not found then return false;end if;
 end if;
 return true;
end $$;

create function public.new_dawn_commusoft_users_page_start(
 p_tenant uuid,p_connection uuid,p_request uuid,p_after bigint,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=auth.uid();c public.provider_connections%rowtype;r public.new_dawn_commusoft_users_page_reads%rowtype;
begin
 if auth.role() is distinct from 'authenticated' or current_setting('transaction_isolation')<>'read committed'
  or p_request is null or p_connection is null or (p_after is not null and p_after not between 1 and 9007199254740991)
  or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
  raise exception 'users_page_invalid' using errcode='22023';end if;
 perform public.learn_operator_input_access(p_tenant,actor,true);
 perform public.new_dawn_commusoft_job_actor_access(p_tenant,actor);
 perform 1 from public.feature_flags where tenant_id=p_tenant and flag='learn.enabled' and value='true'::jsonb for share;
 if not found then raise exception 'users_page_off' using errcode='42501';end if;
 perform 1 from public.feature_flags where tenant_id=p_tenant and flag='learn.inputs.commusoft.enabled' and value='true'::jsonb for share;
 if not found then raise exception 'users_page_off' using errcode='42501';end if;
 perform 1 from public.feature_flags where tenant_id=p_tenant and flag='learn.inputs.commusoft.users.enabled' and value='true'::jsonb for share;
 if not found then raise exception 'users_page_off' using errcode='42501';end if;
 select * into c from public.provider_connections where id=p_connection and tenant_id=p_tenant
  and provider='commusoft' and status='configured' and auth_mode='private_api_key'
  and revoked_at is null and verified_at is not null and verified_at<=clock_timestamp()
  and non_secret_config->>'region' in('uk','us')
  and coalesce(secret_refs->>'api_key','')~'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' for share;
 if not found then raise exception 'users_page_connection_unavailable' using errcode='42501';end if;
 select * into r from public.new_dawn_commusoft_users_page_reads where id=p_request;
 if found then
  if r.tenant_id=p_tenant and r.actor_id=actor and r.connection_id=p_connection
   and r.connection_revision=c.updated_at and r.after_id is not distinct from p_after
   and r.reason=btrim(p_reason) and r.state='prepared'
   and r.created_at>clock_timestamp()-interval '5 minutes' then
   return jsonb_build_object('state','prepared','request_id',p_request);end if;
  raise exception 'users_page_request_conflict' using errcode='PT409';
 end if;
 insert into public.new_dawn_commusoft_users_page_reads
  (id,tenant_id,actor_id,connection_id,connection_revision,secret_id,after_id,reason)
 values(p_request,p_tenant,actor,c.id,c.updated_at,(c.secret_refs->>'api_key')::uuid,p_after,btrim(p_reason));
 insert into public.controlplane_change_log
  (id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
 values(gen_random_uuid(),p_tenant,actor::text,'commusoft.users_page_requested','provider_connections',c.id::text,
  jsonb_build_object('request_id',p_request,'after',p_after,'limit',10),btrim(p_reason),p_request::text,false,
  'new-dawn-commusoft-users-page');
 return jsonb_build_object('state','prepared','request_id',p_request);
end $$;

create function public.new_dawn_commusoft_users_page_acquire(p_request uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.new_dawn_commusoft_users_page_reads%rowtype;c public.provider_connections%rowtype;
 secret text;fingerprint text;lease jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'users_page_forbidden' using errcode='42501';end if;
 select * into r from public.new_dawn_commusoft_users_page_reads where id=p_request for update;
 if not found or r.state<>'prepared' or r.created_at<clock_timestamp()-interval '5 minutes' then
  raise exception 'users_page_unavailable' using errcode='42501';end if;
 update public.new_dawn_commusoft_users_page_reads set state='claimed',claimed_at=clock_timestamp() where id=p_request;
 if not public.new_dawn_commusoft_users_page_guard(p_request) then
  raise exception 'users_page_scope_changed' using errcode='42501';end if;
 select * into c from public.provider_connections where id=r.connection_id and tenant_id=r.tenant_id for share;
 select decrypted_secret into secret from vault.decrypted_secrets
  where id=r.secret_id and name='provider_secret:'||r.tenant_id::text||':commusoft:api_key';
 if secret is null or length(secret) not between 1 and 4096 or secret !~ '^[!-~]+$' then
  raise exception 'users_page_credential_unavailable' using errcode='42501';end if;
 fingerprint:=encode(sha256(convert_to('commusoft:'||secret,'UTF8')),'hex');
 lease:=public.learn_commusoft_shared_lease_acquire(fingerprint,'users_page',p_request::text);
 if lease->>'state'='wait' then
  update public.new_dawn_commusoft_users_page_reads set state='prepared',claimed_at=null where id=p_request;
  return jsonb_build_object('state','wait','retry_at',(lease->>'retryAt')::bigint,'wait_kind',lease->>'waitKind');
 end if;
 if lease->>'state'<>'ready' then raise exception 'users_page_lease_unavailable' using errcode='55000';end if;
 update public.new_dawn_commusoft_users_page_reads set credential_fingerprint=fingerprint where id=p_request;
 return jsonb_build_object('state','ready','request_id',r.id,'tenant_id',r.tenant_id,
  'connection_id',r.connection_id,'region',c.non_secret_config->>'region','after',r.after_id,
  'send_before',ceil(extract(epoch from clock_timestamp()+interval '5 seconds')*1000)::bigint,'api_key',secret);
end $$;

create function public.new_dawn_commusoft_users_page_finish(p_request uuid,p_envelope jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.new_dawn_commusoft_users_page_reads%rowtype;item jsonb;
 previous_id bigint;item_id bigint;next_id bigint;page_has_more boolean;n integer:=0;version_id uuid;receipt jsonb;
begin
 if auth.role() is distinct from 'service_role' or p_envelope is null or octet_length(p_envelope::text)>262144 then
  raise exception 'users_page_invalid' using errcode='22023';end if;
 select * into r from public.new_dawn_commusoft_users_page_reads where id=p_request for update;
 if not found or not public.new_dawn_commusoft_users_page_guard(p_request) then
  raise exception 'users_page_scope_changed' using errcode='42501';end if;
 if jsonb_typeof(p_envelope) is distinct from 'object' or p_envelope ? 'error'
  or jsonb_typeof(p_envelope->'data') is distinct from 'array'
  or jsonb_array_length(p_envelope->'data')>10
  or jsonb_typeof(p_envelope->'pagination') is distinct from 'object'
  or jsonb_typeof(p_envelope->'pagination'->'hasMore') is distinct from 'boolean' then
  raise exception 'users_page_response_invalid' using errcode='22023';end if;
 previous_id:=coalesce(r.after_id,0);
 for item in select value from jsonb_array_elements(p_envelope->'data') loop
  if jsonb_typeof(item) is distinct from 'object' or octet_length(item::text)>65536
   or jsonb_typeof(item->'id') is distinct from 'number'
   or item->>'id' !~ '^[1-9][0-9]{0,15}$' then
   raise exception 'users_page_response_invalid' using errcode='22023';end if;
  item_id:=(item->>'id')::bigint;
  if item_id<=previous_id or item_id>9007199254740991 then
   raise exception 'users_page_response_invalid' using errcode='22023';end if;
  previous_id:=item_id;n:=n+1;
 end loop;
 page_has_more:=(p_envelope->'pagination'->>'hasMore')::boolean;
 if p_envelope->'pagination'->'nextCursor' is null or p_envelope->'pagination'->'nextCursor'='null'::jsonb then next_id:=null;
 elsif jsonb_typeof(p_envelope->'pagination'->'nextCursor')='number'
  and p_envelope->'pagination'->>'nextCursor' ~ '^[0-9]+$' then
  next_id:=(p_envelope->'pagination'->>'nextCursor')::bigint;
 else raise exception 'users_page_response_invalid' using errcode='22023';end if;
 if (page_has_more and (n=0 or next_id is distinct from previous_id))
  or (not page_has_more and next_id is not null and next_id<>0 and next_id is distinct from previous_id) then
  raise exception 'users_page_response_invalid' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(p_envelope->'data') loop
  version_id:=gen_random_uuid();
  insert into public.new_dawn_commusoft_users_page_versions
   (id,request_id,tenant_id,connection_id,external_id,ordinal,content_hash,payload)
  values(version_id,p_request,r.tenant_id,r.connection_id,item->>'id',
   (select count(*)+1 from public.new_dawn_commusoft_users_page_versions where request_id=p_request),
   encode(sha256(convert_to(item::text,'UTF8')),'hex'),item);
 end loop;
 update public.new_dawn_commusoft_users_page_reads set state='complete',checked_at=clock_timestamp(),
  raw_sha256=encode(sha256(convert_to(p_envelope::text,'UTF8')),'hex'),record_count=n,
  has_more=page_has_more,next_cursor=case when page_has_more then next_id else null end where id=p_request;
 insert into public.controlplane_change_log
  (id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
 values(gen_random_uuid(),r.tenant_id,r.actor_id::text,'commusoft.users_page_completed','provider_connections',r.connection_id::text,
  jsonb_build_object('request_id',r.id,'record_count',n,'has_more',page_has_more),r.reason,r.id::text,false,
  'new-dawn-commusoft-users-page');
 receipt:=jsonb_build_object('version','commusoft-isolated-users-page/1','request_id',r.id,
  'tenant_id',r.tenant_id,'connection_id',r.connection_id,'record_count',n,
  'has_more',page_has_more,'next_cursor',case when page_has_more then next_id else null end,
  'scope','source_identity_only');
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return receipt;
exception when invalid_text_representation or numeric_value_out_of_range then
 raise exception 'users_page_response_invalid' using errcode='22023';
end $$;

create function public.new_dawn_commusoft_users_page_fail(p_request uuid,p_code text,p_retry_at timestamptz)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare r public.new_dawn_commusoft_users_page_reads%rowtype;
begin
 if auth.role() is distinct from 'service_role' or p_code not in('scope_changed','authentication_required',
  'access_denied','provider_unavailable','provider_rejected','rate_limited','response_too_large',
  'invalid_response','transport_unavailable','result_unconfirmed') then
  raise exception 'users_page_invalid' using errcode='22023';end if;
 select * into r from public.new_dawn_commusoft_users_page_reads where id=p_request for update;
 if not found or r.state not in('prepared','claimed') then return;end if;
 if p_code='rate_limited' and r.credential_fingerprint is not null then
  if p_retry_at is null or not isfinite(p_retry_at) or p_retry_at<=clock_timestamp()
   or p_retry_at>clock_timestamp()+interval '1 day' then
   raise exception 'users_page_retry_invalid' using errcode='22023';end if;
  update public.learn_business_input_request_gates set next_allowed_at=greatest(next_allowed_at,p_retry_at)
   where credential_fingerprint=r.credential_fingerprint;
 end if;
 update public.new_dawn_commusoft_users_page_reads set state='failed',failure_code=p_code where id=p_request;
 insert into public.controlplane_change_log
  (id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
 values(gen_random_uuid(),r.tenant_id,r.actor_id::text,'commusoft.users_page_failed','provider_connections',r.connection_id::text,
  jsonb_build_object('request_id',r.id,'code',p_code),r.reason,r.id::text,false,
  'new-dawn-commusoft-users-page');
end $$;

create function public.new_dawn_commusoft_users_page_retain()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 if tg_op in('DELETE','TRUNCATE') then
  raise exception 'users_page_receipt_retained' using errcode='55000';end if;
 if old.state in('complete','failed') then
  raise exception 'users_page_receipt_retained' using errcode='55000';end if;
 if old.state='claimed' and new.state in('complete','failed') then
  perform public.learn_commusoft_shared_lease_release('users_page',new.id::text);end if;
 return new;
end $$;
create trigger new_dawn_users_page_retain before update or delete on public.new_dawn_commusoft_users_page_reads
 for each row execute function public.new_dawn_commusoft_users_page_retain();
create trigger new_dawn_users_page_retain_all before truncate on public.new_dawn_commusoft_users_page_reads
 for each statement execute function public.new_dawn_commusoft_users_page_retain();

-- The existing held source-user reference can see the newest retained version
-- from either capture path. The explicit source label prevents a manual sample
-- from being mistaken for coverage by the recurring source traversal.
do $patch$ declare d text;old text;replacement text;begin
 d:=pg_get_functiondef('public.new_dawn_job_source_user_reference(uuid,uuid,text)'::regprocedure);
 old:=$old$  if u.id is not null then
   select max(p.committed_at) into captured from public.learn_business_input_observations o
   join public.learn_business_input_pages p on p.id=o.page_id
   where o.version_id=u.id and p.tenant_id=p_tenant and p.connection_id=cid
    and p.provider='commusoft' and p.collection='users';
   if captured is null then raise exception 'source_user_reference_user_invalid' using errcode='22023';end if;
  end if;
  rows:=rows||jsonb_build_array(jsonb_build_object($old$;
 replacement:=$new$  if u.id is not null then
   select max(p.committed_at) into captured from public.learn_business_input_observations o
   join public.learn_business_input_pages p on p.id=o.page_id
   where o.version_id=u.id and p.tenant_id=p_tenant and p.connection_id=cid
    and p.provider='commusoft' and p.collection='users';
   if captured is null then raise exception 'source_user_reference_user_invalid' using errcode='22023';end if;
  end if;
  select m.id,m.payload,m.observed_at into manual_id,manual_payload,manual_at
   from public.new_dawn_commusoft_users_page_versions m
   join public.new_dawn_commusoft_users_page_reads q on q.id=m.request_id
   where m.tenant_id=p_tenant and m.connection_id=cid and m.external_id=uid
    and q.tenant_id=p_tenant and q.connection_id=cid and q.state='complete'
   order by m.observed_at desc,m.id desc limit 1;
  if manual_id is not null and (jsonb_typeof(manual_payload->'id') is distinct from 'number'
    or manual_payload->>'id' is distinct from uid) then
   raise exception 'source_user_reference_user_invalid' using errcode='22023';end if;
  if manual_id is not null and (captured is null or manual_at>captured) then
   u.id:=manual_id;u.payload:=manual_payload;captured:=manual_at;version_source:='isolated_page';
  else version_source:='recurring_page';end if;
  rows:=rows||jsonb_build_array(jsonb_build_object($new$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1
  or (length(d)-length(replace(d,'uid text;seen text[]', '')))/length('uid text;seen text[]')<>1
  or (length(d)-length(replace(d,$old$'source_user_version_id',u.id,$old$,'')))/length($old$'source_user_version_id',u.id,$old$)<>1 then
  raise exception 'source_user_reference_users_page_contract_changed';end if;
 d:=replace(d,'uid text;seen text[]',
  'uid text;manual_id uuid;manual_payload jsonb;manual_at timestamptz;version_source text;seen text[]');
 d:=replace(d,old,replacement);
 d:=replace(d,$old$'source_user_version_id',u.id,$old$,
  $new$'source_user_version_id',u.id,'source_user_version_source',case when u.id is null then null else version_source end,$new$);
 execute d;
end $patch$;

revoke all on function public.new_dawn_commusoft_users_page_guard(uuid),
 public.new_dawn_commusoft_users_page_start(uuid,uuid,uuid,bigint,text),
 public.new_dawn_commusoft_users_page_acquire(uuid),
 public.new_dawn_commusoft_users_page_finish(uuid,jsonb),
 public.new_dawn_commusoft_users_page_fail(uuid,text,timestamptz),
 public.new_dawn_commusoft_users_page_retain()
 from public,anon,authenticated,service_role;
grant execute on function public.new_dawn_commusoft_users_page_start(uuid,uuid,uuid,bigint,text) to authenticated;
grant execute on function public.new_dawn_commusoft_users_page_guard(uuid),
 public.new_dawn_commusoft_users_page_acquire(uuid),
 public.new_dawn_commusoft_users_page_finish(uuid,jsonb),
 public.new_dawn_commusoft_users_page_fail(uuid,text,timestamptz) to service_role;
commit;
