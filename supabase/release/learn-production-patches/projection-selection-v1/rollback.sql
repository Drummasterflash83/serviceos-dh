-- Restore the prior selector only; retain all source and publication history.
begin;
set local search_path=pg_catalog;set local lock_timeout='3s';set local statement_timeout='30s';
do $guard$begin
if current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz' or current_setting('serviceos.release_sha256',true) is distinct from 'a38809a3ee8495bb131884558bd1c16703a8ab5c7adec7d9467d8869f60dc1df' then raise exception 'Reviewed target/source required';end if;
if (select md5(p.prosrc)||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_projection_pending(uuid,text,integer)'::regprocedure) is distinct from '5317ae1c1b25bb53bdf8c2b6ff202daa|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Candidate selector definition or authority differs';end if;
end$guard$;
CREATE OR REPLACE FUNCTION public.learn_projection_pending(p_tenant uuid, p_source text, p_limit integer DEFAULT 100)
 RETURNS TABLE(source_kind text, source_id uuid, source_revision text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
 SET "TimeZone" TO 'UTC'
AS $function$
begin
 if p_source is null or p_source not in('all','phone','email') then raise exception 'projection_source_invalid' using errcode='22023';end if;
 return query with candidates as (
  select 'phone'::text as kind,c.id,coalesce(c.started_at,c.created_at) as occurred,
   public.learn_projection_revision(public.learn_phone_source_fields(c),case when i.metadata?'phone_handoff' then public.phone_projection_version(p_tenant,c.id) else null end) as revision,
   i.id is null or case when i.metadata?'phone_handoff' then i.source_version is distinct from public.phone_projection_version(p_tenant,c.id)
    else i.metadata->'source_projection'->>'revision' is distinct from public.learn_projection_revision(public.learn_phone_source_fields(c),null) end as dirty
  from public.phone_calls c left join public.interactions i on i.tenant_id=c.tenant_id and i.source_table='phone_calls' and i.source_id=c.id
  where c.tenant_id=p_tenant and p_source in('all','phone')
  union all
  select 'email',m.id,coalesce(m.received_at,m.sent_at,m.created_at),public.learn_projection_revision(public.learn_email_source_fields(m),coalesce(to_jsonb(m)->>'origin_campaign_id','')),
   i.id is null or i.metadata->'source_projection'->>'revision' is distinct from public.learn_projection_revision(public.learn_email_source_fields(m),coalesce(to_jsonb(m)->>'origin_campaign_id',''))
  from public.email_messages m left join public.interactions i on i.tenant_id=m.tenant_id and i.source_table='email_messages' and i.source_id=m.id
  where m.tenant_id=p_tenant and p_source in('all','email') and not public.learn_email_is_draft(m)
 ) select x.kind,x.id,x.revision from candidates x where x.dirty
 and exists(select 1 from public.tenants t where t.id=p_tenant and t.status='active')
 and not exists(select 1 from public.learn_interaction_projection_receipts r where r.tenant_id=p_tenant and r.source_kind=x.kind and r.source_id=x.id and r.source_revision=x.revision and r.receipt->>'state'='review_required')
 order by x.occurred,x.kind,x.id limit greatest(1,least(2000,coalesce(p_limit,100)));
end$function$
;
do $check$begin
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_projection_pending(uuid,text,integer)'::regprocedure) is distinct from 'd29ee3fd8c75ebbb52734d13b03f1b4e|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Projection selector definition or authority changed';end if;
end$check$;
commit;
