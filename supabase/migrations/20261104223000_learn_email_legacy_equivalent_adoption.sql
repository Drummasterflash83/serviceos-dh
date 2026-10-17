-- One-time Drummonds adoption of source-equivalent legacy Email interactions.
-- Canonical fields and the historical google-workspace label are preserved.
-- Source changes after adoption return to human review instead of silently
-- replacing that provenance. The owner-only routine is not scheduled.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

do $patch$ declare definition text;needle text;guard text;begin
 definition:=pg_get_functiondef('public.learn_project_interaction(uuid,uuid,text,uuid,text,text)'::regprocedure);
 if md5(definition)<>'84240ff72b5f61364fcdb5df80bbe70c'
 then raise exception 'email_legacy_projection_baseline_changed';end if;
 needle:='if not created and i.metadata?''source_projection'' then';
 guard:='if not created and p_source=''email'' and
    i.metadata#>>''{source_projection,legacyConnectorAlias}''=''google-workspace''
    and i.metadata#>>''{source_projection,revision}'' is distinct from p_revision
    then reason:=coalesce(reason,''legacy_projection_review'');end if;'||chr(10)||'  ';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1
 then raise exception 'email_legacy_projection_anchor_changed';end if;
 execute replace(definition,needle,guard||needle);
end $patch$;

create function public.learn_email_adopt_equivalent_legacy(
 p_tenant uuid,p_after uuid default null,p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path=pg_catalog
set timezone='UTC' set statement_timeout='25s' as $$
declare candidate record; source_row public.email_messages%rowtype;
 saved public.interactions%rowtype; fields jsonb;canonical_fields jsonb;
 source_revision text;checked integer:=0;adopted integer:=0;last_id uuid;
begin
 if session_user<>'postgres' or p_tenant is distinct from
    '00000000-0000-0000-0000-000000000001'::uuid
    or p_limit is null or p_limit not between 1 and 50
 then raise exception 'email_legacy_adoption_forbidden' using errcode='42501';end if;
 if not public.learn_capture_allowed(p_tenant,'email')
 then raise exception 'email_legacy_capture_paused' using errcode='PT409';end if;
 for candidate in
  select i.id,i.source_id from public.interactions i
  where i.tenant_id=p_tenant and i.source_table='email_messages'
   and not(i.metadata ? 'source_projection')
   and (p_after is null or i.id>p_after)
  order by i.id limit p_limit
 loop
  checked:=checked+1;last_id:=candidate.id;
  perform pg_advisory_xact_lock(hashtextextended(
   'learn-project:'||p_tenant::text||':email:'||candidate.source_id::text,0));
  select * into source_row from public.email_messages m
   where m.tenant_id=p_tenant and m.id=candidate.source_id for update;
  if not found then continue;end if;
  select * into saved from public.interactions i
   where i.tenant_id=p_tenant and i.id=candidate.id
    and i.source_table='email_messages' and i.source_id=candidate.source_id
   for update;
  if not found or saved.metadata ? 'source_projection'
    or saved.source_connector_id not in('google-workspace','email')
    or saved.source_type is distinct from 'email'
    or saved.interaction_type is distinct from 'email_message'
    or source_row.provider is distinct from 'gmail'
    or to_jsonb(source_row)->>'origin_campaign_id' is not null
    or coalesce(source_row.raw_payload->'label_ids' @> '["DRAFT"]'::jsonb,false)
  then continue;end if;
  fields:=public.learn_email_source_fields(source_row);
  if not(to_jsonb(saved) @> (fields-'source_connector_id'))
  then continue;end if;
  canonical_fields:=fields||jsonb_build_object('source_connector_id',saved.source_connector_id);
  if not(to_jsonb(saved) @> canonical_fields)
  then raise exception 'email_legacy_canonical_fields_changed' using errcode='PT409';end if;
  source_revision:=public.learn_projection_revision(fields,'');
  if exists(select 1 from public.learn_interaction_projection_receipts h
   where h.tenant_id=p_tenant and h.source_kind='email'
    and h.source_id=source_row.id)
  then continue;end if;
  update public.interactions set metadata=coalesce(saved.metadata,'{}'::jsonb)
   ||jsonb_build_object('source_projection',jsonb_build_object(
    'version','learn-interaction-projection/1','revision',source_revision,
    'fields',canonical_fields,'provider',source_row.provider,
    'coverage','legacy_equivalent','accountBinding','unverified',
    'legacyConnectorAlias',case when saved.source_connector_id='google-workspace'
     then 'google-workspace' else null end))
   where tenant_id=p_tenant and id=saved.id
    and metadata is not distinct from saved.metadata;
  if not found then raise exception 'email_legacy_interaction_changed' using errcode='PT409';end if;
  insert into public.learn_interaction_projection_receipts
   (request_id,tenant_id,source_kind,source_id,source_revision,receipt)
  values(gen_random_uuid(),p_tenant,'email',source_row.id,source_revision,
   jsonb_build_object('version','learn-email-legacy-adoption/1',
    'state','committed','action','legacy_equivalent_adopted',
    'sourceKind','email','sourceId',source_row.id,'interactionId',saved.id,
    'sourceRevision',source_revision,'connectorLabelPreserved',true));
  adopted:=adopted+1;
 end loop;
 return jsonb_build_object('version','learn-email-legacy-adoption/1',
  'checked',checked,'adopted',adopted,'next_after',last_id,
  'end_of_scan',checked<p_limit);
end$$;
revoke all on function public.learn_email_adopt_equivalent_legacy(uuid,uuid,integer)
 from public,anon,authenticated,service_role;
commit;
