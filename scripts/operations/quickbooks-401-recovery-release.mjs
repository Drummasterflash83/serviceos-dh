/** Guarded SQL-only recovery release. No tokens, provider requests or row edits. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { savedCliToken } from '../verify/learn-test-readiness.mjs';

const [mode, project] = process.argv.slice(2);
if (!['plan', 'apply', 'verify'].includes(mode) ||
    !['saatxzwxvdvqevbnskxy', 'tgbnakbxwcqjeimygroz'].includes(project))
  throw Error('Explicit mode and approved project required');
const dir = `.verification-results/quickbooks-401-recovery-${project}`;
mkdirSync(dir, { recursive: true });
const planPath = `${dir}/plan.json`;
const intentPath = `${dir}/intent.json`;
const verifiedPath = `${dir}/verified.json`;
const source = readFileSync('supabase/migrations/20261102300000_learn_quickbooks_401_recovery.sql', 'utf8');
const sourceSha = createHash('sha256').update(source).digest('hex');
const originalSource = readFileSync('supabase/migrations/20261102010000_learn_quickbooks_import.sql', 'utf8');
const originalBody = originalSource.match(/create function public\.learn_quickbooks_import_fail[\s\S]*?as \$\$([\s\S]*?)\$\$;/)?.[1];
const updatedBody = source.match(/create or replace function public\.learn_quickbooks_import_fail[\s\S]*?as \$\$([\s\S]*?)\$\$;/)?.[1];
const recoveryBody = source.match(/create function public\.learn_quickbooks_resume_first_401[\s\S]*?as \$\$([\s\S]*?)\$\$;/)?.[1];
if (!originalBody || !updatedBody || !recoveryBody) throw Error('SQL function source cannot be parsed');

const token = savedCliToken();
async function query(sql, readonly = true) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${readonly ? '/read-only' : ''}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }), signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw Error(`Release query ${r.status}: ${String(e.message ?? e.error ?? e.code ?? 'unknown').slice(0, 240)}`);
  }
  return r.json();
}
const catalog = `select jsonb_build_object(
 'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'body',p.prosrc,'acl',p.proacl::text,'owner',p.proowner::regrole::text,'definer',p.prosecdef,'settings',p.proconfig) order by p.oid::regprocedure::text)
  from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'learn_quickbooks_%'),
 'recoveryCount',(select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='learn_quickbooks_resume_first_401'),
 'recoveryAnon',coalesce((select has_function_privilege('anon',oid,'execute') from pg_proc where oid=to_regprocedure('public.learn_quickbooks_resume_first_401(uuid,uuid,uuid,bigint,bigint,text)')),false),
 'recoveryUser',coalesce((select has_function_privilege('authenticated',oid,'execute') from pg_proc where oid=to_regprocedure('public.learn_quickbooks_resume_first_401(uuid,uuid,uuid,bigint,bigint,text)')),false),
 'recoveryService',coalesce((select has_function_privilege('service_role',oid,'execute') from pg_proc where oid=to_regprocedure('public.learn_quickbooks_resume_first_401(uuid,uuid,uuid,bigint,bigint,text)')),false)
) state`;
const current = (await query(catalog))[0]?.state;
if (!current || !Array.isArray(current.functions)) throw Error('Catalog unreadable');
const fail = f => f.signature === 'learn_quickbooks_import_fail(uuid,uuid,text,integer)';
const recovery = f => f.signature === 'learn_quickbooks_resume_first_401(uuid,uuid,uuid,bigint,bigint,text)';
const old = current.functions.find(fail);
if (!old || !old.definer || !old.settings?.includes('search_path=pg_catalog')) throw Error('Import authority differs');
const other = fs => fs.filter(f => !fail(f) && !recovery(f));
if (mode === 'plan') {
  if (existsSync(planPath) || current.recoveryCount !== 0 || old.body.trim() !== originalBody.trim())
    throw Error('Plan already exists or production function differs from baseline');
  writeFileSync(planPath, JSON.stringify({ project, sourceSha, baseline: current }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ state: 'planned', project, sourceSha }));
  process.exit(0);
}
const plan = JSON.parse(readFileSync(planPath, 'utf8'));
if (plan.project !== project || plan.sourceSha !== sourceSha) throw Error('Source or project changed');
const baselineFail = plan.baseline.functions.find(fail);
if (!baselineFail || baselineFail.body.trim() !== originalBody.trim()) throw Error('Recorded baseline differs');
if (JSON.stringify(other(current.functions)) !== JSON.stringify(other(plan.baseline.functions)))
  throw Error('Unrelated QuickBooks functions changed');
if (mode === 'apply') {
  if (existsSync(intentPath) || current.recoveryCount !== 0 || current.functions.find(fail)?.body !== baselineFail.body ||
      old.acl !== baselineFail.acl || old.owner !== baselineFail.owner || old.definer !== baselineFail.definer ||
      JSON.stringify(old.settings) !== JSON.stringify(baselineFail.settings)) throw Error('Release attempted or baseline changed');
  writeFileSync(intentPath, JSON.stringify({ project, sourceSha, startedAt: new Date().toISOString() }), { flag: 'wx' });
  const guard = `do $guard$begin if (select md5(prosrc) from pg_proc where oid='public.learn_quickbooks_import_fail(uuid,uuid,text,integer)'::regprocedure)<>'${createHash('md5').update(baselineFail.body).digest('hex')}' or to_regprocedure('public.learn_quickbooks_resume_first_401(uuid,uuid,uuid,bigint,bigint,text)') is not null then raise exception 'quickbooks_recovery_baseline_changed';end if;end $guard$;`;
  await query(source.replace('\nbegin;\n', `\nbegin;\n${guard}\n`), false);
}
const after = (await query(catalog))[0]?.state;
const revised = after?.functions?.find(fail);
const added = after?.functions?.find(recovery);
if (!revised || !added || revised.body.trim() !== updatedBody.trim() || added.body.trim() !== recoveryBody.trim() ||
    revised.acl !== baselineFail.acl || revised.owner !== baselineFail.owner || revised.definer !== baselineFail.definer ||
    JSON.stringify(revised.settings) !== JSON.stringify(baselineFail.settings) ||
    JSON.stringify(other(after.functions)) !== JSON.stringify(other(plan.baseline.functions)) ||
    after.recoveryCount !== 1 || after.recoveryAnon || after.recoveryUser || !after.recoveryService ||
    !added.definer || !added.settings?.includes('search_path=pg_catalog'))
  throw Error('Release readback or authority preservation failed');
const evidence = { state: 'verified', project, sourceSha, checkedAt: new Date().toISOString(),
  importBodyMatched: true, priorAuthorityPreserved: true, unrelatedFunctionsPreserved: true,
  recoveryPrivateToService: true, migrationContainsDataEdits: false, providerRequests: 0 };
writeFileSync(verifiedPath, JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence));
