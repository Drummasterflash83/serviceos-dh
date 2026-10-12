-- OAuth refresh writers use a restricted search_path. Preserve the installed
-- Marketing invoker functions, readiness rules and grants while qualifying the
-- exact dependency chain. The enclosing package pins all three definitions.
do $$declare signature text;d text;reference_name text;begin
 foreach signature in array array[
  'public.marketing_source_capability_sync()',
  'public.marketing_sender_capability_sync(uuid)',
  'public.marketing_sender_readiness(uuid,uuid)'
 ] loop
  d:=pg_get_functiondef(signature::regprocedure);
  foreach reference_name in array array[
   'marketing_sender_profiles','email_accounts','email_oauth_tokens',
   'google_workspace_mailboxes','google_workspace_connections',
   'tenant_connectors','tenant_connector_capabilities',
   'marketing_sender_capability_sync','marketing_sender_readiness','marketing_scope_has'
  ] loop
   d:=regexp_replace(d,'(?<![[:alnum:]_.])'||reference_name||'\M','public.'||reference_name,'g');
  end loop;
  execute d;
  execute 'alter function '||signature||' set search_path=pg_catalog';
 end loop;
end$$;
