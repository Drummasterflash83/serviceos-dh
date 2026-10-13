reset role;set search_path=public,pg_catalog;
create table verify.withheld(source uuid,interaction uuid,observation uuid,decision uuid,metric uuid,measurement uuid,indirect_measurement uuid,job uuid,graph_node uuid,graph_edge uuid,benign_node uuid,assessment uuid,recommendation uuid,suggestion uuid,card uuid,old_version text,held_version text);
grant select on verify.withheld to authenticated,service_role;
do $$declare t uuid:='f7000000-0000-4000-8000-000000000001';cfg jsonb;m jsonb;r jsonb;sid uuid;iid uuid;oid uuid:=gen_random_uuid();did uuid:=gen_random_uuid();mid uuid:=gen_random_uuid();meas uuid:=gen_random_uuid();indirect uuid:=gen_random_uuid();job uuid:=gen_random_uuid();node uuid:=gen_random_uuid();edge uuid:=gen_random_uuid();benign uuid:=gen_random_uuid();assessment uuid:=gen_random_uuid();rec uuid:=gen_random_uuid();suggestion uuid:=gen_random_uuid();card uuid:=gen_random_uuid();publication uuid:=gen_random_uuid();version uuid:=gen_random_uuid();oldhash text;begin
 select settings->'slack_history' into strict cfg from connector_accounts where tenant_id=t;
 m:='{"type":"message","ts":"1767225999.000001","text":"Retained sensitive source fixture","edited":{"ts":"1767226009.000001"}}';
 r:=jsonb_build_object('tenant_id',t,'channel_id','CPROBE','source_external_id','TPROBE:CPROBE:'||(m->>'ts'),'provider_timestamp',m->>'ts','thread_timestamp',null,'text',m->>'text','provider_payload',m);
 perform learn_slack_store_records(t,cfg,jsonb_build_array(r),null);
 select id,source_version into strict sid,oldhash from slack_messages where tenant_id=t and provider_timestamp=m->>'ts';
 select id into strict iid from interactions where tenant_id=t and source_id=sid and source_table='slack_messages';
 insert into intelligence_objects(id,tenant_id,domain,object_type,subject,source_interactions) values(oid,t,'core','Observation','Retained sensitive observation',array[iid]);
 insert into decision_log(id,tenant_id,object_id,object_snapshot,effective_profile_hash,input_hash) values(did,t,oid,jsonb_build_object('source_interactions',jsonb_build_array(iid),'subject','Retained sensitive observation'),'synthetic','synthetic');
 insert into metric_definitions(id,tenant_id,key,name) values(mid,t,'withheld.synthetic','Synthetic direct source measure');
 insert into measurements(id,tenant_id,metric_id,value,evidence) values(meas,t,mid,1,jsonb_build_array(jsonb_build_object('table','interactions','id',iid)));
 insert into measurements(id,tenant_id,metric_id,value,evidence) values(indirect,t,mid,1,jsonb_build_array(jsonb_build_object('table','intelligence_objects','id',oid)));
 insert into platform_jobs(id,tenant_id,connector_id,job_type,job_key,status,payload) values(job,t,'slack','intelligence.observe','synthetic-withheld:'||job,'queued',jsonb_build_object('observation',jsonb_build_object('source_interactions',jsonb_build_array(iid))));
 update intelligence_objects set created_from='intelligence.ingest_interaction',attributes='{"ingest":{"mapper_version":"obs-ingest/2"}}' where id=oid;
 insert into learn_observation_receipts(job_id,tenant_id,interaction_id,observation_id,receipt) values(job,t,iid,oid,'{"state":"committed"}');
 insert into graph_nodes(id,tenant_id,node_type,source_table,source_id,label) values(node,t,'interaction','interactions',iid,'Retained sensitive graph fixture');
 insert into graph_nodes(id,tenant_id,node_type,label) values(benign,t,'synthetic','Independent synthetic graph node');
 insert into graph_edges(id,tenant_id,edge_type,from_node_id,to_node_id,evidence) values(edge,t,'synthetic-withheld',node,node,jsonb_build_array(jsonb_build_object('interaction_id',iid)));
 insert into customer_cards(id,tenant_id,title) values(card,t,'Independent canonical customer');
 insert into recommendations(id,tenant_id,type,title,interaction_id,card_id) values(rec,t,'synthetic','Retained sensitive recommendation',iid,card);
 insert into interaction_match_suggestions(id,tenant_id,interaction_id,target_type,explanation) values(suggestion,t,iid,'company','Retained sensitive suggestion');
 insert into config_versions(id,tenant_id,artifact_kind,artifact_key,version) values(version,t,'synthetic_withheld','withheld-fixture',1);
 insert into learn_scorecard_publications(id,tenant_id,version_id,policy_id,revision,scope,published_by,effective_from,reason,policy)
  values(publication,t,version,gen_random_uuid(),1,'synthetic-withheld','f7000000-0000-4000-8000-000000000011','2026-01-01','Synthetic fixture','{}');
 insert into learn_assessments(id,tenant_id,publication_id,subject_kind,subject_id,window_start,window_end,recorded_at,recorded_by,reason,request,snapshot)
  select assessment,t,publication,'customer',gen_random_uuid(),'2026-01-01','2026-01-02',clock_timestamp(),'f7000000-0000-4000-8000-000000000011','Synthetic retained assessment','{}',jsonb_build_object('measurements',jsonb_build_array(jsonb_build_object('id',id))) from measurements where id=indirect;
 insert into verify.withheld values(sid,iid,oid,did,mid,meas,indirect,job,node,edge,benign,assessment,rec,suggestion,card,oldhash,null);
