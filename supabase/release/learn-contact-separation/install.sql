begin;
set local lock_timeout='5s';set local statement_timeout='45s';
do $$begin
 if current_setting('serviceos.release_project',true) is null or current_setting('serviceos.release_project',true) not in ('saatxzwxvdvqevbnskxy','tgbnakbxwcqjeimygroz') then raise exception 'Explicit release project required';end if;
 if md5(pg_get_functiondef('public.learn_business_input_projection_result(uuid,uuid,jsonb,jsonb)'::regprocedure)) is distinct from '62dcb225af750876b9a7be1bc7fbc821' then raise exception 'Contact release baseline changed: learn_business_input_projection_result';end if;
 if md5(pg_get_functiondef('public.learn_business_input_review_access(uuid,uuid)'::regprocedure)) is distinct from 'a25a68be9299c292927072d5808dd4f0' then raise exception 'Contact release baseline changed: learn_business_input_review_access';end if;
 if md5(pg_get_functiondef('public.learn_business_review_authority(uuid,uuid)'::regprocedure)) is distinct from '26872e3b0d18cc9b9eaf436a83e1b8ce' then raise exception 'Contact release baseline changed: learn_business_review_authority';end if;
 if md5(pg_get_functiondef('public.learn_commusoft_confirm_contact(uuid,uuid,uuid,text)'::regprocedure)) is distinct from '4cd4cc353c6403f2fe3f0124dc88c23a' then raise exception 'Contact release baseline changed: learn_commusoft_confirm_contact';end if;
 if md5(pg_get_functiondef('public.learn_commusoft_contact_candidates(uuid,uuid,text,text,uuid,integer)'::regprocedure)) is distinct from 'bbe5182bcd6dca5aa5103563f8cf0b48' then raise exception 'Contact release baseline changed: learn_commusoft_contact_candidates';end if;
 if md5(pg_get_functiondef('public.learn_commusoft_property_owner(uuid,uuid,text,boolean)'::regprocedure)) is distinct from '7bfcf0fbaa474082cd5d0bca92e7a56f' then raise exception 'Contact release baseline changed: learn_commusoft_property_owner';end if;
 if md5(pg_get_functiondef('public.learn_commusoft_work_batch(uuid,uuid,uuid,text,jsonb,text,boolean,uuid)'::regprocedure)) is distinct from 'a9945afcaef0bb4702cf8b37172cd50c' then raise exception 'Contact release baseline changed: learn_commusoft_work_batch';end if;
 if md5(pg_get_functiondef('public.learn_identity_deliver(uuid,uuid,uuid,text,text)'::regprocedure)) is distinct from '26ab0a27118b22a78d5bb3e07a405f3a' then raise exception 'Contact release baseline changed: learn_identity_deliver';end if;
 if md5(pg_get_functiondef('public.learn_identity_deliver_internal(uuid,uuid,uuid,text,text,uuid)'::regprocedure)) is distinct from '8a1a4612ecc06c82676687e69fbdd5b0' then raise exception 'Contact release baseline changed: learn_identity_deliver_internal';end if;
 if md5(pg_get_functiondef('public.learn_identity_revision(interactions)'::regprocedure)) is distinct from 'b5adccd05a33debdc3de642288c077dc' then raise exception 'Contact release baseline changed: learn_identity_revision';end if;
 if md5(pg_get_functiondef('public.openfolk_business_review(uuid,text,text,jsonb)'::regprocedure)) is distinct from 'c623f4b271406811f7e32b96077d07d7' then raise exception 'Contact release baseline changed: openfolk_business_review';end if;
 if to_regprocedure('public.learn_commusoft_separate_contact(uuid,uuid,text,jsonb)') is not null then raise exception 'Contact release already present; reconcile';end if;
 if to_regprocedure('public.learn_identity_shared_contact_channel(uuid,text,text)') is not null then raise exception 'Contact release already present; reconcile';end if;
