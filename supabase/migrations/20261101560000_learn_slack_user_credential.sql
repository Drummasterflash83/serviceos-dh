-- Explicit Slack user identity for channel capture. No credential is installed,
-- no account is enabled, and no retained source record is changed.
begin;
create function public.learn_slack_credential_field(p_config jsonb) returns text
language sql immutable security invoker set search_path=pg_catalog as $$
 select case
  when jsonb_typeof(p_config) is distinct from 'object' then null
  when (not (p_config ? 'credential_kind') or p_config->'credential_kind'='"bot"'::jsonb)
    and not (p_config ? 'authorized_user_id') then 'bot_token'
  when p_config->'credential_kind'='"user"'::jsonb
    and jsonb_typeof(p_config->'authorized_user_id')='string'
    and p_config->>'authorized_user_id' ~ '^[UW][A-Z0-9]+$'
    then 'user_token'
  else null end;
$$;
revoke all on function public.learn_slack_credential_field(jsonb) from public,anon;
grant execute on function public.learn_slack_credential_field(jsonb) to authenticated,service_role;

-- Preserve all existing consent, claim, tenant, revision, capture and recurring
-- gates. Reject unexpected catalog shapes instead of silently applying a partial
-- upgrade. CREATE OR REPLACE preserves the existing function identities/grants.
do $$
declare target text; oid_value oid; original text; rewritten text; secret_reader boolean;
begin
 foreach target in array array[
  'learn_slack_start_import','learn_slack_read_credential',
  'learn_slack_start_thread_import','learn_slack_read_thread_credential',
  'learn_slack_threads_read','learn_slack_history_state',
  'learn_slack_thread_recovery_state','learn_slack_recurring_control',
  'learn_slack_schedule_recurring','learn_slack_queue_recurring_threads'
 ] loop
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=target)<>1 then
   raise exception 'slack_user_credential_catalog_count: %',target;
  end if;
  select p.oid into oid_value from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname=target;
  original:=pg_get_functiondef(oid_value);
  if position('''bot_token''' in original)=0 then raise exception 'slack_user_credential_catalog_shape: %',target;end if;
  rewritten:=replace(original,'''bot_token''=any(c.configured_fields)',
    'public.learn_slack_credential_field(c.non_secret_config)=any(c.configured_fields)');
  rewritten:=replace(rewritten,'c.secret_refs->>''bot_token''',
    'c.secret_refs->>public.learn_slack_credential_field(c.non_secret_config)');
  rewritten:=replace(rewritten,'''bot_token''=any(configured_fields)',
    'public.learn_slack_credential_field(non_secret_config)=any(configured_fields)');
  rewritten:=replace(rewritten,'secret_refs->>''bot_token''',
    'secret_refs->>public.learn_slack_credential_field(non_secret_config)');
  secret_reader:=target in ('learn_slack_read_credential','learn_slack_read_thread_credential');
  if secret_reader then
   if position('declare j public.platform_jobs%rowtype;' in rewritten)=0
    or position('perform 1 from public.provider_connections where id=p_connection_id' in rewritten)=0
    or position(''':slack:bot_token''' in rewritten)=0 then
    raise exception 'slack_user_credential_reader_shape: %',target;
   end if;
   rewritten:=replace(rewritten,'declare j public.platform_jobs%rowtype;',
    'declare credential_field text;j public.platform_jobs%rowtype;');
   rewritten:=replace(rewritten,'perform 1 from public.provider_connections where id=p_connection_id',
    'select public.learn_slack_credential_field(non_secret_config) into credential_field from public.provider_connections where id=p_connection_id');
   rewritten:=replace(rewritten,''':slack:bot_token''',''':slack:''||credential_field');
  end if;
  if rewritten=original or position('bot_token' in rewritten)>0 then
   raise exception 'slack_user_credential_patch_incomplete: %',target;
  end if;
  execute rewritten;
 end loop;
end $$;
commit;
