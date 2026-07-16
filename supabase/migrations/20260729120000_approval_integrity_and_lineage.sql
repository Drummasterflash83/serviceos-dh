-- Reliability Phases 2, 4 and 5: transactional approval, payload binding,
-- tenant-consistent lineage, and mandatory audit correlation.

alter table response_approval_snapshots add column if not exists approved_payload_hash text;
alter table automation_intents add column if not exists approved_payload_hash text;
alter table automation_execution_attempts add column if not exists execution_payload_hash text;

-- Existing snapshots are bound to the payload currently staged on their intent. This is a
-- migration baseline, not retrospective proof; future approvals are atomically bound below.
update response_approval_snapshots s set approved_payload_hash = encode(digest(i.parameters::text, 'sha256'),'hex')
from automation_intents i
where i.id=s.automation_intent_id and i.tenant_id=s.tenant_id and s.approved_payload_hash is null;
update automation_intents i set approved_payload_hash=s.approved_payload_hash
from response_approval_snapshots s
where s.automation_intent_id=i.id and s.tenant_id=i.tenant_id and i.approved_payload_hash is null;
alter table response_approval_snapshots alter column approved_payload_hash set not null;

create or replace function tenant_lineage_guard() returns trigger language plpgsql as $$
begin
  if tg_table_name='response_proposals' then
    if (select tenant_id from automation_intents where id=new.automation_intent_id) is distinct from new.tenant_id
       or (new.action_object_id is not null and (select tenant_id from intelligence_objects where id=new.action_object_id) is distinct from new.tenant_id)
       or (new.decision_id is not null and (select tenant_id from decision_log where id=new.decision_id) is distinct from new.tenant_id) then
      raise exception 'cross-tenant response proposal lineage' using errcode='integrity_constraint_violation';
    end if;
  elsif tg_table_name='response_revisions' then
    if (select tenant_id from response_proposals where id=new.response_proposal_id) is distinct from new.tenant_id
       or (select tenant_id from automation_intents where id=new.automation_intent_id) is distinct from new.tenant_id then
      raise exception 'cross-tenant response revision lineage' using errcode='integrity_constraint_violation';
    end if;
  elsif tg_table_name='response_approval_snapshots' then
    if (select tenant_id from response_proposals where id=new.response_proposal_id) is distinct from new.tenant_id
       or (select tenant_id from automation_intents where id=new.automation_intent_id) is distinct from new.tenant_id
       or (new.approved_revision_id is not null and (select tenant_id from response_revisions where id=new.approved_revision_id) is distinct from new.tenant_id) then
      raise exception 'cross-tenant response approval lineage' using errcode='integrity_constraint_violation';
    end if;
  elsif tg_table_name='automation_execution_attempts' then
    if (select tenant_id from automation_intents where id=new.automation_intent_id) is distinct from new.tenant_id
       or (new.action_object_id is not null and (select tenant_id from intelligence_objects where id=new.action_object_id) is distinct from new.tenant_id) then
      raise exception 'cross-tenant execution-attempt lineage' using errcode='integrity_constraint_violation';
    end if;
  elsif tg_table_name='automation_approvals' then
    if (select tenant_id from automation_intents where id=new.automation_intent_id) is distinct from new.tenant_id
       or (new.decision_id is not null and (select tenant_id from decision_log where id=new.decision_id) is distinct from new.tenant_id)
       or (new.review_task_id is not null and (select tenant_id from review_tasks where id=new.review_task_id) is distinct from new.tenant_id) then
      raise exception 'cross-tenant automation approval lineage' using errcode='integrity_constraint_violation';
    end if;
  end if;
  return new;
end $$;

create trigger response_proposals_tenant_consistency before insert on response_proposals for each row execute function tenant_lineage_guard();
create trigger response_revisions_tenant_consistency before insert on response_revisions for each row execute function tenant_lineage_guard();
create trigger response_snapshots_tenant_consistency before insert on response_approval_snapshots for each row execute function tenant_lineage_guard();
create trigger automation_attempts_tenant_consistency before insert on automation_execution_attempts for each row execute function tenant_lineage_guard();
create trigger automation_approvals_tenant_consistency before insert on automation_approvals for each row execute function tenant_lineage_guard();

create or replace function record_response_revision_atomic(
  p_tenant_id uuid, p_intent_id uuid, p_editor_ref text, p_editor_kind text,
  p_body text, p_change_reason text, p_now timestamptz
) returns table (revision_id uuid, revision_number int, effective_parameters jsonb)
language plpgsql as $$
declare v_intent automation_intents%rowtype; v_proposal response_proposals%rowtype;
  v_prior response_revisions%rowtype; v_number int; v_id uuid; v_params jsonb;
