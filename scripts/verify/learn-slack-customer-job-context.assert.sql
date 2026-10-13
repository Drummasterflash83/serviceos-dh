-- Synthetic journey on the complete restored schema; caller rolls this back.
set local plpgsql.check_asserts=on;
create function pg_temp.sc(n integer) returns uuid language sql immutable as $$select ('ae156482-aaaa-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
grant execute on function pg_temp.sc(integer) to authenticated,anon,service_role;
insert into tenants(id,slug,display_name,status) values(pg_temp.sc(1),'slack-context-one','Synthetic Slack context','active'),(pg_temp.sc(2),'slack-context-two','Synthetic other tenant','active');
insert into auth.users(id,banned_until) values(pg_temp.sc(10),'infinity'),(pg_temp.sc(11),'infinity');
insert into profiles(id,tenant_id,role) values(pg_temp.sc(10),null,'viewer'),(pg_temp.sc(11),pg_temp.sc(1),'owner') on conflict(id) do update set tenant_id=excluded.tenant_id,role=excluded.role;
insert into platform_authority_grants(profile_id,permission,effective_from,effective_to,granted_by,reason) values(pg_temp.sc(10),'platform.controlplane.admin',now()-interval '1 hour',now()+interval '1 hour','offline','Synthetic context review');
insert into jobs(id,tenant_id,title,job_number,status) values(pg_temp.sc(20),pg_temp.sc(1),'Synthetic repair','100','open'),(pg_temp.sc(21),pg_temp.sc(2),'Foreign repair','100','open');
insert into slack_messages(id,tenant_id,source_external_id,team_id,channel_id,provider_timestamp,message_text,provider_payload,source_version,source_updated_at)
 values(pg_temp.sc(30),pg_temp.sc(1),'synthetic-message','TSYNTHETIC','CSYNTHETIC','1791800000.000001','Job 100 is waiting for a part.','{}',repeat('a',64),1791800000.000001);
insert into interactions(id,tenant_id,source_connector_id,source_type,source_table,source_id,interaction_type,direction,occurred_at,body_preview,processing_status,metadata)
 values(pg_temp.sc(40),pg_temp.sc(1),'slack','chat','slack_messages',pg_temp.sc(30),'slack_message','unknown','2026-10-12Z','Job 100 is waiting for a part.','identity_review',jsonb_build_object('source_version',repeat('a',64),'identity_delivery',jsonb_build_object('reason','direction_unverified')));
insert into platform_events(tenant_id,event_type,subject_type,subject_id,status) values(pg_temp.sc(1),'interaction.ready','interaction',pg_temp.sc(40),'pending');
create temporary table sc_saved(definition jsonb,receipt jsonb);
grant all on sc_saved to authenticated;
set local request.jwt.claim.role='authenticated';
select set_config('request.jwt.claim.sub',pg_temp.sc(10)::text,true);
set local role authenticated;
do $$declare s jsonb;d jsonb;r jsonb;begin
 s:=public.learn_operator_slack_context(pg_temp.sc(1),pg_temp.sc(40),pg_temp.sc(20),'Review the observed job reference');
 assert s->>'source_version'=repeat('a',64) and s->'job'->>'id'=pg_temp.sc(20)::text;
 d:=jsonb_build_object('revision',s->>'revision','job_id',pg_temp.sc(20),'reason','Reviewed the job reference against the retained source');
 assert public.learn_operator_slack_context_review(pg_temp.sc(1),pg_temp.sc(10),pg_temp.sc(50),pg_temp.sc(40),d,'check')->>'state'='pending';
 r:=public.learn_operator_slack_context_review(pg_temp.sc(1),pg_temp.sc(10),pg_temp.sc(50),pg_temp.sc(40),d,'apply');
 assert r->>'state'='committed' and (r->>'events_consumed')::int=1;
 assert r=public.learn_operator_slack_context_review(pg_temp.sc(1),pg_temp.sc(10),pg_temp.sc(50),pg_temp.sc(40),d,'check');
 assert r=public.learn_operator_slack_context_review(pg_temp.sc(1),pg_temp.sc(10),pg_temp.sc(50),pg_temp.sc(40),d,'apply');
 assert r=public.learn_operator_slack_context_review(pg_temp.sc(1),pg_temp.sc(10),pg_temp.sc(50),pg_temp.sc(40),d,'cancel');
 insert into sc_saved values(d,r);
 begin perform public.learn_operator_slack_context(pg_temp.sc(1),pg_temp.sc(40),pg_temp.sc(21),'Foreign job must fail');raise exception 'Foreign job accepted';exception when insufficient_privilege then null;end;
 begin perform public.learn_operator_slack_context(pg_temp.sc(2),pg_temp.sc(40),null,'Foreign source must fail');raise exception 'Foreign source accepted';exception when insufficient_privilege then null;end;
 begin perform public.learn_operator_slack_context_review(pg_temp.sc(1),pg_temp.sc(11),pg_temp.sc(51),pg_temp.sc(40),d,'apply');raise exception 'Actor mismatch accepted';exception when insufficient_privilege then null;end;
 begin perform public.learn_operator_slack_context_review(pg_temp.sc(1),pg_temp.sc(10),pg_temp.sc(50),pg_temp.sc(40),d||'{"reason":"Changed request reason"}', 'apply');raise exception 'Conflicting request accepted';exception when sqlstate 'PT409' then null;end;
end$$;
reset role;
do $$declare i interactions%rowtype;begin
 select * into i from interactions where id=pg_temp.sc(40);
 assert i.related_job_id=pg_temp.sc(20) and i.related_person_id is null and i.related_company_id is null;
 assert i.direction='unknown' and i.processing_status='enriched' and i.metadata->'identity_delivery'->>'reason'='direction_unverified';
 assert (select count(*) from learn_slack_context_reviews where tenant_id=pg_temp.sc(1))=1;
 assert not exists(select 1 from people where tenant_id=pg_temp.sc(1));
 assert not exists(select 1 from customer_cards where tenant_id=pg_temp.sc(1));
 assert (select message_text from slack_messages where id=pg_temp.sc(30))='Job 100 is waiting for a part.';
end$$;
-- Inserted after the existing genuine operator-review fixture, before source edit.
insert into companies(id,tenant_id,name) values(pg_temp.sc(60),pg_temp.sc(1),'Synthetic job owner'),(pg_temp.sc(61),pg_temp.sc(1),'Unrelated owner');
insert into customer_cards(id,tenant_id,company_id,title) values(pg_temp.sc(62),pg_temp.sc(1),pg_temp.sc(60),'Synthetic company card');
insert into provider_connections(id,tenant_id,provider,status,auth_mode,non_secret_config) values(pg_temp.sc(70),pg_temp.sc(1),'commusoft','configured','private_api_key','{"account_key":"synthetic"}');
insert into learn_business_input_request_gates(credential_fingerprint,next_allowed_at) values('synthetic-slack-customer',clock_timestamp());
create function pg_temp.scsource(collection text,payload jsonb) returns uuid language plpgsql as $$
declare v uuid:=gen_random_uuid();p uuid:=gen_random_uuid();permit uuid:=gen_random_uuid();job uuid:=gen_random_uuid();begin
 insert into public.learn_business_input_request_permits(id,tenant_id,job_id,claimed_by,attempt_count,binding,credential_fingerprint) values(permit,pg_temp.sc(1),job,'synthetic',1,'{}','synthetic-slack-customer');
 insert into public.learn_business_input_versions(id,tenant_id,connection_id,provider,collection,external_id,content_hash,payload) values(v,pg_temp.sc(1),pg_temp.sc(70),'commusoft',collection,payload->>'id',md5(payload::text)||md5(payload::text),payload);
 insert into public.learn_business_input_pages(id,tenant_id,connection_id,provider,collection,job_id,permit_id,envelope,checkpoint_before,checkpoint_after,record_count) values(p,pg_temp.sc(1),pg_temp.sc(70),'commusoft',collection,job,permit,jsonb_build_object('data',jsonb_build_array(payload)),'{}','{}',1);
 insert into public.learn_business_input_observations(page_id,version_id,ordinal) values(p,v,0);return v;
end$$;
create temporary table scproof(kind text,version uuid);
insert into scproof values('customer',pg_temp.scsource('properties','{"id":1,"type":"customer"}')),('job',pg_temp.scsource('jobs','{"id":100,"propertyID":1,"status":"ongoing"}'));
update jobs set customer_company_id=pg_temp.sc(60),source_system='commusoft:connection:'||pg_temp.sc(70),external_id='100',metadata=jsonb_build_object('learn_business_input',jsonb_build_object('connection_id',pg_temp.sc(70),'source_version_id',(select version from scproof where kind='job'),'property_external_id','1')) where id=pg_temp.sc(20);
insert into learn_business_input_links(tenant_id,connection_id,provider,collection,external_id,source_version_id,entity_kind,entity_table,entity_id,card_id,request,actor_id)
 values(pg_temp.sc(1),pg_temp.sc(70),'commusoft','properties','1',(select version from scproof where kind='customer'),'customer','companies',pg_temp.sc(60),pg_temp.sc(62),'{}',pg_temp.sc(10)),
 (pg_temp.sc(1),pg_temp.sc(70),'commusoft','jobs','100',(select version from scproof where kind='job'),'job','jobs',pg_temp.sc(20),pg_temp.sc(62),'{}',pg_temp.sc(10));
create function pg_temp.context_count() returns integer language sql as $$ select jsonb_array_length(public.learn_card_communications_read(pg_temp.sc(1),p_company=>pg_temp.sc(60))->'rows')$$;
grant execute on function pg_temp.context_count() to authenticated;
-- Synthetic retained capture proof; the actual fenced atomic writer is exercised
-- separately. No channel ID convention is used as visibility evidence.
insert into provider_connections(id,tenant_id,provider,status,auth_mode,non_secret_config)values(pg_temp.sc(90),pg_temp.sc(1),'slack','configured','api_key','{"team_id":"TSYNTHETIC"}');
insert into tenant_connectors(id,tenant_id,connector_id,provider,category,status,enabled)values(pg_temp.sc(91),pg_temp.sc(1),'slack','slack','communications','active',true);
insert into connector_accounts(id,tenant_id,tenant_connector_id,account_key,status)values(pg_temp.sc(92),pg_temp.sc(1),pg_temp.sc(91),'TSYNTHETIC:CSYNTHETIC','active');
insert into platform_jobs(id,tenant_id,job_type,job_key,status,payload)values(pg_temp.sc(93),pg_temp.sc(1),'slack.history_sync','synthetic-proof','succeeded','{}'),(pg_temp.sc(94),pg_temp.sc(1),'slack.history_sync','synthetic-public-proof','succeeded','{}');
insert into slack_message_versions(id,tenant_id,message_id,source_version,provider_payload)values(pg_temp.sc(95),pg_temp.sc(1),pg_temp.sc(30),repeat('a',64),'{}');
-- Missing capture proof with a C-prefixed channel must not be admitted.
select set_config('request.jwt.claim.sub',pg_temp.sc(11)::text,true);set local role authenticated;
do $$begin assert pg_temp.context_count()=0,'Channel prefix accepted as public proof';end$$;reset role;
insert into slack_channel_visibility_receipts(id,tenant_id,job_id,account_id,claimed_by,attempt_count,connection_id,connection_revision,team_id,channel_id,evidence,evidence_sha256,page_sha256)
 select pg_temp.sc(96),pg_temp.sc(1),pg_temp.sc(93),pg_temp.sc(92),'synthetic',1,id,updated_at,'TSYNTHETIC','CSYNTHETIC',
 '{"version":"slack-capture-visibility/1","is_channel":true,"is_private":true,"is_shared":false,"is_im":false,"is_mpim":false,"is_ext_shared":false,"is_org_shared":false,"is_pending_ext_shared":false,"pending_shared":false}',repeat('c',64),repeat('d',64) from provider_connections where id=pg_temp.sc(90);
insert into slack_source_visibility_proofs values(pg_temp.sc(96),pg_temp.sc(95));
set local role authenticated;do $$begin assert pg_temp.context_count()=0,'Private C-prefixed channel exposed';end$$;reset role;
insert into slack_channel_visibility_receipts(id,tenant_id,job_id,account_id,claimed_by,attempt_count,connection_id,connection_revision,team_id,channel_id,evidence,evidence_sha256,page_sha256,recorded_at)
 select pg_temp.sc(97),pg_temp.sc(1),pg_temp.sc(94),pg_temp.sc(92),'synthetic',1,id,updated_at,'TSYNTHETIC','CSYNTHETIC',
 '{"version":"slack-capture-visibility/1","is_channel":true,"is_private":false,"is_shared":false,"is_im":false,"is_mpim":false,"is_ext_shared":false,"is_org_shared":false,"is_pending_ext_shared":false,"pending_shared":false}',repeat('e',64),repeat('f',64),now()-interval '30 days' from provider_connections where id=pg_temp.sc(90);
insert into slack_source_visibility_proofs values(pg_temp.sc(97),pg_temp.sc(95));
-- Archived capture remains usable after an hour/day; this is historical proof,
-- not a perpetual assertion that the channel remains public today.
select set_config('request.jwt.claim.sub',pg_temp.sc(11)::text,true);
set local role authenticated;
do $$declare r jsonb;begin
 r:=learn_card_communications_read(pg_temp.sc(1),p_company=>pg_temp.sc(60));assert jsonb_array_length(r->'rows')=1;
 assert r#>>'{rows,0,job_context,kind}'='reviewed_slack_job' and r#>>'{rows,0,job_context,job_id}'=pg_temp.sc(20)::text;
 assert r#>'{rows,0,related_person_id}'='null' and r#>'{rows,0,related_company_id}'='null';
 assert jsonb_array_length(learn_card_communications_read(pg_temp.sc(1),p_company=>pg_temp.sc(61))->'rows')=0;
 assert jsonb_array_length(learn_card_communications_read(pg_temp.sc(1),p_job=>pg_temp.sc(20))->'rows')=1;
 assert learn_card_communications_read(pg_temp.sc(1),p_job=>pg_temp.sc(20))#>'{rows,0,job_context}'='null';
 begin perform learn_card_communications_read(pg_temp.sc(2),p_company=>pg_temp.sc(60));raise exception 'Foreign context admitted';exception when insufficient_privilege then null;end;
 begin perform public.learn_card_slack_job_context(pg_temp.sc(1),null,pg_temp.sc(60));raise exception 'Helper exposed directly';exception when insufficient_privilege then null;end;
end$$;reset role;
-- Each negative is rolled back, including inserted newer source evidence.
do $$declare change text;begin
 foreach change in array array[
  'update jobs set customer_company_id=pg_temp.sc(61) where id=pg_temp.sc(20)',
  'update jobs set metadata=jsonb_set(metadata,''{learn_business_input,source_version_id}'',to_jsonb(pg_temp.sc(999)::text)) where id=pg_temp.sc(20)',
  'update provider_connections set revoked_at=clock_timestamp() where id=pg_temp.sc(70)',
  'update provider_connections set revoked_at=clock_timestamp() where id=pg_temp.sc(90)',
  'update provider_connections set non_secret_config=jsonb_build_object(''team_id'',''TFOREIGN'') where id=pg_temp.sc(90)',
  'update interactions set metadata=jsonb_set(metadata,''{work_context,request_id}'',to_jsonb(pg_temp.sc(999)::text)) where id=pg_temp.sc(40)',
  'update slack_messages set source_version=repeat(''c'',64) where id=pg_temp.sc(30)',
  'update slack_messages set provider_payload=''{}''::jsonb||jsonb_build_object(''text'',''unbound changed content'') where id=pg_temp.sc(30)',
  'update interactions set status=''deleted'' where id=pg_temp.sc(40)',
  'update slack_messages set channel_id=''DSYNTHETIC'' where id=pg_temp.sc(30)',
  'select pg_temp.scsource(''jobs'',''{"id":100,"propertyID":1,"status":"completed"}'')',
  'select pg_temp.scsource(''properties'',''{"id":1,"type":"customer","changed":true}'')'
 ]loop
 begin
  execute change;perform set_config('role','authenticated',true);assert pg_temp.context_count()=0,change;
  perform set_config('role','none',true);raise exception 'rollback_probe';
 exception when raise_exception then if sqlerrm<>'rollback_probe' then raise;end if;end;
 end loop;
 assert (select related_person_id is null and related_company_id is null and direction='unknown' from interactions where id=pg_temp.sc(40));
 assert not has_table_privilege('learn_card_communication_reader','jobs','SELECT');
 assert not has_table_privilege('learn_card_communication_reader','learn_business_input_versions','SELECT');
 assert not has_function_privilege('authenticated','learn_card_slack_job_context(uuid,uuid,uuid)','EXECUTE');
 assert not has_function_privilege('service_role','learn_card_slack_job_context(uuid,uuid,uuid)','EXECUTE');
end$$;
-- Individual-customer ownership uses the same proof path without inventing authorship.
do $$declare pv uuid;jv uuid;st jsonb;begin
 begin
  insert into people(id,tenant_id,display_name)values(pg_temp.sc(80),pg_temp.sc(1),'Synthetic individual');
  insert into customer_cards(id,tenant_id,person_id,title)values(pg_temp.sc(81),pg_temp.sc(1),pg_temp.sc(80),'Synthetic person card');
  pv:=pg_temp.scsource('properties','{"id":3,"type":"customer"}');jv:=pg_temp.scsource('jobs','{"id":300,"propertyID":3,"status":"ongoing"}');
  insert into jobs(id,tenant_id,title,job_number,status,customer_person_id,source_system,external_id,metadata)values(pg_temp.sc(82),pg_temp.sc(1),'Individual job','300','open',pg_temp.sc(80),'commusoft:connection:'||pg_temp.sc(70),'300',jsonb_build_object('learn_business_input',jsonb_build_object('connection_id',pg_temp.sc(70),'source_version_id',jv,'property_external_id','3')));
  insert into learn_business_input_links(tenant_id,connection_id,provider,collection,external_id,source_version_id,entity_kind,entity_table,entity_id,card_id,request,actor_id)values
   (pg_temp.sc(1),pg_temp.sc(70),'commusoft','properties','3',pv,'customer','people',pg_temp.sc(80),pg_temp.sc(81),'{}',pg_temp.sc(10)),
   (pg_temp.sc(1),pg_temp.sc(70),'commusoft','jobs','300',jv,'job','jobs',pg_temp.sc(82),pg_temp.sc(81),'{}',pg_temp.sc(10));
  perform set_config('request.jwt.claim.sub',pg_temp.sc(10)::text,true);perform set_config('role','authenticated',true);
  st:=learn_operator_slack_context(pg_temp.sc(1),pg_temp.sc(40),pg_temp.sc(82),'Synthetic individual job');
  perform learn_operator_slack_context_review(pg_temp.sc(1),pg_temp.sc(10),pg_temp.sc(83),pg_temp.sc(40),jsonb_build_object('revision',st->>'revision','job_id',pg_temp.sc(82),'reason','Synthetic individual job verified'),'apply');
  perform set_config('role','none',true);perform set_config('request.jwt.claim.sub',pg_temp.sc(11)::text,true);perform set_config('role','authenticated',true);
  st:=learn_card_communications_read(pg_temp.sc(1),p_person=>pg_temp.sc(80));
  assert jsonb_array_length(st->'rows')=1 and st#>>'{rows,0,job_context,person_id}'=pg_temp.sc(80)::text;
  assert st#>'{rows,0,related_person_id}'='null' and st#>'{rows,0,job_context,company_id}'='null';
  perform set_config('role','none',true);raise exception 'rollback_probe';
 exception when raise_exception then if sqlerrm<>'rollback_probe' then raise;end if;end;
end$$;
-- A site-owned job must carry the same reviewed customer and current site proof.
insert into scproof values('site',pg_temp.scsource('properties','{"id":2,"type":"workaddress","parentPropertyID":1}')),('sitejob',pg_temp.scsource('jobs','{"id":200,"propertyID":2,"status":"ongoing"}'));
insert into sites(id,tenant_id,company_id,metadata) values(pg_temp.sc(71),pg_temp.sc(1),pg_temp.sc(60),jsonb_build_object('learn_business_input',jsonb_build_object('connection_id',pg_temp.sc(70),'source_version_id',(select version from scproof where kind='site'))));
insert into jobs(id,tenant_id,title,job_number,status,site_id,customer_company_id,source_system,external_id,metadata)
 values(pg_temp.sc(72),pg_temp.sc(1),'Synthetic site job','200','open',pg_temp.sc(71),pg_temp.sc(60),'commusoft:connection:'||pg_temp.sc(70),'200',jsonb_build_object('learn_business_input',jsonb_build_object('connection_id',pg_temp.sc(70),'source_version_id',(select version from scproof where kind='sitejob'),'property_external_id','2')));
insert into learn_business_input_links(tenant_id,connection_id,provider,collection,external_id,source_version_id,entity_kind,entity_table,entity_id,card_id,request,actor_id)
 values(pg_temp.sc(1),pg_temp.sc(70),'commusoft','properties','2',(select version from scproof where kind='site'),'site','sites',pg_temp.sc(71),pg_temp.sc(62),'{}',pg_temp.sc(10)),
 (pg_temp.sc(1),pg_temp.sc(70),'commusoft','jobs','200',(select version from scproof where kind='sitejob'),'job','jobs',pg_temp.sc(72),pg_temp.sc(62),'{}',pg_temp.sc(10));
select set_config('request.jwt.claim.sub',pg_temp.sc(10)::text,true);set local role authenticated;
do $$declare s jsonb;begin
 s:=learn_operator_slack_context(pg_temp.sc(1),pg_temp.sc(40),pg_temp.sc(72),'Synthetic site linkage review');
 perform learn_operator_slack_context_review(pg_temp.sc(1),pg_temp.sc(10),pg_temp.sc(73),pg_temp.sc(40),jsonb_build_object('revision',s->>'revision','job_id',pg_temp.sc(72),'reason','Synthetic verified site job'),'apply');
end$$;reset role;
select set_config('request.jwt.claim.sub',pg_temp.sc(11)::text,true);set local role authenticated;
do $$begin assert pg_temp.context_count()=1,'Site owner proof unavailable';end$$;reset role;
do $$begin
 begin update sites set company_id=pg_temp.sc(61) where id=pg_temp.sc(71);perform set_config('role','authenticated',true);assert pg_temp.context_count()=0;perform set_config('role','none',true);raise exception 'rollback_probe';exception when raise_exception then if sqlerrm<>'rollback_probe' then raise;end if;end;
end$$;
-- Restore original reviewed context so the source-edit fixture proves invalidation.
select set_config('request.jwt.claim.sub',pg_temp.sc(10)::text,true);set local role authenticated;
do $$declare s jsonb;begin
 s:=learn_operator_slack_context(pg_temp.sc(1),pg_temp.sc(40),pg_temp.sc(20),'Restore original synthetic job');
 perform learn_operator_slack_context_review(pg_temp.sc(1),pg_temp.sc(10),pg_temp.sc(74),pg_temp.sc(40),jsonb_build_object('revision',s->>'revision','job_id',pg_temp.sc(20),'reason','Restore original synthetic job'),'apply');
end$$;reset role;

-- Real source-update shape invalidates the active link, preserving review history.
update slack_messages set source_version=repeat('b',64),message_text='The job reference was corrected.' where id=pg_temp.sc(30);
update interactions set metadata=metadata||jsonb_build_object('source_version',repeat('b',64)),body_preview='The job reference was corrected.' where id=pg_temp.sc(40);
do $$begin
 assert (select related_job_id is null and processing_status='pending' and metadata->'work_context'->>'state'='source_changed' from interactions where id=pg_temp.sc(40));
 assert (select count(*) from learn_slack_context_reviews where tenant_id=pg_temp.sc(1))=3;
 begin update learn_slack_context_reviews set receipt='{}' where request_id=pg_temp.sc(50);raise exception 'History changed';exception when sqlstate '55000' then null;end;
end$$;
set local role authenticated;
do $$declare s jsonb;d jsonb;r jsonb;begin
 select definition into d from sc_saved;
 begin perform public.learn_operator_slack_context_review(pg_temp.sc(1),pg_temp.sc(10),pg_temp.sc(51),pg_temp.sc(40),d,'apply');raise exception 'Stale revision accepted';exception when sqlstate 'PT409' then null;end;
 r:=public.learn_operator_slack_context_review(pg_temp.sc(1),pg_temp.sc(10),pg_temp.sc(51),pg_temp.sc(40),d,'cancel');
 assert r->>'state'='cancelled';
 assert r=public.learn_operator_slack_context_review(pg_temp.sc(1),pg_temp.sc(10),pg_temp.sc(51),pg_temp.sc(40),d,'apply');
 s:=public.learn_operator_slack_context(pg_temp.sc(1),pg_temp.sc(40),null,'Keep the corrected conversation as company context');
 d:=jsonb_build_object('revision',s->>'revision','job_id',null,'reason','Reviewed as company context, no verified job reference');
 r:=public.learn_operator_slack_context_review(pg_temp.sc(1),pg_temp.sc(10),pg_temp.sc(52),pg_temp.sc(40),d,'apply');
 assert r->'context'->>'scope'='company' and r->'context'->'job_id'='null';
end$$;
reset role;
update platform_authority_grants set effective_to=now()-interval '1 second' where profile_id=pg_temp.sc(10);
set local role authenticated;
do $$begin
 begin perform public.learn_operator_slack_context(pg_temp.sc(1),pg_temp.sc(40),null,'Revocation must deny reads');raise exception 'Revoked read accepted';exception when insufficient_privilege then null;end;
 begin perform public.learn_operator_slack_context_review(pg_temp.sc(1),pg_temp.sc(10),pg_temp.sc(50),pg_temp.sc(40),(select definition from sc_saved),'check');raise exception 'Revoked receipt access accepted';exception when insufficient_privilege then null;end;
end$$;
reset role;
do $$begin
 assert not has_function_privilege('anon','learn_operator_slack_context(uuid,uuid,uuid,text)','execute');
 assert not has_function_privilege('service_role','learn_operator_slack_context_review(uuid,uuid,uuid,uuid,jsonb,text)','execute');
 assert not has_table_privilege('authenticated','learn_slack_context_reviews','select');
 assert not has_function_privilege('authenticated','learn_slack_context_state(uuid,uuid,uuid)','execute');
end$$;
select 'Slack job/company context, replay, changed source, tenant isolation, actor and revocation checks passed';
