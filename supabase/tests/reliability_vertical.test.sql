begin;
select plan(15);

select has_function('public', 'record_response_revision_atomic', array['uuid','uuid','text','text','text','text','timestamptz'],
  'revision has a transactional database boundary');
select has_function('public', 'approve_response_intent_atomic', array['uuid','uuid','text','text','text','text','jsonb','timestamptz'],
  'approval snapshot + intent payload + approval share one transaction');
select has_function('public', 'automation_finalize_execution',
  array['uuid','uuid','uuid','text','text','jsonb','text','text','boolean','timestamptz','text','text','text','text','uuid','uuid'],
  'execution finalisation has a transactional database boundary');

select has_column('response_approval_snapshots', 'approved_payload_hash',
  'approved snapshot binds the executable payload hash');
select has_column('automation_intents', 'approved_payload_hash',
  'intent carries the approved payload hash');
select has_column('automation_execution_attempts', 'execution_payload_hash',
  'attempt records the payload hash actually executed');

select col_not_null('response_approval_snapshots', 'approved_payload_hash',
  'approved payload hash is mandatory');

select has_trigger('response_proposals', 'response_proposals_tenant_consistency',
  'proposal lineage is tenant-consistent');
select has_trigger('response_revisions', 'response_revisions_tenant_consistency',
  'revision lineage is tenant-consistent');
select has_trigger('response_approval_snapshots', 'response_snapshots_tenant_consistency',
  'approval snapshot lineage is tenant-consistent');
select has_trigger('automation_execution_attempts', 'automation_attempts_tenant_consistency',
  'execution-attempt lineage is tenant-consistent');
select has_trigger('automation_approvals', 'automation_approvals_tenant_consistency',
  'automation approval lineage is tenant-consistent');
select has_trigger('automation_intents', 'automation_intents_tenant_consistency',
  'intent action and decision lineage is tenant-consistent');
select has_trigger('automation_execution_guard_decisions', 'automation_guard_decisions_tenant_consistency',
  'guard-decision job and intent lineage is tenant-consistent');
select col_not_null('automation_intents', 'correlation_id',
  'intent correlation is mandatory');

select * from finish();
rollback;