begin
  select * into v_intent from automation_intents where id=p_intent_id and tenant_id=p_tenant_id for update;
  if not found then raise exception 'intent_not_found' using errcode='no_data_found'; end if;
  if v_intent.status <> 'pending' then raise exception 'intent_not_pending' using errcode='restrict_violation'; end if;
  if exists(select 1 from response_approval_snapshots where tenant_id=p_tenant_id and automation_intent_id=p_intent_id) then
    raise exception 'already_approved' using errcode='restrict_violation';
  end if;
  select * into v_proposal from response_proposals where tenant_id=p_tenant_id and automation_intent_id=p_intent_id;
  if not found then raise exception 'proposal_not_found' using errcode='no_data_found'; end if;
  select * into v_prior from response_revisions where tenant_id=p_tenant_id and automation_intent_id=p_intent_id order by revision_number desc limit 1;
  v_number := coalesce(v_prior.revision_number,0)+1;
  insert into response_revisions(tenant_id,response_proposal_id,automation_intent_id,revision_number,revised_body,
    editor_ref,editor_kind,change_reason,based_on,based_on_ref,created_at)
  values(p_tenant_id,v_proposal.id,p_intent_id,v_number,p_body,p_editor_ref,coalesce(p_editor_kind,'tenant_operator'),
    p_change_reason,case when v_prior.id is null then 'ai_proposal' else 'revision' end,v_prior.id,p_now)
  returning id into v_id;
  v_params := v_intent.parameters || jsonb_build_object('body',p_body,'note',p_body,'response_provenance',
    v_proposal.provenance || jsonb_build_array(jsonb_build_object('kind','human_revision','ref',v_id::text,
      'note','edited by '||p_editor_ref||case when nullif(p_change_reason,'') is null then '' else ': '||p_change_reason end)));
  update automation_intents set parameters=v_params where id=p_intent_id;
  revision_id:=v_id; revision_number:=v_number; effective_parameters:=v_params; return next;
end $$;

create or replace function approve_response_intent_atomic(
  p_tenant_id uuid, p_intent_id uuid, p_approver_ref text, p_approver_kind text,
  p_authority_basis text, p_decision text, p_evidence jsonb, p_now timestamptz
) returns table (snapshot_id uuid, approval_id uuid, approved_payload_hash text)
language plpgsql as $$
declare v_intent automation_intents%rowtype; v_proposal response_proposals%rowtype;
  v_revision response_revisions%rowtype; v_body text; v_source text; v_provenance jsonb;
  v_params jsonb; v_hash text; v_snapshot uuid; v_approval uuid; v_corr uuid;
begin
  select * into v_intent from automation_intents where id=p_intent_id and tenant_id=p_tenant_id for update;
  if not found then raise exception 'intent_not_found' using errcode='no_data_found'; end if;
  if v_intent.status <> 'pending' then raise exception 'intent_not_pending' using errcode='restrict_violation'; end if;
  if exists(select 1 from automation_approvals where tenant_id=p_tenant_id and automation_intent_id=p_intent_id) then
    raise exception 'already_decided' using errcode='unique_violation';
  end if;
  select * into v_proposal from response_proposals where tenant_id=p_tenant_id and automation_intent_id=p_intent_id;
  if not found then raise exception 'proposal_not_found' using errcode='no_data_found'; end if;
  select * into v_revision from response_revisions where tenant_id=p_tenant_id and automation_intent_id=p_intent_id order by revision_number desc limit 1;
  v_body:=coalesce(v_revision.revised_body,v_proposal.original_body);
  v_source:=case when v_revision.id is null then 'ai_proposal' else 'revision' end;
  v_provenance:=v_proposal.provenance || case when v_revision.id is null then '[]'::jsonb else
    jsonb_build_array(jsonb_build_object('kind','human_revision','ref',v_revision.id::text,
      'note','edited by '||v_revision.editor_ref||case when nullif(v_revision.change_reason,'') is null then '' else ': '||v_revision.change_reason end)) end;
  v_params:=v_intent.parameters || jsonb_build_object('body',v_body,'note',v_body,'response_provenance',v_provenance);
  v_hash:=encode(digest(v_params::text,'sha256'),'hex');
  v_corr:=coalesce(v_intent.correlation_id,gen_random_uuid());
  update automation_intents set parameters=v_params,approved_payload_hash=v_hash,correlation_id=v_corr where id=p_intent_id;
  insert into response_approval_snapshots(tenant_id,automation_intent_id,response_proposal_id,approved_revision_id,
    source,approved_body,provenance,draft_version,approver_ref,approver_kind,approved_at,approved_payload_hash)
  values(p_tenant_id,p_intent_id,v_proposal.id,v_revision.id,v_source,v_body,v_provenance,v_proposal.draft_version,
    p_approver_ref,p_approver_kind,p_now,v_hash) returning id into v_snapshot;
  insert into automation_approvals(tenant_id,automation_intent_id,decision_id,approver_kind,approver_ref,
    authority_basis,decision,granted_at,evidence,correlation_id)
  values(p_tenant_id,p_intent_id,v_intent.decision_id,p_approver_kind,p_approver_ref,p_authority_basis,p_decision,p_now,
    coalesce(p_evidence,'{}'::jsonb)||jsonb_build_object('response_approval_snapshot_id',v_snapshot,'approved_payload_hash',v_hash),
    v_corr) returning id into v_approval;
  snapshot_id:=v_snapshot; approval_id:=v_approval; approved_payload_hash:=v_hash; return next;
end $$;

revoke all on function record_response_revision_atomic(uuid,uuid,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function record_response_revision_atomic(uuid,uuid,text,text,text,text,timestamptz) to service_role;
revoke all on function approve_response_intent_atomic(uuid,uuid,text,text,text,text,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function approve_response_intent_atomic(uuid,uuid,text,text,text,text,jsonb,timestamptz) to service_role;
