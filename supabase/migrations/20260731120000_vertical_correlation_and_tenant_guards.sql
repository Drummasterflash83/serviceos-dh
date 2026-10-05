-- Reliability Phase 5: close remaining tenant edges in the production vertical and make
-- its distributed correlation identifier mandatory from intent through outcome.

create or replace function automation_vertical_tenant_guard() returns trigger language plpgsql as $$
begin
  if tg_table_name='automation_intents' then
    if (select tenant_id from intelligence_objects where id=new.action_object_id) is distinct from new.tenant_id
       or (new.decision_id is not null and (select tenant_id from decision_log where id=new.decision_id) is distinct from new.tenant_id) then
      raise exception 'cross-tenant automation intent lineage' using errcode='integrity_constraint_violation';
    end if;
  elsif tg_table_name='automation_execution_guard_decisions' then
    if (select tenant_id from automation_intents where id=new.automation_intent_id) is distinct from new.tenant_id
       or (new.job_id is not null and (select tenant_id from platform_jobs where id=new.job_id) is distinct from new.tenant_id) then
      raise exception 'cross-tenant execution guard lineage' using errcode='integrity_constraint_violation';
    end if;
  end if;
  return new;
end $$;

create trigger automation_intents_tenant_consistency
  before insert or update of tenant_id,action_object_id,decision_id on automation_intents
  for each row execute function automation_vertical_tenant_guard();
create trigger automation_guard_decisions_tenant_consistency
  before insert on automation_execution_guard_decisions
  for each row execute function automation_vertical_tenant_guard();

-- One correlation id per intent. Existing immutable child facts cannot be rewritten; new
-- vertical facts inherit the intent correlation at insert time.
update automation_intents set correlation_id=gen_random_uuid() where correlation_id is null;
alter table automation_intents alter column correlation_id set default gen_random_uuid();
alter table automation_intents alter column correlation_id set not null;

create or replace function inherit_automation_correlation() returns trigger language plpgsql as $$
begin
  if new.correlation_id is null and new.automation_intent_id is not null then
    select correlation_id into new.correlation_id from automation_intents
      where id=new.automation_intent_id and tenant_id=new.tenant_id;
  end if;
  if new.correlation_id is null then
    raise exception 'automation lineage requires correlation_id' using errcode='not_null_violation';
  end if;
  return new;
end $$;

create trigger automation_attempts_inherit_correlation before insert on automation_execution_attempts
  for each row execute function inherit_automation_correlation();
create trigger automation_guards_inherit_correlation before insert on automation_execution_guard_decisions
  for each row execute function inherit_automation_correlation();
create trigger automation_approvals_inherit_correlation before insert on automation_approvals
  for each row execute function inherit_automation_correlation();
create trigger automation_outcomes_inherit_correlation before insert on outcomes
  for each row when (new.automation_intent_id is not null) execute function inherit_automation_correlation();
