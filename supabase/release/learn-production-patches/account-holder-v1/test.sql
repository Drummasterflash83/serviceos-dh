-- Reviewed account identity is distinct from the provider's primary contact.
-- No source, existing identity, card, access or capture is changed on installation.
begin isolation level repeatable read;
set local search_path=pg_catalog;set local lock_timeout='3s';set local statement_timeout='30s';
do $guard$begin
if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy' or current_setting('serviceos.release_sha256',true) is distinct from '2e9de30402df874d7824dfc39f5ad422e0312320315af57b04a02a96acc55fad' then raise exception 'Exact account-holder target/source/role required';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_business_review_authority(uuid,uuid)'::regprocedure) is distinct from '26872e3b0d18cc9b9eaf436a83e1b8ce|postgres|{postgres=X/postgres}' then raise exception 'Reviewed function/access differs: learn_business_review_authority';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_commusoft_confirm_customer(uuid,uuid,text,uuid,text)'::regprocedure) is distinct from 'eee75d34d69b2728c99081f63a933f69|postgres|{postgres=X/postgres,authenticated=X/postgres}' then raise exception 'Reviewed function/access differs: learn_commusoft_confirm_customer';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_commusoft_review_customer(uuid,uuid,uuid,text,uuid,text)'::regprocedure) is distinct from 'a7919f46b5ed0c31f3f5c70d9d5e32bb|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Reviewed function/access differs: learn_commusoft_review_customer';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.openfolk_business_review(uuid,text,text,jsonb)'::regprocedure) is distinct from 'caa982d878e395233ddc7cd8270fea24|postgres|{postgres=X/postgres,authenticated=X/postgres}' then raise exception 'Reviewed function/access differs: openfolk_business_review';end if;
if to_regprocedure('public.learn_commusoft_review_customer_identity(uuid,uuid,uuid,text,uuid,text,jsonb)') is not null then raise exception 'Account-holder change already installed';end if;
if to_regprocedure('public.learn_commusoft_confirm_customer_identity(uuid,uuid,text,uuid,text,jsonb)') is not null then raise exception 'Account-holder change already installed';end if;
end $guard$;
create temporary table account_holder_preservation on commit drop as select jsonb_build_object('roles',(select md5(jsonb_agg(to_jsonb(x) order by roleid,member,grantor)::text) from pg_auth_members x),'policies',(select md5(jsonb_agg(to_jsonb(x) order by schemaname,tablename,policyname)::text) from pg_policies x),'schedules',null,'tables',(select md5(jsonb_agg(jsonb_build_array(c.relname,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity) order by c.relname)::text) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r'),'people',(select md5(jsonb_agg(to_jsonb(x) order by id)::text) from public.people x),'companies',(select md5(jsonb_agg(to_jsonb(x) order by id)::text) from public.companies x),'customer_cards',(select md5(jsonb_agg(to_jsonb(x) order by id)::text) from public.customer_cards x),'learn_business_input_links',(select md5(jsonb_agg(to_jsonb(x) order by id)::text) from public.learn_business_input_links x),'provider_connections',(select md5(jsonb_agg(to_jsonb(x) order by id)::text) from public.provider_connections x),'platform_authority_grants',(select md5(jsonb_agg(to_jsonb(x) order by id)::text) from public.platform_authority_grants x)) evidence;
do $schedules$declare h text;begin if to_regclass('cron.job') is not null then execute 'select md5(jsonb_agg(to_jsonb(x) order by jobid)::text) from cron.job x' into h;end if;update pg_temp.account_holder_preservation set evidence=evidence||jsonb_build_object('schedules',h);end $schedules$;

-- Extend the installed writer, preserving its current authority/stale-source locks.
do $migration$
declare d text;needle text;replacement text;
begin
 if to_regprocedure('public.learn_commusoft_review_customer_identity(uuid,uuid,uuid,text,uuid,text,jsonb)') is not null then
  raise exception 'account_holder_review_already_installed';end if;
 d:=pg_get_functiondef('public.learn_commusoft_review_customer(uuid,uuid,uuid,text,uuid,text)'::regprocedure);
 needle:='CREATE OR REPLACE FUNCTION public.learn_commusoft_review_customer(';
 if position(needle in d)<>1 or position('public.learn_business_review_authority(p_tenant,p_actor)' in d)=0 then raise exception 'account_holder_writer_contract_changed';end if;
 d:=replace(d,needle,'CREATE OR REPLACE FUNCTION public.learn_commusoft_review_customer_identity(');
 needle:='p_target uuid, p_reason text)';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'account_holder_signature_changed';end if;
 d:=replace(d,needle,'p_target uuid, p_reason text, p_identity jsonb)');
 needle:='request:=jsonb_build_object(''version'',p_version,''kind'',p_kind,''target'',p_target,''actor'',p_actor,''reason'',btrim(p_reason));';
 replacement:=$new$
 if p_identity is not null then
  if p_kind is distinct from 'person' or p_target is not null or jsonb_typeof(p_identity) is distinct from 'object'
   or not p_identity ?& array['display_name','contact_is_customer','evidence']
   or exists(select 1 from jsonb_object_keys(p_identity) k where not k=any(array['display_name','contact_is_customer','evidence']))
   or jsonb_typeof(p_identity->'display_name') is distinct from 'string'
   or length(btrim(p_identity->>'display_name')) not between 1 and 1000
   or jsonb_typeof(p_identity->'contact_is_customer') is distinct from 'boolean'
   or jsonb_typeof(p_identity->'evidence') is distinct from 'string'
   or length(btrim(p_identity->>'evidence')) not between 3 and 1000 then
   raise exception 'business_input_account_identity_invalid' using errcode='22023';end if;
  p_identity:=jsonb_build_object('display_name',btrim(p_identity->>'display_name'),
   'contact_is_customer',(p_identity->>'contact_is_customer')::boolean,'evidence',btrim(p_identity->>'evidence'));
 end if;
 request:=jsonb_build_object('version',p_version,'kind',p_kind,'target',p_target,'actor',p_actor,'reason',btrim(p_reason));
 if p_identity is not null then request:=request||jsonb_build_object('account_identity',p_identity);end if;
$new$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'account_holder_request_changed';end if;
 d:=replace(d,needle,replacement);
 needle:=$old$   label:=nullif(btrim(concat_ws(' ',nullif(btrim(contact->>'firstName'),''),nullif(btrim(contact->>'lastName'),''))),'');
   if label is null then raise exception 'business_input_customer_name_required' using errcode='22023';end if;
   insert into public.people(tenant_id,display_name,first_name,last_name,primary_email,primary_phone,address_text,postcode,verified,created_source,metadata)
    values(p_tenant,label,nullif(btrim(contact->>'firstName'),''),nullif(btrim(contact->>'lastName'),''),
     nullif(btrim(contact->>'email'),''),coalesce(nullif(btrim(contact->>'telephone'),''),nullif(btrim(contact->>'mobile'),'')),
     address,nullif(btrim(raw->>'postcode'),''),false,'business_input:commusoft',meta) returning id into target;$old$;
 replacement:=$new$   -- Legacy retries for already-reviewed sources returned above. A new person
   -- needs explicit account-holder evidence; never infer it from the contact.
   if p_identity is null then raise exception 'business_input_account_identity_required' using errcode='22023';end if;
   label:=p_identity->>'display_name';
   if (p_identity->>'contact_is_customer')::boolean and lower(label) is distinct from
    lower(nullif(btrim(concat_ws(' ',nullif(btrim(contact->>'firstName'),''),nullif(btrim(contact->>'lastName'),''))),'')) then
    raise exception 'business_input_account_contact_name_differs' using errcode='22023';end if;
   meta:=meta||jsonb_build_object('reviewed_account_holder',p_identity||jsonb_build_object('actor_id',p_actor,'source_version_id',v.id));
   insert into public.people(tenant_id,display_name,first_name,last_name,primary_email,primary_phone,address_text,postcode,verified,created_source,metadata)
    values(p_tenant,label,
     case when (p_identity->>'contact_is_customer')::boolean then nullif(btrim(contact->>'firstName'),'') end,
     case when (p_identity->>'contact_is_customer')::boolean then nullif(btrim(contact->>'lastName'),'') end,
     case when (p_identity->>'contact_is_customer')::boolean then nullif(btrim(contact->>'email'),'') end,
     case when (p_identity->>'contact_is_customer')::boolean then coalesce(nullif(btrim(contact->>'telephone'),''),nullif(btrim(contact->>'mobile'),'')) end,
     address,nullif(btrim(raw->>'postcode'),''),false,'business_input:commusoft',meta) returning id into target;$new$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'account_holder_person_writer_changed';end if;
 d:=replace(d,needle,replacement);
 execute d;
end $migration$;
revoke all on function public.learn_commusoft_review_customer_identity(uuid,uuid,uuid,text,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.learn_commusoft_review_customer_identity(uuid,uuid,uuid,text,uuid,text,jsonb) to service_role;
-- Preserve all legacy ACLs and exact lost-response recovery; prevent new implicit person creation.
create or replace function public.learn_commusoft_review_customer(p_tenant uuid,p_actor uuid,p_version uuid,p_kind text,p_target uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin return public.learn_commusoft_review_customer_identity(p_tenant,p_actor,p_version,p_kind,p_target,p_reason,null);end $$;
create function public.learn_commusoft_confirm_customer_identity(p_tenant uuid,p_version uuid,p_kind text,p_target uuid,p_reason text,p_identity jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null then raise exception 'business_input_review_forbidden' using errcode='42501';end if;
 return public.learn_commusoft_review_customer_identity(p_tenant,auth.uid(),p_version,p_kind,p_target,p_reason,p_identity);
end $$;
revoke all on function public.learn_commusoft_confirm_customer_identity(uuid,uuid,text,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.learn_commusoft_confirm_customer_identity(uuid,uuid,text,uuid,text,jsonb) to authenticated;
-- Extend the existing logged operator facade; no new actor, role or scope.
do $migration$
declare d text;needle text;replacement text;
begin
 d:=pg_get_functiondef('public.openfolk_business_review(uuid,text,text,jsonb)'::regprocedure);
 needle:=$old$  when 'learn_commusoft_confirm_customer' then array['p_tenant','p_version','p_kind','p_target','p_reason']$old$;
 replacement:=needle||E'\n'||$new$  when 'learn_commusoft_confirm_customer_identity' then array['p_tenant','p_version','p_kind','p_target','p_reason','p_identity']$new$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'account_holder_operator_actions_changed';end if;
 d:=replace(d,needle,replacement);
 needle:=$old$  when 'learn_commusoft_confirm_customer' then result:=public.learn_commusoft_confirm_customer(p_tenant,(p_args->>'p_version')::uuid,p_args->>'p_kind',(p_args->>'p_target')::uuid,p_args->>'p_reason');$old$;
 replacement:=needle||E'\n'||$new$  when 'learn_commusoft_confirm_customer_identity' then result:=public.learn_commusoft_confirm_customer_identity(p_tenant,(p_args->>'p_version')::uuid,p_args->>'p_kind',(p_args->>'p_target')::uuid,p_args->>'p_reason',p_args->'p_identity');$new$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'account_holder_operator_dispatch_changed';end if;
 execute replace(d,needle,replacement);
end $migration$;
do $guard$declare current_evidence jsonb;schedule_hash text;begin
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_business_review_authority(uuid,uuid)'::regprocedure) is distinct from '26872e3b0d18cc9b9eaf436a83e1b8ce|postgres|{postgres=X/postgres}' then raise exception 'Reviewed function/access differs: learn_business_review_authority';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_commusoft_confirm_customer(uuid,uuid,text,uuid,text)'::regprocedure) is distinct from 'eee75d34d69b2728c99081f63a933f69|postgres|{postgres=X/postgres,authenticated=X/postgres}' then raise exception 'Reviewed function/access differs: learn_commusoft_confirm_customer';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_commusoft_review_customer(uuid,uuid,uuid,text,uuid,text)'::regprocedure) is distinct from '54013281433d9b7d225c56321bcc86e2|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Reviewed function/access differs: learn_commusoft_review_customer';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.openfolk_business_review(uuid,text,text,jsonb)'::regprocedure) is distinct from 'c6a8d25c80288fd65a0b602750ef99ac|postgres|{postgres=X/postgres,authenticated=X/postgres}' then raise exception 'Reviewed function/access differs: openfolk_business_review';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_commusoft_review_customer_identity(uuid,uuid,uuid,text,uuid,text,jsonb)'::regprocedure) is distinct from 'fd9900092ecbd5ef08cebe35379d9270|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Reviewed function/access differs: learn_commusoft_review_customer_identity';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_commusoft_confirm_customer_identity(uuid,uuid,text,uuid,text,jsonb)'::regprocedure) is distinct from 'f06cdbf547fafa7be3e85b6a45f0672b|postgres|{postgres=X/postgres,authenticated=X/postgres}' then raise exception 'Reviewed function/access differs: learn_commusoft_confirm_customer_identity';end if;
select evidence into current_evidence from (select jsonb_build_object('roles',(select md5(jsonb_agg(to_jsonb(x) order by roleid,member,grantor)::text) from pg_auth_members x),'policies',(select md5(jsonb_agg(to_jsonb(x) order by schemaname,tablename,policyname)::text) from pg_policies x),'schedules',null,'tables',(select md5(jsonb_agg(jsonb_build_array(c.relname,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity) order by c.relname)::text) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r'),'people',(select md5(jsonb_agg(to_jsonb(x) order by id)::text) from public.people x),'companies',(select md5(jsonb_agg(to_jsonb(x) order by id)::text) from public.companies x),'customer_cards',(select md5(jsonb_agg(to_jsonb(x) order by id)::text) from public.customer_cards x),'learn_business_input_links',(select md5(jsonb_agg(to_jsonb(x) order by id)::text) from public.learn_business_input_links x),'provider_connections',(select md5(jsonb_agg(to_jsonb(x) order by id)::text) from public.provider_connections x),'platform_authority_grants',(select md5(jsonb_agg(to_jsonb(x) order by id)::text) from public.platform_authority_grants x)) evidence) q;
if to_regclass('cron.job') is not null then execute 'select md5(jsonb_agg(to_jsonb(x) order by jobid)::text) from cron.job x' into schedule_hash;end if;current_evidence:=current_evidence||jsonb_build_object('schedules',schedule_hash);
if current_evidence is distinct from (select evidence from pg_temp.account_holder_preservation) then raise exception 'Account-holder release changed data/access/schedules';end if;end $guard$;
notify pgrst,'reload schema';
commit;
