-- Operator-only, default-OFF review of retained communications for one exact
-- reviewed Commusoft job. A shared customer is context, never a job link.
-- No provider request, source mutation, link, score or client grant on install.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create function public.new_dawn_job_context_candidates(
 p_tenant uuid,p_job uuid,p_reason text,p_limit integer default 20
) returns jsonb language plpgsql security definer
set search_path=pg_catalog set statement_timeout='10s' as $$
declare actor uuid:=auth.uid();j public.jobs%rowtype;
 reviewed_links integer;source_version uuid;source_connection_id uuid;source_job_id text;
 person_reviewed boolean:=false;company_reviewed boolean:=false;link_unchanged boolean;
 entries jsonb;has_more boolean;audit_id uuid:=gen_random_uuid();checked timestamptz;
begin
 perform public.learn_operator_input_access(p_tenant,actor,true);
 if p_job is null or p_reason is null or length(btrim(p_reason)) not between 3 and 500
  or p_limit is null or p_limit not between 1 and 20 then
  raise exception 'new_dawn_job_context_invalid' using errcode='22023';end if;
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag='new_dawn.job_context_candidates' and value='true'::jsonb for share;
 if not found then raise exception 'new_dawn_job_context_disabled' using errcode='42501';end if;
 select * into j from public.jobs where tenant_id=p_tenant and id=p_job for share;
 if not found then raise exception 'new_dawn_job_context_unavailable' using errcode='42501';end if;
 select count(*)::integer,min(l.source_version_id::text)::uuid,
  min(l.connection_id::text)::uuid,min(l.external_id)
 into reviewed_links,source_version,source_connection_id,source_job_id
 from public.learn_business_input_current_links l
 where l.tenant_id=p_tenant and l.entity_id=p_job and l.entity_kind='job'
  and l.entity_table='jobs' and l.provider='commusoft' and l.collection='jobs';
 if reviewed_links<>1 or j.source_system is distinct from
  'commusoft:connection:'||source_connection_id::text or j.external_id is distinct from source_job_id
  or j.metadata#>>'{learn_business_input,source_version_id}' is distinct from source_version::text
 then raise exception 'new_dawn_job_context_review_required' using errcode='42501';end if;
 select exists(select 1 from public.learn_business_input_current_links l
    where l.tenant_id=p_tenant and l.connection_id=source_connection_id
     and l.provider='commusoft' and l.entity_kind='customer'
     and l.entity_table='people' and l.entity_id=j.customer_person_id),
  exists(select 1 from public.learn_business_input_current_links l
    where l.tenant_id=p_tenant and l.connection_id=source_connection_id
     and l.provider='commusoft' and l.entity_kind='customer'
     and l.entity_table='companies' and l.entity_id=j.customer_company_id)
 into person_reviewed,company_reviewed;

 -- At most 21 evidence rows are evaluated. Source rows must still be retained;
 -- drafts, removed records and withheld Slack sources cannot appear. For Slack,
 -- a current-version public-channel capture attestation is also required.
 with found as materialized (
  select i.id,i.source_table,i.source_id,i.occurred_at,
   case when person_reviewed and i.related_person_id=j.customer_person_id
     and company_reviewed and i.related_company_id=j.customer_company_id
    then 'person_and_company'
    when person_reviewed and i.related_person_id=j.customer_person_id
    then 'person' else 'company' end customer_evidence
  from public.interactions i
  where i.tenant_id=p_tenant and i.source_table in('phone_calls','email_messages','slack_messages')
   and i.related_job_id is null and i.status not in('deleted','removed')
   and i.occurred_at between clock_timestamp()-interval '90 days' and clock_timestamp()
   and ((person_reviewed and i.related_person_id=j.customer_person_id)
     or (company_reviewed and i.related_company_id=j.customer_company_id))
   and not public.learn_interaction_is_draft(i.tenant_id,i.source_table,i.source_id)
   and (case i.source_table
    when 'phone_calls' then exists(select 1 from public.phone_calls s
      where s.tenant_id=p_tenant and s.id=i.source_id)
    when 'email_messages' then exists(select 1 from public.email_messages s
      where s.tenant_id=p_tenant and s.id=i.source_id)
    when 'slack_messages' then exists(
      select 1 from public.slack_messages s
      join public.slack_message_versions v on v.tenant_id=s.tenant_id
       and v.message_id=s.id and v.source_version=s.source_version
      join public.slack_source_visibility_proofs proof on proof.version_id=v.id
      join public.slack_channel_visibility_receipts receipt on receipt.id=proof.receipt_id
       and receipt.tenant_id=p_tenant and receipt.team_id=s.team_id
       and receipt.channel_id=s.channel_id
      where s.tenant_id=p_tenant and s.id=i.source_id
       and i.metadata->>'source_version'=s.source_version
       and not public.learn_slack_interaction_withheld(p_tenant,i.id))
    else false end)
  order by i.occurred_at desc,i.id desc limit p_limit+1
 ), numbered as (
  select found.*,row_number() over(order by occurred_at desc,id desc) ordinal from found
 ) select coalesce(jsonb_agg(jsonb_build_object('interaction_id',id,
    'source_table',source_table,'source_id',source_id,'occurred_at',occurred_at,
    'customer_evidence',customer_evidence,'job_identity','unverified')
    order by occurred_at desc,id desc) filter(where ordinal<=p_limit),'[]'::jsonb),
  count(*)>p_limit into entries,has_more from numbered;
 select count(*)::integer,bool_and(l.source_version_id=source_version
  and l.connection_id=source_connection_id and l.external_id=source_job_id)
 into reviewed_links,link_unchanged from public.learn_business_input_current_links l
 where l.tenant_id=p_tenant and l.entity_id=p_job and l.entity_kind='job'
  and l.entity_table='jobs' and l.provider='commusoft' and l.collection='jobs';
 if reviewed_links<>1 or link_unchanged is distinct from true then
  raise exception 'new_dawn_job_context_changed' using errcode='PT409';end if;
 perform public.learn_operator_input_access(p_tenant,actor,true);
 checked:=clock_timestamp();
 insert into public.controlplane_change_log
  (id,tenant_id,actor,action,resource_type,resource_id,after,reason,
   correlation_id,view_as_active,source)
 values(audit_id,p_tenant,actor::text,'client_jobs.context_candidates_read','jobs',p_job::text,
  jsonb_build_object('returned',jsonb_array_length(entries),'has_more',has_more),
  btrim(p_reason),audit_id::text,false,'new-dawn-job-context');
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','new-dawn-job-context-candidates/1',
  'tenant_id',p_tenant,'job_id',p_job,'actor_id',actor,'audit_id',audit_id,
  'read_at',checked,'window_days',90,'state',case when person_reviewed or company_reviewed
   then 'customer_context_only' else 'no_reviewed_customer_context' end,
  'commusoft_job_source_id',source_job_id,'commusoft_job_source_version_id',source_version,
  'job_source_freshness','unverified','communication_freshness','retained_occurrence_only',
  'job_link_state','unverified','finance_state','held_no_reviewed_cross_provider_job_mapping',
  'has_more',has_more,'candidates',entries);
end $$;
revoke all on function public.new_dawn_job_context_candidates(uuid,uuid,text,integer)
 from public,anon,authenticated,service_role;
grant execute on function public.new_dawn_job_context_candidates(uuid,uuid,text,integer)
 to authenticated;
commit;
