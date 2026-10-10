-- TEST-only atomic governed import actor checks. No import or source-row changes.
begin;
set local search_path=public,pg_temp;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table of_test_deploy.migrations in share row exclusive mode;
do $$ begin
 if current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy' or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Explicit TEST target and checksum required';end if;
 if (select count(*) from of_test_deploy.migrations)<>23 or not exists(select 1 from of_test_deploy.migrations where migration_name='learn_governed_imports_v1' and source_sha256='0294ba3ef802b53ad158ee98570a79dc713840496bb45d53a4263d3f26ecea9d' and project_ref='saatxzwxvdvqevbnskxy') then raise exception 'Exact governed import release prerequisite required';end if;
 if encode(sha256(convert_to(pg_get_functiondef('public.import_row_preamble(uuid,uuid,uuid,integer,jsonb,jsonb,text)'::regprocedure),'UTF8')),'hex') is distinct from 'afb5d2f9e8acf429c34f3b6041a580bffb7a45e8d0d24fa953458c218cf66251' then raise exception 'Original import authority function differs';end if;
end $$;
set local search_path=public,pg_temp;
create or replace function import_row_preamble(
  p_tenant uuid, p_import uuid, p_actor uuid, p_row_number int,
  p_record jsonb, p_options jsonb, p_entity text
) returns data_imports
language plpgsql
as $$
declare
  v_imp data_imports%rowtype;
  v_actor_tenant uuid;
  v_actor_role text;
  v_sealed jsonb;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Import apply requires a fresh snapshot' using errcode='22023';
  end if;
  if p_tenant is null or p_import is null or p_actor is null or p_row_number is null then
    raise exception 'tenant, import, actor and row number required' using errcode = '22023';
  end if;
  if p_record is null or jsonb_typeof(p_record) <> 'object'
     or p_options is null or jsonb_typeof(p_options) <> 'object' then
    raise exception 'record and options must be objects' using errcode = '22023';
  end if;
  -- Match the existing LEARN authority-input trigger lock order. A context,
  -- profile or company change cannot race this row's authorization check.
  perform pg_advisory_xact_lock_shared(hashtextextended('learn-work-registry',0));
  perform pg_advisory_xact_lock(hashtextextended('learn-roster:'||p_tenant::text,0));
  select tenant_id, role into v_actor_tenant, v_actor_role
    from profiles where id = p_actor;
  if not found or v_actor_tenant is distinct from p_tenant then
    raise exception 'actor must be a profile of the target tenant'
      using errcode = 'integrity_constraint_violation';
  end if;
  if coalesce(v_actor_role, '') not in ('owner', 'admin') then
    raise exception 'actor lacks import authority (owner/admin required)'
      using errcode = '42501';
  end if;
  if not exists(select 1 from tenants where id=p_tenant and status='active') then
    raise exception 'Company access is unavailable' using errcode='42501';
  end if;
  if exists(select 1 from view_as_context where actor_user_id=p_actor and ended_at is null
      and (expires_at is null or expires_at>clock_timestamp())) then
    raise exception 'Exit View As before importing' using errcode='42501';
  end if;
  select * into v_imp from data_imports
   where id = p_import and tenant_id = p_tenant;
  if not found then
    raise exception 'import not found for tenant' using errcode = 'P0002';
  end if;
  if v_imp.entity_type <> p_entity then
    raise exception 'import is not a % import', p_entity using errcode = '22023';
  end if;
  if v_imp.status not in ('previewed', 'importing', 'failed', 'needs_review') then
    raise exception 'import status % does not allow row apply', v_imp.status
      using errcode = '22023';
  end if;
  if p_row_number < 2 or p_row_number > v_imp.row_count + 1 then
    raise exception 'row number is outside the sealed import' using errcode = '22023';
  end if;
  v_sealed := v_imp.preview -> 'sealed';
  if v_sealed is null or jsonb_typeof(v_sealed) is distinct from 'object'
     or jsonb_typeof(v_sealed -> 'import_options') is distinct from 'object' then
    raise exception 'import has no sealed contract — a new preview is required'
      using errcode = '22023';
  end if;
  if p_options is distinct from v_sealed -> 'import_options' then
    raise exception 'options do not match the sealed import contract'
      using errcode = '22023';
  end if;
  return v_imp;
end $$;
revoke all on function public.import_row_preamble(uuid,uuid,uuid,integer,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.import_row_preamble(uuid,uuid,uuid,integer,jsonb,jsonb,text) to service_role;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref,applied_at) values(current_setting('serviceos.release_source_sha256'),'learn_import_actor_authority_v1','saatxzwxvdvqevbnskxy',clock_timestamp());
commit;
