-- Run after the source-withheld fixture. The isolated runner retains the original
-- helper as verify_slack_document_withheld_baseline before installing this patch.
reset role;set session authorization postgres;
do $$declare w verify.withheld%rowtype;d jsonb;t uuid;before_result boolean;after_result boolean;cases integer:=0;begin
 select * into strict w from verify.withheld;
 for t in select unnest(array['f7000000-0000-4000-8000-000000000001'::uuid,'f7000000-0000-4000-8000-000000000002'::uuid]) loop
  for d in select value from jsonb_array_elements(jsonb_build_array(
   'null'::jsonb,'{}'::jsonb,'[]'::jsonb,'42'::jsonb,'true'::jsonb,
   jsonb_build_object('unrelated','no retained references'),
   to_jsonb(w.interaction),jsonb_build_array(w.interaction),jsonb_build_object('nested',jsonb_build_array(jsonb_build_object('id',w.interaction))),
   jsonb_build_object(w.interaction::text,'key only'),jsonb_build_object('embedded','prefix '||w.interaction::text),
   to_jsonb(upper(w.interaction::text)),to_jsonb(w.source),to_jsonb(w.observation),to_jsonb(w.measurement),to_jsonb(w.indirect_measurement),
   jsonb_build_object('measurement',jsonb_build_object('id',w.indirect_measurement)),
   jsonb_build_array(w.interaction,w.interaction,w.observation,w.measurement),
   to_jsonb(w.benign_node),to_jsonb(w.card),to_jsonb(gen_random_uuid())
  )) loop
   before_result:=public.verify_slack_document_withheld_baseline(t,d);
   after_result:=public.learn_slack_document_withheld(t,d);
   assert before_result is not distinct from after_result,'Document withholding semantics changed';cases:=cases+1;
  end loop;
 end loop;
 assert cases=42;
 assert not has_function_privilege('authenticated','public.learn_slack_document_withheld(uuid,jsonb)','execute');
 assert not has_function_privilege('anon','public.learn_slack_document_withheld(uuid,jsonb)','execute');
 assert not has_function_privilege('service_role','public.learn_slack_document_withheld(uuid,jsonb)','execute');
end$$;
