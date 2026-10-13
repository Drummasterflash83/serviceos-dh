-- Durable cancellation fences delayed refreshes without changing canonical data.
begin;
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
