-- Aggregate-only service broker; no change to source-table permissions.
do $$declare t uuid;r jsonb;begin
 assert not has_table_privilege('service_role','public.learn_business_input_versions','SELECT'),'Raw source privilege changed';
 assert has_function_privilege('service_role','public.learn_learning_retained_counts(uuid)','EXECUTE');
 assert not has_function_privilege('authenticated','public.learn_learning_retained_counts(uuid)','EXECUTE');
 assert not has_function_privilege('anon','public.learn_learning_retained_counts(uuid)','EXECUTE');
 for t in select id from public.tenants loop
  r:=public.learn_learning_retained_counts(t);
  assert r->>'tenant_id'=t::text and r->>'version'='learn-learning-counts/1';
  assert (r->>'commusoft_versions')::bigint=(select count(*) from public.learn_business_input_versions where tenant_id=t and provider='commusoft');
  assert (r->>'slack_messages')::bigint=(select count(*) from public.slack_messages where tenant_id=t);
  assert (r-array['version','tenant_id','commusoft_versions','slack_messages'])='{}'::jsonb,'Unexpected output fields';
 end loop;
 begin perform public.learn_learning_retained_counts(null);raise exception 'Empty tenant admitted';exception when insufficient_privilege then null;end;
end$$;
