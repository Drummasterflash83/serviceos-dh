-- One retained public-channel message, under existing tenant/operator authority.
-- No provider requests, new source data, private channels, DMs or file downloads.
begin;
set local lock_timeout='3s';set local statement_timeout='30s';
create function public.learn_slack_card_source_read(p_tenant uuid,p_id uuid,p_operator_reason text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=auth.uid();s public.slack_messages%rowtype;result jsonb;audit uuid;
 operator_mode boolean:=p_operator_reason is not null;checked timestamptz;kind text;connection_id uuid;
begin
 if auth.role() is distinct from 'authenticated' or actor is null or p_tenant is null or p_id is null then
  raise exception 'slack_source_forbidden' using errcode='42501';end if;
 if operator_mode then
  perform public.learn_operator_input_access(p_tenant,actor,true);
  if length(btrim(p_operator_reason)) not between 3 and 500 then raise exception 'slack_source_reason_invalid' using errcode='22023';end if;
 else perform public.learn_import_batch_authority(p_tenant,actor);end if;
 select * into s from public.slack_messages where tenant_id=p_tenant and id=p_id for share;
 -- A channel ID prefix is not proof. Require the actual retained revision's
 -- capture-time public-channel attestation and its still-authorised workspace.
 if not found then raise exception 'slack_source_unavailable' using errcode='42501';end if;
 begin kind:=public.learn_slack_message_kind(s.provider_payload);
 exception when raise_exception then raise exception 'slack_source_unavailable' using errcode='42501';end;
 if kind is distinct from 'conversation'
  or (s.provider_payload->>'subtype'='tombstone' and s.provider_payload->'hidden'='true'::jsonb)
  or s.provider_timestamp !~ '^\d{1,12}\.\d{1,6}$'
  or s.source_version !~ '^[a-f0-9]{64}$'
  or s.message_text is distinct from s.provider_payload->>'text'
  or s.provider_timestamp is distinct from s.provider_payload->>'ts'
 then raise exception 'slack_source_unavailable' using errcode='42501';end if;
 -- Fence revocation while returning this authorised source.
 select c.id into connection_id from public.slack_message_versions v
   join public.slack_source_visibility_proofs p on p.version_id=v.id
   join public.slack_channel_visibility_receipts e on e.id=p.receipt_id and e.tenant_id=v.tenant_id
   join public.provider_connections c on c.id=e.connection_id and c.tenant_id=e.tenant_id and c.provider='slack'
    and c.status='configured' and c.revoked_at is null and c.non_secret_config->>'team_id'=e.team_id
   where v.tenant_id=s.tenant_id and v.message_id=s.id and v.source_version=s.source_version and v.provider_payload=s.provider_payload
    and e.team_id=s.team_id and e.channel_id=s.channel_id
    and e.evidence->>'version'='slack-capture-visibility/1'
    and e.evidence->>'team_id'=s.team_id and e.evidence->>'channel_id'=s.channel_id
    and e.evidence->>'connection_id'=c.id::text
    and e.evidence ?& array['is_channel','is_private','is_shared','pending_shared','is_im','is_mpim','is_ext_shared','is_org_shared','is_pending_ext_shared']
    and e.evidence->'is_channel'='true'::jsonb and e.evidence->'is_private'='false'::jsonb
    and e.evidence->'is_shared'='false'::jsonb and e.evidence->'pending_shared'='false'::jsonb
    and not exists(select 1 from unnest(array['is_im','is_mpim','is_ext_shared','is_org_shared','is_pending_ext_shared']) k
     where e.evidence->k not in('false'::jsonb,'null'::jsonb))
   limit 1 for share of c;
 if not found then raise exception 'slack_source_unavailable' using errcode='42501';end if;
 result:=jsonb_build_object('id',s.id,'tenant_id',s.tenant_id,'message_text',left(s.message_text,40000),
  'text_shortened',length(s.message_text)>40000,'team_id',left(s.team_id,100),'channel_id',left(s.channel_id,100),
  'posted_at',to_timestamp(s.provider_timestamp::numeric),'provider_timestamp',s.provider_timestamp,
  'thread_timestamp',s.thread_timestamp,'source_version',s.source_version,'retained_at',s.updated_at,
  'author_ref',case when jsonb_typeof(s.provider_payload->'user')='string' then left(s.provider_payload->>'user',100) else null end);
 if operator_mode then
  perform public.learn_operator_input_access(p_tenant,actor,true);audit:=gen_random_uuid();
  insert into public.controlplane_change_log(id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
  values(audit,p_tenant,actor::text,'slack_source.read','slack_messages',s.id::text,
   jsonb_build_object('source_version',s.source_version),btrim(p_operator_reason),audit::text,false,'learn-slack-card-source');
 else perform public.learn_import_batch_authority(p_tenant,actor);end if;
 checked:=clock_timestamp();perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','learn-slack-card-source/1','tenant_id',p_tenant,'actor_id',actor,'id',p_id,
  'record',result,'observed_at',checked,'audit_id',audit,'operator_mode',operator_mode);
end$$;
revoke all on function public.learn_slack_card_source_read(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_slack_card_source_read(uuid,uuid,text) to authenticated;
commit;