end$$;
-- An explicit, evidenced review may keep named people separate despite shared
-- contact channels. Existing automatic collision holds remain unchanged.
create function public.learn_commusoft_separate_contact(p_tenant uuid,p_version uuid,p_reason text,p_review jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v public.learn_business_input_versions%rowtype;l public.learn_business_input_links%rowtype;
 latest public.learn_business_input_versions%rowtype; candidates jsonb;expected jsonb;actual jsonb;
 result jsonb;request jsonb;owner jsonb;label text;reason text;target uuid;meta jsonb;
begin
 perform public.learn_business_input_review_access(p_tenant);
 if p_version is null or p_reason is null or length(btrim(p_reason)) not between 3 and 1000
  or jsonb_typeof(p_review) is distinct from 'object' then
  raise exception 'contact_separation_review_invalid' using errcode='22023';end if;
 if (select count(*) from jsonb_object_keys(p_review))<>4
  or p_review->>'mode' is distinct from 'separate_named_person'
  or jsonb_typeof(p_review->'source_name') is distinct from 'string'
  or length(btrim(p_review->>'source_name')) not between 1 and 1000
  or jsonb_typeof(p_review->'evidence') is distinct from 'string'
  or length(btrim(p_review->>'evidence')) not between 20 and 1000
  or jsonb_typeof(p_review->'candidate_ids') is distinct from 'array' then
  raise exception 'contact_separation_review_invalid' using errcode='22023';end if;
 if jsonb_array_length(p_review->'candidate_ids') not between 1 and 50
  or exists(select 1 from jsonb_array_elements(p_review->'candidate_ids') x where jsonb_typeof(x)<>'string' or x#>>'{}'!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$') then
  raise exception 'contact_separation_review_invalid' using errcode='22023';end if;
 select jsonb_agg(id order by id) into expected from(select distinct (x#>>'{}')::uuid id from jsonb_array_elements(p_review->'candidate_ids')x)s;
 if jsonb_array_length(expected)<>jsonb_array_length(p_review->'candidate_ids') then
  raise exception 'contact_separation_review_invalid' using errcode='22023';end if;
 select * into v from public.learn_business_input_versions where id=p_version and tenant_id=p_tenant and provider='commusoft' and collection='propertyContacts';
 if not found then raise exception 'business_input_contact_source_required' using errcode='22023';end if;
 perform public.learn_business_input_review_access(p_tenant,v.connection_id);
 perform 1 from public.provider_connections where id=v.connection_id and tenant_id=p_tenant for update;
 request:=jsonb_build_object('kind','contact','target',null,'reason',btrim(p_reason),'identity_review',p_review);
 <<review>> begin
  latest:=public.learn_business_input_latest(p_tenant,v.connection_id,v.provider,v.collection,v.external_id);
  if latest.id is distinct from v.id then reason:='source_changed_or_ambiguous';exit review;end if;
  label:=nullif(btrim(concat_ws(' ',nullif(btrim(v.payload->>'firstName'),''),nullif(btrim(v.payload->>'lastName'),''))),'');
  if label is distinct from p_review->>'source_name' then reason:='contact_separation_source_changed';exit review;end if;
  select * into l from public.learn_business_input_links where tenant_id=p_tenant and connection_id=v.connection_id and provider=v.provider and collection=v.collection and external_id=v.external_id;
  if found then
   if l.source_version_id<>v.id or l.entity_kind<>'contact' or l.entity_table<>'people'
    or not exists(select 1 from public.learn_business_input_projection_attempts a
     where a.tenant_id=p_tenant and a.source_version_id=v.id and a.request->'identity_review'=p_review
      and a.result->>'state'='linked' and a.result->>'entity_id'=l.entity_id::text) then
    reason:='existing_identity_needs_review';exit review;end if;
   -- Reuse the original person only after the normal writer rechecks source and
   -- ownership. A changed candidate set after this successful save is expected.
   result:=public.learn_commusoft_confirm_contact(p_tenant,v.id,l.entity_id,btrim(p_reason));
   exit review;
  end if;
  candidates:=public.learn_commusoft_contact_candidates(p_tenant,v.id,'person','',null,50);
  if candidates->>'next_cursor' is not null then reason:='contact_separation_candidates_incomplete';exit review;end if;
  select coalesce(jsonb_agg(id order by id),'[]'::jsonb) into actual from(select (x->>'id')::uuid id from jsonb_array_elements(candidates->'rows')x)s;
  if actual is distinct from expected then reason:='contact_separation_candidates_changed';exit review;end if;
  owner:=public.learn_commusoft_property_owner(p_tenant,v.connection_id,v.payload->>'propertyID',true);
  if owner->>'state' is distinct from 'ready' then reason:=coalesce(owner->>'reason','property_identity_unreviewed');exit review;end if;
  meta:=jsonb_build_object('learn_business_input',jsonb_build_object('connection_id',v.connection_id,'source_version_id',v.id,'property_external_id',v.payload->>'propertyID','position',v.payload->'position','relationships',owner),'reviewed_contact_separation',p_review||jsonb_build_object('actor_id',auth.uid()));
  -- The nested transaction removes the new person if the normal source writer
  -- holds an invalid field/relationship. All later receipt/audit failures abort.
  begin
   insert into public.people(tenant_id,display_name,first_name,last_name,verified,created_source,metadata)
    values(p_tenant,label,nullif(btrim(v.payload->>'firstName'),''),nullif(btrim(v.payload->>'lastName'),''),false,'business_input:commusoft',meta) returning id into target;
   result:=public.learn_commusoft_confirm_contact(p_tenant,v.id,target,btrim(p_reason));
   if result->>'state' is distinct from 'linked' then raise exception 'contact_separation_held' using errcode='P0C01';end if;
   -- The outer append-only projection receipt retains the distinct-person review.
  exception when sqlstate 'P0C01' then null;
  end;
 end review;
 if reason is not null then result:=jsonb_build_object('state','held','reason',reason);end if;
 perform public.learn_business_input_review_access(p_tenant,v.connection_id);
 return public.learn_business_input_projection_result(p_tenant,v.id,request,result);
end$$;
revoke all on function public.learn_commusoft_separate_contact(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;

-- Preserve the batch signature, existing actor/tenant locks and durable outbox
-- recovery. Only a contact with no selected target may carry the extra review.
do $patch$declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.learn_commusoft_work_batch(uuid,uuid,uuid,text,jsonb,text,boolean,uuid)'::regprocedure);
 needle:='(select count(*) from jsonb_object_keys(item))<>2';
 replacement:=$replacement$((select count(*) from jsonb_object_keys(item))<>case when item ? 'identity_review' then 3 else 2 end
    or exists(select 1 from jsonb_object_keys(item) k where k not in ('version_id','target_id','identity_review'))
    or (item ? 'identity_review' and (p_kind<>'contact' or item->'target_id' is distinct from 'null'::jsonb or jsonb_typeof(item->'identity_review') is distinct from 'object')))$replacement$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'contact_separation_batch_validation_changed';end if;
 d:=replace(d,needle,replacement);
 needle:=$needle$if p_kind='contact' then outcome:=public.learn_commusoft_confirm_contact(p_tenant,(item->>'version_id')::uuid,(item->>'target_id')::uuid,btrim(p_reason));$needle$;
 replacement:=$replacement$if p_kind='contact' and item ? 'identity_review' then outcome:=public.learn_commusoft_separate_contact(p_tenant,(item->>'version_id')::uuid,btrim(p_reason),item->'identity_review');
   elsif p_kind='contact' then outcome:=public.learn_commusoft_confirm_contact(p_tenant,(item->>'version_id')::uuid,(item->>'target_id')::uuid,btrim(p_reason));$replacement$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'contact_separation_batch_dispatch_changed';end if;
 execute replace(d,needle,replacement);
end$patch$;

-- Contact points are deliberately non-exclusive. A retained office endpoint must
-- not look unique just because only one of its people has it marked primary.
-- This guard withholds automatic attribution; it never promotes an unverified
-- contact point to an identity match. Region comes from its source connection.
create function public.learn_identity_shared_contact_channel(p_tenant uuid,p_channel text,p_value text)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
 with endpoints as materialized (
  select cp.person_id,cp.normalized_value,c.non_secret_config->>'region' region,c.id connection_id
  from public.contact_points cp
  join public.people p on p.id=cp.person_id and p.tenant_id=cp.tenant_id
  left join public.provider_connections c on c.tenant_id=cp.tenant_id
   and c.id::text=cp.metadata#>>'{learn_business_input,connection_id}'
  where cp.tenant_id=p_tenant and cp.channel=p_channel
 ), matched as materialized (
  select * from endpoints e where
   (p_channel='email' and e.normalized_value=lower(btrim(p_value))) or
   (p_channel='phone' and (e.normalized_value=btrim(p_value) or
    (e.connection_id is not null and e.normalized_value=public.learn_business_contact_phone(p_value,e.region))))
 ), identities as (
  select person_id id from matched
  union
  select p.id from public.people p where p.tenant_id=p_tenant and (
   (p_channel='email' and lower(btrim(p.primary_email))=lower(btrim(p_value))) or
   (p_channel='phone' and (btrim(p.primary_phone)=btrim(p_value) or exists(
    select 1 from matched e where e.connection_id is not null
     and public.learn_business_contact_phone(p.primary_phone,e.region)=e.normalized_value))))
 ) select count(*)>1 from (select id from identities limit 2) distinct_people;
$$;
revoke all on function public.learn_identity_shared_contact_channel(uuid,text,text) from public,anon,authenticated,service_role;

do $patch$declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.learn_identity_deliver_internal(uuid,uuid,uuid,text,text,uuid)'::regprocedure);
 needle:=$needle$else
 if reason is null and email is not null then
  select count(*),min(x.id::text)::uuid into matches,email_id$needle$;
 replacement:=$replacement$else
 if reason is null and (
  (email is not null and public.learn_identity_shared_contact_channel(p_tenant,'email',email)) or
  (phone is not null and public.learn_identity_shared_contact_channel(p_tenant,'phone',phone)))
 then reason:='person_ambiguous';end if;
 if reason is null and email is not null then
  select count(*),min(x.id::text)::uuid into matches,email_id$replacement$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'contact_separation_identity_baseline_changed';end if;
 execute replace(d,needle,replacement);
end$patch$;

notify pgrst,'reload schema';
commit;