end$$;
set constraints all immediate;
insert into platform_authority_grants(profile_id,permission,granted_by) values('f7000000-0000-4000-8000-000000000012','platform.controlplane.admin','Synthetic withholding review');
set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='f7000000-0000-4000-8000-000000000012';set role authenticated;
do $$declare r jsonb;begin
 r:=openfolk_client_information('f7000000-0000-4000-8000-000000000001','learning_observations','Synthetic operator before hold',null,(select observation from verify.withheld));
 assert r::text like '%Retained sensitive observation%','Authorised cross-client baseline unreadable';
end$$;
reset role;set request.jwt.claim.role='service_role';
-- Observe withholding after an edited message: absence of an edited timestamp
-- on the marker must not leave the newer old body visible.
do $$declare t uuid:='f7000000-0000-4000-8000-000000000001';cfg jsonb;m jsonb;r jsonb;w verify.withheld%rowtype;heldhash text;begin
 select * into strict w from verify.withheld;
 select settings->'slack_history' into strict cfg from connector_accounts where tenant_id=t;
 m:='{"type":"message","subtype":"tombstone","hidden":true,"ts":"1767225999.000001","reply_count":1}';
 r:=jsonb_build_object('tenant_id',t,'channel_id','CPROBE','source_external_id','TPROBE:CPROBE:'||(m->>'ts'),'provider_timestamp',m->>'ts','thread_timestamp',null,'text',m->>'text','provider_payload',m);
 r:=r||jsonb_build_object('text','');
 assert learn_slack_message_kind(m)='source_withheld';
 -- An existing identity-published card has no retained per-field summary origin.
 -- Do not guess which current card prose is safe to clear or silently expose.
 begin
  insert into learn_identity_delivery_receipts(request_id,tenant_id,interaction_id,source_revision,receipt)
   values(gen_random_uuid(),t,w.interaction,repeat('a',64),jsonb_build_object('state','committed','cardId',w.card));
  begin perform learn_slack_store_records(t,cfg,jsonb_build_array(r),null);raise exception 'Ambiguous published card summary accepted';
   exception when sqlstate 'PT409' then if sqlerrm<>'slack_history_withheld_card_review_required' then raise;end if;end;
  assert (select source_version=w.old_version from slack_messages where id=w.source),'Preflight changed source';
  assert (select count(*)=1 from slack_message_versions where message_id=w.source),'Preflight retained partial page';
  raise exception 'rollback_ambiguous_card_fixture';
 exception when raise_exception then if sqlerrm<>'rollback_ambiguous_card_fixture' then raise;end if;end;

 perform learn_slack_store_records(t,cfg,jsonb_build_array(r),null);
 select source_version into strict heldhash from slack_messages where id=w.source;
 update verify.withheld set held_version=heldhash;
 assert public.learn_slack_source_withheld(t,w.source);
 assert (select not(provider_payload ? 'text') and message_text='' from slack_messages where id=w.source),'Textless marker mutated';
 assert (select count(*)=2 from slack_message_versions where message_id=w.source);
 assert (select provider_payload->>'text'='Retained sensitive source fixture' from slack_message_versions where message_id=w.source and source_version=w.old_version),'Original audit version changed';
 assert (select status='removed' and processing_status='source_withheld' and body_preview is null and summary is null and metadata->>'message_kind'='source_withheld' from interactions where id=w.interaction);
 assert (select subject='Retained sensitive observation' from intelligence_objects where id=w.observation),'Audit observation rewritten';
 assert public.learn_slack_derived_withheld(t,'assessment',w.assessment),'Saved scoring snapshot dependency missed';
 assert public.learn_slack_document_withheld(t,jsonb_build_object('measurements',jsonb_build_array(jsonb_build_object('evidence',jsonb_build_array(jsonb_build_object('table','interactions','id',w.interaction))))));
 -- Both old and apparently newer replay stay audit-only; neither clears hold.
 m:='{"type":"message","ts":"1767225999.000001","text":"Replayed old secret","edited":{"ts":"1767226999.000001"}}';
 r:=r||jsonb_build_object('text',m->>'text','provider_payload',m);
 perform learn_slack_store_records(t,cfg,jsonb_build_array(r),null);
 assert (select source_version=heldhash from slack_messages where id=w.source);
 assert (select count(*)=3 from slack_message_versions where message_id=w.source),'Replay evidence lost';
 update interactions set body_preview='Stale worker secret',summary='Stale summary',processing_status='enriched',status='active',metadata='{"secret":"stale"}' where id=w.interaction;
 assert (select body_preview is null and summary is null and processing_status='source_withheld' and status='removed' and not(metadata ? 'secret') from interactions where id=w.interaction),'Stale worker resurrected preview';
 begin update slack_messages set provider_payload=m where id=w.source;raise exception 'Direct resurrection allowed';exception when sqlstate '55000' then null;end;
 begin perform learn_observation_deliver(t,w.job,'{}',null);raise exception 'Withheld observation accepted';exception when raise_exception then if sqlerrm<>'learn_observation_source_withheld' then raise;end if;end;
 begin insert into intelligence_objects(tenant_id,domain,object_type,subject,source_interactions) values(t,'core','Observation','Stale derived secret',array[w.interaction]);raise exception 'Stale derived observation admitted';exception when sqlstate 'PT409' then null;end;
 assert learn_card_projection_inputs(t,w.card)#>>'{coverage,eligibleRecommendations}'='0','Held recommendation entered card projection';
 begin update recommendations set interaction_id=null,evidence='[]' where id=w.recommendation;raise exception 'Held recommendation provenance stripped';exception when sqlstate 'PT409' then null;end;
 begin update interaction_match_suggestions set interaction_id=(select id from interactions where tenant_id=t and id<>w.interaction limit 1),evidence='{}' where id=w.suggestion;raise exception 'Held suggestion retargeted';exception when sqlstate 'PT409' then null;end;
 begin update graph_nodes set source_table='companies',source_id=gen_random_uuid(),metadata='{}' where id=w.graph_node;raise exception 'Held node retargeted';exception when sqlstate 'PT409' then null;end;
 begin update graph_edges set from_node_id=w.benign_node,to_node_id=w.benign_node,evidence='[]' where id=w.graph_edge;raise exception 'Held edge retargeted';exception when sqlstate 'PT409' then null;end;
 begin update intelligence_objects set source_interactions='{}',evidence='[]' where id=w.observation;raise exception 'Source provenance stripped';exception when sqlstate 'PT409' then null;end;
 begin insert into decision_log(tenant_id,object_id,object_snapshot,effective_profile_hash,input_hash) values(t,w.observation,'{}','synthetic','synthetic');raise exception 'Indirect stale decision admitted';exception when sqlstate 'PT409' then null;end;
 begin perform learn_work_measurement_receipt_check(t,w.indirect_measurement);raise exception 'Indirect withheld scoring accepted';exception when sqlstate 'PT409' then null;end;
 begin perform learn_work_measurement_receipt_check(t,w.measurement);raise exception 'Withheld scoring accepted';exception when sqlstate 'PT409' then null;end;
 begin perform learn_slack_store_records(t,cfg,jsonb_build_array(r||jsonb_build_object('text','Forged normalized text','provider_payload',jsonb_build_object('ts',m->>'ts'))),null);raise exception 'Mismatched missing provider text admitted';exception when raise_exception then if sqlerrm<>'history_record_invalid' then raise;end if;end;
 begin perform learn_slack_store_records(t,cfg,jsonb_build_array(r||jsonb_build_object('text','42','provider_payload',jsonb_build_object('type','message','subtype','tombstone','hidden',true,'ts',m->>'ts','text',42))),null);raise exception 'Non-string provider marker text admitted';exception when raise_exception then if sqlerrm<>'history_record_invalid' then raise;end if;end;
 begin perform learn_slack_message_kind('{"type":"message","subtype":"tombstone","hidden":false}');raise exception 'Unmatched marker accepted';exception when raise_exception then if sqlerrm<>'slack_history_message_subtype_unsupported' then raise;end if;end;
