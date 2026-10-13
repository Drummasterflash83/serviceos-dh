-- Real authenticated APIs over the retained synthetic lifecycle journey.
set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='f7600000-0000-4000-8000-000000000010';set role authenticated;
do $$declare r jsonb;d jsonb;n integer;begin
 r:=learn_slack_campaign_list(verify.id(1));assert r->>'version'='learn-slack-campaign-list/1' and r->'canWrite'='true'::jsonb;
 assert jsonb_array_length(r->'campaigns')=2 and r->'next'='null'::jsonb;
 assert r->'campaigns'->0->>'lifecycle'='ongoing' and r->'campaigns'->1->>'lifecycle'='stopped';
 assert jsonb_array_length(learn_slack_campaign_list(verify.id(2))->'campaigns')=0;
 select definition||jsonb_build_object('channelIds',jsonb_build_array('CDISPATCH')) into d from verify.campaign;
 begin perform learn_slack_campaign_dispatch(verify.id(1),verify.id(11),verify.id(200),'start',d);raise exception 'Actor mismatch accepted';exception when insufficient_privilege then null;end;
 r:=learn_slack_campaign_dispatch(verify.id(1),verify.id(10),verify.id(200),'start',d,'check');assert r->>'state'='pending';
 r:=learn_slack_campaign_dispatch(verify.id(1),verify.id(10),verify.id(200),'start',d);assert r->>'state'='recorded' and r->>'campaignId'=verify.id(200)::text;
 assert r=learn_slack_campaign_dispatch(verify.id(1),verify.id(10),verify.id(200),'start',d,'check');
 r:=learn_slack_campaign_dispatch(verify.id(1),verify.id(10),verify.id(300),'control',jsonb_build_object('campaignId',verify.id(200),'revision',1,'enabled',false,'reason','Synthetic pause'));
 assert r->'enabled'='false'::jsonb and r->'revision'='2'::jsonb;
 r:=learn_slack_campaign_dispatch(verify.id(1),verify.id(10),verify.id(301),'close',jsonb_build_object('campaignId',verify.id(200),'revision',2,'action','stop','reason','Synthetic terminal stop'));
 assert r->>'lifecycle'='stopped';
 begin perform learn_slack_campaign_dispatch(verify.id(1),verify.id(10),verify.id(302),'control','{"campaignId":"f7600000-0000-4000-8000-000000000200","revision":3,"enabled":true,"reason":"Extra field","unexpected":true}');raise exception 'Extra field accepted';exception when invalid_parameter_value then null;end;
 for n in 201..220 loop
  select definition||jsonb_build_object('channelIds',jsonb_build_array('CPAGE'||n)) into d from verify.campaign;
  perform learn_slack_campaign_dispatch(verify.id(1),verify.id(10),verify.id(n),'start',d);
 end loop;
 r:=learn_slack_campaign_list(verify.id(1));assert jsonb_array_length(r->'campaigns')=20 and r->>'next'=verify.id(217)::text;
 r:=learn_slack_campaign_list(verify.id(1),(r->>'next')::uuid);assert jsonb_array_length(r->'campaigns')=3 and r->'next'='null'::jsonb;
 assert r->'campaigns'->0->>'campaignId'=verify.id(218)::text;
end$$;
reset role;set request.jwt.claim.sub='f7600000-0000-4000-8000-000000000011';set role authenticated;
do $$begin
 begin perform learn_slack_campaign_list(verify.id(1));raise exception 'Foreign viewer read campaigns';exception when insufficient_privilege then null;end;
 assert jsonb_array_length(learn_slack_campaign_list(verify.id(2))->'campaigns')=0;
 assert learn_slack_campaign_list(verify.id(2))->'canWrite'='false'::jsonb;
end$$;
reset role;
do $$begin
 assert not has_table_privilege('authenticated','slack_history_campaigns','SELECT,UPDATE');
 assert not has_function_privilege('service_role','learn_slack_campaign_dispatch(uuid,uuid,uuid,text,jsonb,text)','EXECUTE');
end$$;
