-- Reviewed account identity is distinct from the provider's primary contact.
-- No source, existing identity, card, access or capture is changed on installation.
begin;
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
commit;
