/** Prepare exact release operation pins, offline. Does not approve or execute.
 * Runtime/database/configuration/HTTP adapters and live gates remain separate.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { validateReleasePlan } from './learn-production-release-journal.mjs';
const sha = b => createHash('sha256').update(b).digest('hex');
const read = p => JSON.parse(readFileSync(p));
const base = 'supabase/release/learn-production/';
const runtimeBytes = readFileSync(base+'runtime-candidate.manifest.json');
const candidate = JSON.parse(runtimeBytes), candidateSha256 = sha(runtimeBytes);
const wireRoot = '.verification-results/production-runtime-wire-20261012-commusoft-recurring';
const wire = read(join(wireRoot,'report.json'));
const backupRoot = '.verification-results/production-runtime-compiled-backup-20261012';
const backup = read(join(backupRoot,'report.json'));
const schedules = read(base+'schedule-transition.manifest.json');
const frontend = read('docs/operations/evidence/learn-production-frontend-slack-setup-2026-10-12.json');
if (candidate.projectRef!=='tgbnakbxwcqjeimygroz' || candidate.database.length!==20 || candidate.endpoints.length!==37 ||
    wire.projectRef!==candidate.projectRef || wire.candidateManifestSha256!==candidateSha256 ||
    wire.state!=='prepared_not_uploaded' || schedules.runtime.sha256!==candidateSha256 ||
    backup.projectRef!==candidate.projectRef || backup.state!=='compiled_artifacts_retained_with_unchanged_deployment_metadata')
  throw Error('Exact production artifact set required');
const verified = (path,expected) => { if(sha(readFileSync(path))!==expected) throw Error('Pinned file changed: '+path); };
const binding=read('docs/operations/evidence/learn-production-commusoft-recurring-2026-10-12.json');
const originalRoot='.verification-results/production-runtime-bundle-20261012-commusoft-recurring';
verified(join(originalRoot,'report.json'),binding.bundleReportSha256);
verified(join(originalRoot,'boot-carried-forward/report.json'),binding.bootReportSha256);
const bundled=read(join(originalRoot,'report.json')), boot=read(join(originalRoot,'boot-carried-forward/report.json'));
const callerPath='.verification-results/production-scheduler-callers-after-20261012/report.json';
verified(callerPath,binding.callerReportSha256);
const caller=read(callerPath);
for(const source of binding.sources) verified(source.path,source.sha256);
if(caller.manifestSha256!==bundled.derivation?.priorManifestSha256 || caller.sourceClosureSha256!==candidate.sourceClosureSha256 || caller.state!=='scheduler_callers_verified_offline' ||
   !caller.containerRemoved || caller.checks.length!==28 || caller.checks.some(c=>!c.passed) ||
   caller.artifacts.some(a=>a.sha256!==bundled.endpoints.find(e=>e.name===a.name)?.eszipSha256))
  throw Error('Exact scheduler caller acceptance differs');
if(binding.candidateManifestSha256!==candidateSha256 || bundled.manifestSha256!==candidateSha256 ||
   boot.manifestSha256!==candidateSha256 || bundled.sourceClosureSha256!==candidate.sourceClosureSha256 ||
   boot.sourceClosureSha256!==candidate.sourceClosureSha256 ||
   boot.state!=='all_endpoints_booted_and_rejected_missing_auth' || !boot.containerRemoved)
  throw Error('Original exact-artifact acceptance binding differs');
const recovery=read('docs/operations/evidence/learn-production-runtime-recovery-2026-10-12.json');
for (const file of candidate.files) verified(join('supabase/functions',file.path),file.sha256);
for (const item of candidate.database) {
  verified(item.path,item.sha256);
  const manifestPath=item.path.replace('.sql','.manifest.json');
  verified(manifestPath,item.manifestSha256);
  for(const source of read(manifestPath).sources ?? []) verified(source.path,source.sha256);
}
for(const item of [schedules.baseline,...schedules.outputs]) verified(item.path,item.sha256);
if(wire.endpoints.length!==37 || new Set(wire.endpoints.map(e=>e.name)).size!==37 ||
   backup.endpoints.length!==28 || new Set(backup.endpoints.map(e=>e.name)).size!==28)
  throw Error('Incomplete or ambiguous runtime transport/recovery');
for(const e of candidate.endpoints) {
  const w=wire.endpoints.find(v=>v.name===e.name);
  if(!w || w.verifyJwt!==e.verifyJwt || w.request.bodyFile!==e.name+'.ezbr') throw Error('Runtime transport differs');
  verified(join(wireRoot,w.request.bodyFile),w.ezbrSha256);
  const body=readFileSync(join(wireRoot,w.request.bodyFile));
  const artifact=bundled.endpoints.find(v=>v.name===e.name), check=boot.checks.find(v=>v.name===e.name);
  if(body.length!==w.ezbrBytes || body.subarray(0,4).toString()!=='EZBR' ||
     sha(brotliDecompressSync(body.subarray(4),{maxOutputLength:20000000}))!==artifact?.eszipSha256 ||
     w.eszipSha256!==artifact.eszipSha256 || artifact.verifyJwt!==e.verifyJwt || !check?.denied)
    throw Error('Transport is not the accepted runtime artifact');
  const params=new URLSearchParams({verify_jwt:String(e.verifyJwt),entrypoint_path:`file:///work/supabase/functions/${e.name}/index.ts`,ezbr_sha256:w.ezbrSha256});
  if(!e.beforeProduction){params.set('slug',e.name);params.set('name',e.name);}
  if(w.request.method!==(e.beforeProduction?'PATCH':'POST') ||
     w.request.path!==`/v1/projects/${candidate.projectRef}/functions${e.beforeProduction?'/'+e.name:''}?${params}` ||
     w.request.contentType!=='application/vnd.denoland.eszip') throw Error('Transport destination or metadata differs');
  if(e.beforeProduction) {
    const b=backup.endpoints.find(v=>v.name===e.name);
    if(!b || ['id','version','hash','jwt','status'].some(k=>b[k]!==e.beforeProduction[k])) throw Error('Recovery baseline differs');
    if(JSON.stringify(b)!==JSON.stringify(recovery.compiledBackup.endpoints.find(v=>v.name===e.name)))
      throw Error('Recovery artifact differs from retained public evidence');
    verified(join(backupRoot,e.name+'.eszip'),b.eszipSha256);
    verified(join(backupRoot,e.name+'.ezbr'),b.ezbrSha256);
  }
}
if(frontend.id!=='dpl_tZasPdqxDNGDk8JGQ4v7WzsTy5Ea' || frontend.gitSha!=='04f7f8edd8e3d55637ce0376698a746191a403b2' ||
   frontend.state!=='protected_production_configured_preview_ready') throw Error('Reviewed frontend artifact required');
const operations=[];
function add(id,kind,contract) { operations.push({id,kind,contract,pinSha256:sha(JSON.stringify(contract))}); }
add('fresh-release-preflight','check',{
  candidateSha256,requires:['explicit_exact_release_approval','fresh_production_schema_and_runtime_match',
    'current_independent_recovery_checkpoint','reviewed_client_and_module_activation_scope',
    'positive_caller_contracts_including_changed_gateway_flags','production_frontend_served_binding',
    'manual_and_external_caller_coordination','matching_frontend_with_update_window_controls_verified'],
});
add('pause-existing-schedules','schedule',schedules.outputs.find(v=>v.mode==='pause'));
add('verify-in-flight-drain','check',{requires:['pause_readback','no_active_worker_leases',
  'no_current_runtime_or_downstream_execution','manual_and_external_callers_fenced'],
  forbiddenSubstitutes:['empty_http_queue_only','cron_completion_only','deletion_of_stale_run_records']});
add('fresh-preservation-checkpoint','check',{requires:['consistent_source_ids_and_content_fingerprints',
  'existing_relationships_and_storage_pointers','complete_schema_roles_receipts_schedules_and_runtime_baseline']});
for(const d of candidate.database) add('database-'+d.path.split('/').at(-1).slice(0,3),'database',d);
add('matching-server-configuration','configuration',{
  nonSecret:{...candidate.requiredNonSecretConfiguration,'platform-worker':{LEARN_INPUT_DISPATCH_ENABLED:'false'}},
  requiredNewSecretNames:['LEARN_COMMUSOFT_WORKER_KEY','LEARN_SLACK_WORKER_KEY'],
  requires:['existing_credentials_preserved','reviewed_secure_provisioning','verified_matching_caller_bindings'],
  captureActivation:false,secretValuesIncluded:false,
});
for(const e of candidate.endpoints) {
  const w=wire.endpoints.find(v=>v.name===e.name);
  add('runtime-'+e.name,'runtime',{name:e.name,before:e.beforeProduction,verifyJwt:e.verifyJwt,
    eszipSha256:w.eszipSha256,ezbrSha256:w.ezbrSha256,request:w.request});
}
add('publish-runtime-metadata','runtime',{action:'publish_metadata',method:'PUT',
  path:`/v1/projects/${candidate.projectRef}/functions`,
  targets:candidate.endpoints.map(e=>({name:e.name,verifyJwt:e.verifyJwt,
    ezbrSha256:wire.endpoints.find(w=>w.name===e.name).ezbrSha256})),
  reference:'https://supabase.com/docs/reference/api/v1-bulk-update-functions'});
add('runtime-publication-readback','check',{requires:['all_37_exact_artifacts_and_gateway_flags',
  'provider_publication_metadata_confirmed','unchanged_endpoints_outside_release']});
add('paired-runtime-acceptance','check',{requires:['positive_scheduled_and_user_callers','tenant_isolation',
  'production_metadata_reader','matched_database_receipts','source_preservation','protected_preview_journeys']});
add('promote-matching-frontend','frontend',{project:frontend.project,id:frontend.id,url:frontend.url,
  gitSha:frontend.gitSha,previousProductionDeployment:frontend.productionDeploymentUnchanged});
add('signed-in-live-acceptance','check',{requires:['actual_openfolk_ai_deployment_and_production_backend',
  'drummonds_branding','client_learn_inputs_context_cards_and_operator_controls','source_preservation']});
add('activate-reviewed-input-dispatch','configuration',{
  nonSecret:{'platform-worker':candidate.requiredNonSecretConfiguration['platform-worker']},
  requires:['current_exact_release_approval','reviewed_queued_import_and_recurring_channel_scope',
    'matching_server_trigger_keys','positive_empty_body_worker_acceptance','matching_queue_schema_and_runtime',
    'no_unapproved_test_capture_or_new_provider_permissions'],
  captureActivation:'dispatch_previously_approved_queue_work_only',createsImportApprovals:false,
  createsRecurringChannelApprovals:false,secretValuesIncluded:false,
});
add('restore-existing-schedules','schedule',schedules.outputs.find(v=>v.mode==='restore'));
add('observe-initial-live-capture','check',{requires:['original_schedule_states','real_new_provider_inputs',
  'durable_source_to_card_processing','coverage_and_failure_diagnostics','no_unapproved_capture_activation']});
add('release-acceptance-record','check',{requires:['all_agreed_goal_requirements_evidenced',
  'recovery_and_operational_handover','known_limits_disclosed'],completeGoalAutomatically:false});
const plan=validateReleasePlan({version:'learn-production-release-sequence/1',projectRef:candidate.projectRef,
  candidateSha256,steps:operations.map(({id,kind,pinSha256})=>({id,kind,pinSha256}))});
writeFileSync(base+'release-sequence.plan.json',JSON.stringify(plan,null,2)+'\n');
writeFileSync(base+'release-operations.manifest.json',JSON.stringify({version:'learn-production-release-operations/1',
  state:'deployment_authorised_execution_gates_incomplete',projectRef:candidate.projectRef,
  planSha256:sha(JSON.stringify(plan)),operations,
  limitations:['SQL, configuration and runtime adapters are locally tested; integrated production execution and acceptance gates remain unfinished.',
    'Exact artifact pins do not prove current hosted state, approval, signed-in access or provider completeness.',
    'The current protected frontend preview and its production backend binding are verified; signed-in acceptance remains unverified.',
    'Do not restore old runtimes over new checkpoints without reviewed compatibility or forward repair.'],
},null,2)+'\n');
console.log(JSON.stringify({state:'prepared_not_executed',steps:plan.steps.length,database:20,runtime:37}));
