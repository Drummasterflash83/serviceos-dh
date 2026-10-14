CREATE OR REPLACE FUNCTION public.learn_observation_deliver(p_tenant uuid, p_job uuid, p_claim jsonb, p_result jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare q public.platform_jobs%rowtype; i public.interactions%rowtype;
 g public.intelligence_ingestions%rowtype; d jsonb; pkg jsonb; op jsonb; obj jsonb;
 r jsonb; oid uuid; did uuid; nid uuid; iid uuid; node record; anchor uuid; nodes uuid[]:='{}';
begin
 select * into q from public.platform_jobs where id=p_job and tenant_id=p_tenant for update;
 if not found or q.job_type<>'intelligence.observe' then raise exception 'learn_observation_job_unavailable';end if;
 if public.learn_slack_document_withheld(p_tenant,q.payload) then raise exception 'learn_observation_source_withheld';end if;
 select receipt into r from public.learn_observation_receipts where job_id=p_job and tenant_id=p_tenant;
 if found then return r;end if;
 if p_result is null then return jsonb_build_object('version','learn-observation-delivery/1','state','pending','job_id',p_job,'tenant_id',p_tenant);end if;
 if p_claim->>'claimedBy' is null or p_claim->>'attemptCount' is null or q.status<>'running' or q.claimed_by is distinct from p_claim->>'claimedBy'
 or q.attempt_count is distinct from (p_claim->>'attemptCount')::int
 or q.lease_expires_at is null or q.lease_expires_at<=clock_timestamp()
 then raise exception 'learn_observation_lease_unavailable';end if;
 d:=q.payload->'observation';pkg:=p_result->'package';op:=p_result->'operational';obj:=p_result->'object';
 if d->>'created_from' is distinct from 'intelligence.ingest_interaction' or d#>>'{attributes,ingest,mapper_version}' is distinct from 'obs-ingest/2'
 or jsonb_array_length(d->'source_interactions') is distinct from 1
 or op->>'blocked_reason' is distinct from 'mode_observe_only'
 or op->'can_execute' is distinct from 'false'::jsonb
 or obj->>'tenant_id' is distinct from p_tenant::text
 or obj->>'object_type' is distinct from 'Observation'
 or obj->>'subject' is distinct from d->>'subject'
 or obj->'source_interactions' is distinct from d->'source_interactions'
 or obj->'attributes' is distinct from d->'attributes'
 or pkg->>'id' is null then raise exception 'learn_observation_result_invalid';end if;
 iid:=(d->'source_interactions'->>0)::uuid;oid:=(obj->>'id')::uuid;did:=(pkg->>'id')::uuid;
 if oid is null or did is null then raise exception 'learn_observation_result_invalid';end if;
 select * into i from public.interactions where id=iid and tenant_id=p_tenant for share;
 if not found or i.processing_status<>'enriched' or d#>>'{attributes,ingest,source_updated_at}' is null
 or i.updated_at is distinct from (d#>>'{attributes,ingest,source_updated_at}')::timestamptz
 then raise exception 'learn_observation_source_changed';end if;
 select * into g from public.intelligence_ingestions where tenant_id=p_tenant and interaction_id=iid and mapper_version='obs-ingest/2' for update;
 if not found or g.status<>'enqueued' or g.observe_job_id is distinct from p_job
 then raise exception 'learn_observation_lineage_unavailable';end if;
 -- Project only verified foreign-key relationships for this retained interaction.
 -- Existing graph nodes/edges are reused; no identity guesses or source updates.
 if (i.related_person_id is not null and not exists(select 1 from public.people where tenant_id=p_tenant and id=i.related_person_id))
 or (i.related_company_id is not null and not exists(select 1 from public.companies where tenant_id=p_tenant and id=i.related_company_id))
 or (i.related_job_id is not null and not exists(select 1 from public.jobs where tenant_id=p_tenant and id=i.related_job_id))
 then raise exception 'learn_observation_reference_unavailable';end if;
 for node in select * from (values (1,'interaction','interactions',i.id),(2,'person','people',i.related_person_id),
 (3,'company','companies',i.related_company_id),(4,'job','jobs',i.related_job_id)) n(ord,kind,tab,id) where id is not null order by ord loop
  insert into public.graph_nodes(tenant_id,node_type,source_table,source_id,label,metadata)
  values(p_tenant,node.kind,node.tab,node.id,initcap(node.kind),jsonb_build_object('projection','learn-observation/1'))
  on conflict(tenant_id,node_type,source_table,source_id) where source_id is not null do nothing;
  select id into strict nid from public.graph_nodes where tenant_id=p_tenant and node_type=node.kind and source_table=node.tab and source_id=node.id;
  nodes:=array_append(nodes,nid);
  if node.kind='interaction' then anchor:=nid;else
   insert into public.graph_edges(tenant_id,edge_type,from_node_id,to_node_id,confidence,evidence,metadata)
   values(p_tenant,'relates_to',anchor,nid,1,jsonb_build_array(jsonb_build_object('interaction_id',iid)),jsonb_build_object('projection','learn-observation/1'))
   on conflict(tenant_id,edge_type,from_node_id,to_node_id) do nothing;
  end if;
 end loop;
 insert into public.intelligence_objects(id,tenant_id,domain,object_type,object_class,subject,severity,confidence,ambiguity,risk,reversibility,status,
 evidence,source_interactions,source_entities,created_by,created_from,attributes,decision_id)
 values(oid,p_tenant,d->>'domain','Observation','observation',d->>'subject',d->>'severity',(d->>'confidence')::numeric,(d->>'ambiguity')::numeric,
 (d->>'risk')::numeric,(d->>'reversibility')::numeric,'monitoring',coalesce(d->'evidence','[]'),array[iid],nodes,'system',d->>'created_from',d->'attributes',did);
 insert into public.decision_log(id,tenant_id,object_id,object_snapshot,effective_profile_hash,policy_version_ids,matched_rules,outputs,
 input_hash,decision,operational_mode,next_owner_kind,engine_version,operating_profile_version,learning_version_ids,reason_codes,correlation_id,
 output_hash,supersedes,decision_package)
 values(did,p_tenant,oid,obj,pkg#>>'{audit,inputHash}',array(select jsonb_array_elements_text(pkg#>'{versions,policyVersionIds}'))::uuid[],pkg#>'{rationale,policyMatches}',
 jsonb_build_object('decision',pkg->'decision','reason_codes',pkg#>'{rationale,reasonCodes}','next_owner',pkg->'nextDecisionOwner','operational',op),
 pkg#>>'{audit,inputHash}',pkg->>'decision',op->>'mode',pkg#>>'{nextDecisionOwner,kind}',pkg#>>'{versions,engineVersion}',pkg#>>'{versions,operatingProfileVersion}',
 array(select jsonb_array_elements_text(pkg#>'{versions,learningVersionIds}')),array(select jsonb_array_elements_text(pkg#>'{rationale,reasonCodes}')),
 (pkg#>>'{audit,correlationId}')::uuid,pkg#>>'{audit,outputHash}',(pkg->>'supersedes')::uuid,pkg);
 insert into public.object_state_history(tenant_id,object_id,to_state,actor,reason,decision_id)
 values(p_tenant,oid,'monitoring','{"kind":"automation","ref":"intelligence.observe"}', 'Observation recorded in observe-only mode; no action executed',did);
 insert into public.platform_events(tenant_id,event_type,subject_type,subject_id,source,domain,actor,payload,metadata)
 values(p_tenant,'intelligence.observation.created','intelligence_object',oid,'intelligence.observe',d->>'domain',
 '{"kind":"automation","ref":"intelligence.observe"}',jsonb_build_object('decision',pkg->'decision'),jsonb_build_object('decision_id',did,'job_id',p_job));
 update public.intelligence_ingestions set observation_id=oid,correlation_id=(pkg#>>'{audit,correlationId}')::uuid,status='observed' where id=g.id;
 r:=jsonb_build_object('version','learn-observation-delivery/1','state','committed','job_id',p_job,'tenant_id',p_tenant,
 'interaction_id',iid,'observation_id',oid,'decision_id',did,'decision',pkg->'decision','operational_mode',op->'mode','can_execute',false,'action_ids','[]'::jsonb,'graph_nodes',cardinality(nodes));
 insert into public.learn_observation_receipts(job_id,tenant_id,interaction_id,observation_id,receipt) values(p_job,p_tenant,iid,oid,r);
 return r;
end$function$;
