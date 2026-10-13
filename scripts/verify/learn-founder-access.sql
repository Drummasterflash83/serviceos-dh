-- Prepared customer access change. Execute only after approval of the named plan.
-- Caller supplies a transaction, exact project, action, run ID and fresh profile hash.
do $access$
declare
  subject constant uuid := '__APPROVED_PROFILE_ID__';
  company constant uuid := '00000000-0000-0000-0000-000000000001';
  selected_action text := current_setting('serviceos.customer_access_action',true);
  run_id text := current_setting('serviceos.customer_access_run',true);
  previous public.profiles;
  changed public.profiles;
  original jsonb;
begin
  if current_user <> 'postgres' or current_setting('serviceos.customer_access_project',true)
     is distinct from 'tgbnakbxwcqjeimygroz' or selected_action is null or selected_action not in ('grant','revert')
     or run_id is null or run_id !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' then
    raise exception 'customer_access_scope_required';
  end if;
  select * into previous from public.profiles where id=subject for update;
  if not found or lower(previous.email) <> '__APPROVED_EMAIL__'
     or md5(to_jsonb(previous)::text) is distinct from current_setting('serviceos.customer_access_row_hash',true) then
    raise exception 'customer_access_profile_changed';
  end if;
  if not exists(select 1 from auth.users where id=subject and lower(email)='__APPROVED_EMAIL__'
      and email_confirmed_at is not null and (banned_until is null or banned_until<=now()))
     or not exists(select 1 from public.tenants where id=company and slug='drummonds')
     or not exists(select 1 from public.client_portal_access where profile_id=subject and tenant_id=company)
     or exists(select 1 from public.platform_authority_grants where profile_id=subject
       and effective_from<=now() and (effective_to is null or effective_to>now())) then
    raise exception 'customer_access_identity_changed';
  end if;
  if exists(select 1 from public.controlplane_change_log where correlation_id=run_id
      and source='learn-founder-access' and action='customer.access.'||selected_action) then
    raise exception 'customer_access_already_recorded';
  end if;
  if selected_action='grant' then
    if previous.role<>'viewer' or previous.tenant_id is not null then
      raise exception 'customer_access_prior_scope_changed';
    end if;
    update public.profiles set role='admin',tenant_id=company where id=subject returning * into changed;
  else
    select a."before" into original from public.controlplane_change_log a where a.correlation_id=run_id
      and a.source='learn-founder-access' and a.action='customer.access.grant' and a.resource_id=subject::text;
    if original is null or previous.role<>'admin' or previous.tenant_id is distinct from company
       or original->>'role'<>'viewer' or original->>'tenant_id' is not null then
      raise exception 'customer_access_revert_scope_changed';
    end if;
    update public.profiles set role='viewer',tenant_id=null where id=subject returning * into changed;
  end if;
  if (to_jsonb(previous)-array['tenant_id','role','updated_at']) is distinct from
     (to_jsonb(changed)-array['tenant_id','role','updated_at']) then
    raise exception 'customer_access_unexpected_field_change';
  end if;
  insert into public.controlplane_change_log(tenant_id,actor,action,resource_type,resource_id,
    "before","after",reason,effective_at,correlation_id,view_as_active,source)
  values(company,'owner-approved:'||run_id,'customer.access.'||selected_action,'profile',subject::text,
    jsonb_build_object('role',previous.role,'tenant_id',previous.tenant_id),
    jsonb_build_object('role',changed.role,'tenant_id',changed.tenant_id),
    'Approved Drummonds founder operational access; existing identity, no platform grant',
    now(),run_id,false,'learn-founder-access');
end $access$;
