\set ON_ERROR_STOP on
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('test.uid',true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$
 select current_setting('test.role',true) $$;
create table auth.users(id uuid primary key,email text,deleted_at timestamptz,banned_until timestamptz);
create table public.tenants(id uuid primary key,slug text,status text);
create table public.feature_flags(tenant_id uuid,flag text,value jsonb);
create table public.controlplane_change_log(id uuid,tenant_id uuid,actor text,action text,
 resource_type text,resource_id text,after jsonb,reason text,correlation_id text,
 view_as_active boolean,source text);
create function public.learn_operator_input_access(p_tenant uuid,p_actor uuid,p_write boolean)
returns void language plpgsql as $$begin
 if p_actor is distinct from auth.uid() or not p_write then
  raise exception 'operator_denied' using errcode='42501';end if;
end $$;
\i /tmp/md.sql
do $$declare tenant uuid:='00000000-0000-0000-0000-000000000001';
 actor uuid:='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; receipt jsonb;
begin
 perform set_config('test.role','authenticated',false);
 perform set_config('test.uid',actor::text,false);
 insert into auth.users(id,email) values(actor,'chris@openfolk.ai');
 insert into public.tenants values(tenant,'drummonds','active');
 insert into public.feature_flags values(tenant,'new_dawn.md_view','true');
 receipt:=public.new_dawn_drummonds_md_view_open(tenant,'Client acceptance');
 if receipt->>'actor_id'<>actor::text or receipt->>'read_only'<>'true' or
  (select count(*) from public.controlplane_change_log where action='client.md_view_open'
    and view_as_active=false and reason='Client acceptance')<>1 then
  raise exception 'receipt_or_audit_missing';end if;
 update auth.users set email='other@openfolk.ai' where id=actor;
 begin perform public.new_dawn_drummonds_md_view_open(tenant,'Client acceptance');
  raise exception 'other_user_allowed'; exception when insufficient_privilege then null; end;
 update auth.users set email='chris@openfolk.ai' where id=actor;
 update public.feature_flags set value='false'::jsonb;
 begin perform public.new_dawn_drummonds_md_view_open(tenant,'Client acceptance');
  raise exception 'disabled_flag_allowed'; exception when insufficient_privilege then null; end;
 update public.feature_flags set value='true'::jsonb;
 begin perform public.new_dawn_drummonds_md_view_open(tenant,'x');
  raise exception 'short_reason_allowed'; exception when invalid_parameter_value then null; end;
 begin perform public.new_dawn_drummonds_md_view_open(gen_random_uuid(),'Client acceptance');
  raise exception 'other_tenant_allowed'; exception when insufficient_privilege then null; end;
 if has_function_privilege('anon','public.new_dawn_drummonds_md_view_open(uuid,text)','execute') or
  has_function_privilege('service_role','public.new_dawn_drummonds_md_view_open(uuid,text)','execute') or
  not has_function_privilege('authenticated','public.new_dawn_drummonds_md_view_open(uuid,text)','execute') then
  raise exception 'function_acl_invalid';end if;
end $$;
