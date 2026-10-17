create temp table preserved as select jsonb_build_object(
 'versions',(select jsonb_agg(to_jsonb(v) order by id) from learn_business_input_versions v),
 'pages',(select jsonb_agg(to_jsonb(v) order by id) from learn_business_input_pages v),
 'links',(select jsonb_agg(to_jsonb(v) order by id) from learn_business_input_current_links v),
 'jobs',(select jsonb_agg(to_jsonb(v) order by id) from jobs v)) value;
set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000010';set role authenticated;
do $$declare r jsonb;s jsonb;ids text[]:='{}';cursor text;row jsonb;begin
 loop
  r:=learn_commusoft_source_job_cards(fixture_id(1),fixture_id(5),'',false,cursor);
  for row in select value from jsonb_array_elements(r->'rows') loop
   assert not row->>'external_id'=any(ids);ids:=array_append(ids,row->>'external_id');
   assert row->>'title'<>'FOREIGN SENTINEL';assert row->>'reviewed_job_id' is null;
  end loop;
  cursor:=r->>'next_after';exit when cursor is null;
 end loop;
 assert cardinality(ids)=38,'Pagination omitted jobs';
 assert r#>>'{counts,open_jobs}'='36';
 r:=learn_commusoft_source_job_cards(fixture_id(1),fixture_id(5),'001',true,null);
 assert jsonb_array_length(r->'rows')=1;row:=r->'rows'->0;
 assert row->>'title'='001. Domestic Income - Maintenance' and row->>'business_unit'='001. Gas';
 assert row->>'customer_identity_state'='unreviewed' and row->>'relationship_state'='customer_source_retained';
 assert row->>'company_name'='Source business' and row->>'contact_name'='Contact Only';
 r:=learn_commusoft_source_job_cards(fixture_id(1),fixture_id(5),'101',true,null);assert r#>>'{rows,0,relationship_state}'='site_customer_source_retained';
 r:=learn_commusoft_source_job_cards(fixture_id(1),fixture_id(5),'102',true,null);assert r#>>'{rows,0,relationship_state}'='property_source_missing';
 r:=learn_commusoft_source_job_cards(fixture_id(1),fixture_id(5),'103',true,null);assert r#>>'{rows,0,relationship_state}'='customer_source_missing';
 r:=learn_commusoft_source_job_cards(fixture_id(1),fixture_id(5),'104',true,null);assert r#>>'{rows,0,relationship_state}'='customer_type_unresolved';
 r:=learn_commusoft_source_job_cards(fixture_id(1),fixture_id(5),'105',true,null);assert r#>>'{rows,0,relationship_state}'='property_reference_missing';
 r:=learn_commusoft_source_job_cards(fixture_id(1),fixture_id(5),'status:on-hold',true,null);
 assert r#>>'{counts,matching_jobs}'='1' and r#>>'{rows,0,external_id}'='104';
 r:=learn_commusoft_source_job_cards(fixture_id(1),fixture_id(5),'status:needs-review',true,null);
 assert r#>>'{counts,matching_jobs}'='36' and r#>>'{counts,open_jobs}'='36';
 assert r#>>'{rows,0,reviewed_job_id}' is null and r#>>'{rows,0,source_status}'='Open';
 r:=learn_commusoft_source_job_cards(fixture_id(1),fixture_id(5),'107',false,null);assert r#>>'{rows,0,relationship_state}'='job_source_conflict' and r#>>'{rows,0,version_id}' is null and r#>>'{rows,0,source_status}' is null;
 begin perform learn_commusoft_source_job_cards(fixture_id(1),fixture_id(6));raise exception 'Foreign connection leaked';exception when insufficient_privilege then null;end;
 begin perform learn_commusoft_source_job_cards(fixture_id(2),fixture_id(6));raise exception 'Foreign tenant leaked';exception when insufficient_privilege then null;end;
 begin perform learn_commusoft_source_job_rows(fixture_id(1),fixture_id(5));raise exception 'Private helper exposed';exception when insufficient_privilege then null;end;
end$$;
reset role;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000011';set role authenticated;
do $$begin begin perform learn_commusoft_source_job_cards(fixture_id(1),fixture_id(5));raise exception 'Viewer access widened';exception when insufficient_privilege then null;end;end$$;
reset role;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000013';set role authenticated;
do $$declare r jsonb;begin
 begin perform learn_commusoft_source_job_cards(fixture_id(1),fixture_id(5));raise exception 'Operator skipped client selection';exception when insufficient_privilege then null;end;
 r:=openfolk_business_review(fixture_id(1),'learn_commusoft_source_job_cards','Synthetic explicit client support',jsonb_build_object('p_tenant',fixture_id(1),'p_connection',fixture_id(5),'p_query','001','p_open_only',true,'p_after',null));
 assert r->>'actor_id'=fixture_id(13)::text and r#>>'{result,counts,matching_jobs}'='1';
 assert nullif(current_setting('openfolk.business_review',true),'') is null,'Operator context escaped';
end$$;
reset role;
update platform_authority_grants set effective_to=clock_timestamp()-interval '1 second';
set role authenticated;
do $$begin begin perform openfolk_business_review(fixture_id(1),'learn_commusoft_source_job_cards','Expired operator',jsonb_build_object('p_tenant',fixture_id(1),'p_connection',fixture_id(5),'p_query','','p_open_only',true,'p_after',null));raise exception 'Revoked operator read succeeded';exception when insufficient_privilege then null;end;end$$;
reset role;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000010';
update provider_connections set revoked_at=clock_timestamp() where id=fixture_id(5);
set role authenticated;
do $$begin begin perform learn_commusoft_source_job_cards(fixture_id(1),fixture_id(5));raise exception 'Revoked connection accepted';exception when insufficient_privilege then null;end;end$$;
reset role;
update provider_connections set revoked_at=null where id=fixture_id(5);
update feature_flags set value='false' where flag='learn.inputs.commusoft.enabled';
set role authenticated;
do $$begin begin perform learn_commusoft_source_job_cards(fixture_id(1),fixture_id(5));raise exception 'Disabled module accepted';exception when insufficient_privilege then null;end;end$$;
reset role;
update feature_flags set value='true' where flag='learn.inputs.commusoft.enabled';
do $$begin
 assert not has_function_privilege('anon','learn_commusoft_source_job_cards(uuid,uuid,text,boolean,text)','EXECUTE');
 assert not has_function_privilege('service_role','learn_commusoft_source_job_cards(uuid,uuid,text,boolean,text)','EXECUTE');
 assert exists(select 1 from controlplane_change_log where actor=fixture_id(13)::text and action='business_review.result');
 assert (select value from preserved)=jsonb_build_object(
 'versions',(select jsonb_agg(to_jsonb(v) order by id) from learn_business_input_versions v),
 'pages',(select jsonb_agg(to_jsonb(v) order by id) from learn_business_input_pages v),
 'links',(select jsonb_agg(to_jsonb(v) order by id) from learn_business_input_current_links v),
 'jobs',(select jsonb_agg(to_jsonb(v) order by id) from jobs v));
end$$;
select 'Source jobs: unclassified customers, explicit site references, missing sources, source conflicts, pagination, work text, tenant/connection/role isolation, logged operator selection, revoked authority and source preservation passed.';