end$$;
set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='f7000000-0000-4000-8000-000000000011';set role authenticated;
do $$declare w verify.withheld%rowtype;begin
 select * into strict w from verify.withheld;
 assert (select count(*)=0 from slack_messages where id=w.source),'Raw current source leaked';
 assert (select count(*)=0 from slack_message_versions where message_id=w.source),'Raw original versions leaked';
 assert (select count(*)=0 from interactions where id=w.interaction),'Withheld interaction leaked';
 assert (select count(*)=0 from intelligence_objects where id=w.observation),'Observation subject leaked';
 assert (select count(*)=0 from decision_log where id=w.decision),'Decision snapshot leaked';
 assert (select count(*)=0 from recommendations where id=w.recommendation),'Recommendation text leaked';
 assert (select count(*)=0 from recommendations_compat where id=w.recommendation),'Compatibility recommendation leaked';
 assert (select count(*)=0 from interaction_match_suggestions where id=w.suggestion),'Match suggestion leaked';
 assert (select count(*)=0 from graph_edges where id=w.graph_edge),'Graph evidence leaked';
 assert (select count(*)=0 from graph_nodes where id=w.graph_node),'Graph label leaked';
 assert (select count(*)=0 from platform_jobs where id=w.job),'Queued observation payload leaked';
 begin perform id from learn_assessments where id=w.assessment;raise exception 'Saved score exposed unavailable evidence';exception when sqlstate 'PT409' then null;end;
 begin perform id from measurements where id=w.measurement;raise exception 'Partial scoring silently admitted';exception when sqlstate 'PT409' then null;end;
 assert not public.learn_slack_source_read_available('f7000000-0000-4000-8000-000000000002','source',w.source),'Foreign availability oracle';
 assert not has_function_privilege('authenticated','learn_slack_document_withheld(uuid,jsonb)','execute');
end$$;
reset role;

-- Existing cross-client operator definer reads remain authorised and logged.
set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='f7000000-0000-4000-8000-000000000012';set role authenticated;
do $$declare r jsonb;w verify.withheld%rowtype;begin
 select * into strict w from verify.withheld;
 r:=openfolk_client_information('f7000000-0000-4000-8000-000000000001','communications','Synthetic operator source availability',null,w.interaction);
 assert r::text not like '%Retained sensitive%' and r::text not like '%Stale worker secret%','Operator source content leaked';
 assert r::text like '%source_withheld%','Allowed operator diagnostic stub denied';
 begin perform openfolk_client_information('f7000000-0000-4000-8000-000000000001','learning_observations','Synthetic operator source availability',null,w.observation);raise exception 'Held operator record exposed';exception when insufficient_privilege then if sqlerrm<>'operator_information_unavailable' then raise;end if;end;
 r:=openfolk_client_information('f7000000-0000-4000-8000-000000000001','learning_observations','Synthetic operator source availability');
 assert r::text not like '%Retained sensitive%','Operator observation content leaked';
end$$;
reset role;
