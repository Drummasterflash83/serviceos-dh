/** Read-only prerequisite catalog for the approved OpenFolk job-review handoff. */
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
const mode = process.argv.slice(2).join(" ");
if (!['--test-read-only','--live-read-only'].includes(mode)) throw Error('Exact read-only mode required');
const project = mode === '--test-read-only' ? TEST_PROJECT : 'tgbnakbxwcqjeimygroz';
const query = `select
 to_regprocedure('public.learn_roster_write_guard(uuid,text,text,boolean)') is not null roster_guard,
 to_regprocedure('public.learn_commusoft_source_job_rows(uuid,uuid)') is not null source_job_reader,
 to_regprocedure('public.learn_business_input_review_access(uuid,uuid)') is not null source_review_access,
 to_regprocedure('public.learn_work_authority(uuid,uuid,uuid,uuid,boolean)') is not null work_authority,
 to_regprocedure('public.work_transition_apply(uuid,uuid,integer,text,jsonb,jsonb,jsonb)') is not null work_transition,
 to_regprocedure('public.cp_confirm_member_identity(uuid,uuid,integer,uuid,text,text,text,boolean)') is not null identity_confirm_installed,
 to_regprocedure('public.learn_commusoft_create_job_review_action(uuid,uuid,text,uuid,text)') is not null review_action_installed,
 to_regclass('public.controlplane_change_log') is not null change_log,
 to_regclass('public.intelligence_objects') is not null work_objects`;
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
  method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45000),
  headers: {Authorization:`Bearer ${savedCliToken()}`,'Content-Type':'application/json'},
  body: JSON.stringify({query}),
});
if (!response.ok) throw Error(`Schema readback HTTP ${response.status}`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length !== 1 ||
  Object.values(rows[0]).some(v => typeof v !== 'boolean')) throw Error('Schema readback shape changed');
console.log(JSON.stringify({observedAt:new Date().toISOString(),project,...rows[0],productionDataWrites:false}));
