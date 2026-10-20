-- Give the isolated, one-page source-user reader its own tenant gate. The
-- legacy source-sync users import remains Off throughout this release.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

do $gate$
declare signature text; definition text; actual_hash text; expected_hash text;
 old_flag constant text:='learn.inputs.commusoft.users.enabled';
 new_flag constant text:='new_dawn.m2_isolated_users_page';
begin
 if exists(select 1 from public.feature_flags where tenant_id='00000000-0000-0000-0000-000000000001'::uuid
   and flag in(old_flag,new_flag))
  or exists(select 1 from public.new_dawn_commusoft_users_page_reads)
  or exists(select 1 from public.new_dawn_commusoft_users_page_versions) then
  raise exception 'isolated_users_flag_baseline_changed';end if;
 for signature,expected_hash in values
  ('public.new_dawn_commusoft_users_page_guard(uuid)',
   '800b61e6aff71dc6eeeaf8a1a896f8c262688091239b840604ad207b2a4c3be2'),
  ('public.new_dawn_commusoft_users_page_start(uuid,uuid,uuid,bigint,text)',
   '59a91835ea5b7170f0053dd5d0a4ea11808a8a6b4907f068eb81a3b895625ef9'),
  ('public.new_dawn_commusoft_users_page_saved(uuid,uuid,uuid)',
   '66db4e28c972b7292eb9ac4f1e5959fe13d1aea3e27c39d03fb55ffda2248e6c')
 loop
  definition:=pg_get_functiondef(to_regprocedure(signature));
  actual_hash:=encode(sha256(convert_to(definition,'UTF8')),'hex');
  if actual_hash is distinct from expected_hash or
   (length(definition)-length(replace(definition,old_flag,'')))/length(old_flag)<>1 then
   raise exception 'isolated_users_flag_function_changed: %',signature;end if;
  execute replace(definition,old_flag,new_flag);
  definition:=pg_get_functiondef(to_regprocedure(signature));
  if position(old_flag in definition)>0 or
   (length(definition)-length(replace(definition,new_flag,'')))/length(new_flag)<>1 then
   raise exception 'isolated_users_flag_patch_unconfirmed: %',signature;end if;
 end loop;
 if exists(select 1 from public.feature_flags where tenant_id='00000000-0000-0000-0000-000000000001'::uuid
   and flag in(old_flag,new_flag)) then
  raise exception 'isolated_users_flag_enabled_during_release';end if;
end $gate$;
commit;
