/** Exact staged-build promotion. Preview builds are rejected: CLI promotion of
 * a preview rebuilds it. No builds, retries, domain creation or access changes.
 * The release journal supplies durable intent and reconciliation after timeout.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const PROJECT = 'prj_XEuCp5gnEireW5WynUgkRp9QNiXa';
const TEAM = 'team_PGUQWiaAZZkMTCM9nSHahIpG';
const BACKEND = 'tgbnakbxwcqjeimygroz';
const digest = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const check = (v, m) => { if (!v) throw Error(m); };
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const sorted = rows => [...rows].sort((a,b) => a.name.localeCompare(b.name));
function validate(operation) {
  const o = structuredClone(operation), c = o?.contract;
  check(o?.id === 'promote-matching-frontend' && o.kind === 'frontend' &&
    o.pinSha256 === digest(c) && c.project === PROJECT && c.team === TEAM &&
    c.target === 'production' && /^dpl_[a-zA-Z0-9]+$/.test(c.id) &&
    /^dpl_[a-zA-Z0-9]+$/.test(c.previousProductionDeployment) && c.id !== c.previousProductionDeployment &&
    /^[a-f0-9]{40}$/.test(c.gitSha) && /^https:\/\/serviceos-[a-z0-9]+-allkin\.vercel\.app$/.test(c.url) &&
    Array.isArray(c.domains) && c.domains.length === 4 &&
    JSON.stringify(sorted(c.domains).map(d=>d.name)) === JSON.stringify([
      'app.openfolk.ai','openfolk.ai','serviceos-dh.vercel.app','www.openfolk.ai']) &&
    c.domains.every(d=>d.redirect === (d.name === 'openfolk.ai' ? 'www.openfolk.ai' : null)),
  'Exact staged production frontend contract required');
  return o;
}

export function createProductionFrontendAdapter({operation, request, allowWrite=false, assertApprovedRelease}) {
  const o = validate(operation), c = o.contract;
  check(typeof request === 'function', 'Scoped Vercel transport required');
  const stepCheck = s => check(s?.id === o.id && s.kind === o.kind && s.pinSha256 === o.pinSha256,
    'Frontend step differs');
  async function inspect() {
    // Read project again at the end so an observed alias transition cannot count
    // as a consistent snapshot. This is not a provider-side compare-and-swap;
    // the release gate must exclude other deployment writers during promotion.
    const p = await request('/v9/projects/'+PROJECT);
    const d = await request('/v13/deployments/'+c.id);
    const domains = await request('/v9/projects/'+PROJECT+'/domains');
    const aliases = [];
    for (const domain of sorted(c.domains)) {
      const a = await request('/v4/aliases/'+domain.name);
      aliases.push({name:a.alias,project:a.projectId,deployment:a.deploymentId,redirect:a.redirect ?? null});
    }
    const end = await request('/v9/projects/'+PROJECT);
    const projectState = v => ({id:v.id,team:v.accountId,name:v.name,
      target:v.targets?.production?.id,protection:v.ssoProtection?.deploymentType,
      rollingRelease:v.rollingRelease ?? null,lastAliasRequest:v.lastAliasRequest ?? null});
    const snapshot = {project:projectState(p),end:projectState(end),
      deployment:{id:d.id,project:d.projectId,team:d.ownerId,target:d.target,url:d.url,
        readyState:d.readyState,gitSha:d.gitSource?.sha,metaSha:d.meta?.githubCommitSha,
        repoId:d.gitSource?.repoId,type:d.gitSource?.type,aliasAssigned:d.aliasAssigned,
        aliasError:!!d.aliasError,autoAssignCustomDomains:d.autoAssignCustomDomains},
      domains:sorted((domains.domains ?? []).map(v=>({name:v.name,redirect:v.redirect ?? null,
        gitBranch:v.gitBranch ?? null,verified:v.verified}))),
      paginated:domains.pagination?.next != null,aliases};
    let state = 'drift';
    const valid = p.id === PROJECT && p.accountId === TEAM && p.name === 'serviceos-dh' &&
      p.ssoProtection?.deploymentType === 'all_except_custom_domains' && !p.rollingRelease &&
      d.id === c.id && d.projectId === PROJECT && d.ownerId === TEAM && d.target === 'production' &&
      'https://'+d.url === c.url && d.readyState === 'READY' && d.gitSource?.sha === c.gitSha &&
      d.meta?.githubCommitSha === c.gitSha && d.gitSource?.type === 'github' &&
      String(d.gitSource?.repoId) === '1285975013' && d.autoAssignCustomDomains === false &&
      !d.aliasError && !snapshot.paginated &&
      JSON.stringify(snapshot.domains) === JSON.stringify(sorted(c.domains).map(v=>({...v,gitBranch:null,verified:true}))) &&
      aliases.every((a,i)=>a.name === sorted(c.domains)[i].name && a.project === PROJECT &&
        a.redirect === sorted(c.domains)[i].redirect);
    if (valid) {
      const job = end.lastAliasRequest;
      const stable = digest(snapshot.project) === digest(snapshot.end);
      const allOld = aliases.every(a=>a.deployment === c.previousProductionDeployment);
      const allNew = aliases.every(a=>a.deployment === c.id);
      const pending = job && ['pending','in-progress'].includes(job.jobStatus);
      if (!stable || pending || (!allOld && !allNew && aliases.every(a=>
        [c.id,c.previousProductionDeployment].includes(a.deployment)))) state = 'inconclusive';
      else if (allOld && end.targets?.production?.id === c.previousProductionDeployment &&
        (!job || job.toDeploymentId !== c.id)) state = 'ready';
      else if (allNew && end.targets?.production?.id === c.id && d.aliasAssigned === true &&
        // Vercel can clear its transient alias job after completion. The stable
        // project target and all four exact alias bindings establish the result.
        (!job || (job.type === 'promote' && job.toDeploymentId === c.id && job.jobStatus === 'succeeded'))) state = 'applied';
    }
    return {state,evidenceSha256:digest(snapshot)};
  }
  return {
    async observe(step) { stepCheck(step); return inspect(); },
    async apply(step) {
      stepCheck(step);
      check(allowWrite && typeof assertApprovedRelease === 'function', 'Frontend adapter is read-only');
      const approval = await assertApprovedRelease(step);
      check(approval?.projectRef === BACKEND && approval.stepPinSha256 === o.pinSha256 &&
        hash(approval.approvalEvidenceSha256), 'Current scoped release authority required');
      check((await inspect()).state === 'ready', 'Frontend promotion precondition changed');
      await request(`/v10/projects/${PROJECT}/promote/${c.id}`, {method:'POST',body:{}});
    },
  };
}

/** Reuse Vercel CLI's existing login for reads only. Its internal retry behaviour
 * is unsuitable for journalled mutations. Never returns raw CLI errors.
 */
export function productionFrontendTransport({operation,cliPath,execute=execFileSync}) {
  const {contract:c} = validate(operation);
  check(typeof cliPath === 'string' && cliPath.startsWith('/') && cliPath.endsWith('/vercel/dist/vc.js'),
    'Installed official Vercel CLI path required');
  const reads = new Set(['/v9/projects/'+PROJECT,'/v13/deployments/'+c.id,
    '/v9/projects/'+PROJECT+'/domains',...c.domains.map(d=>'/v4/aliases/'+d.name)]);
  return async (path,{method='GET',body}={}) => {
    check(method === 'GET' && reads.has(path) && body === undefined,
    'Vercel request outside exact release scope');
    try {
      const output = execute(process.execPath,[cliPath,'api',path+'?teamId='+TEAM,'--scope','allkin','--raw'],{
        encoding:'utf8',stdio:['pipe','pipe','pipe'],
        timeout:45000,maxBuffer:4194304});
      return output.trim() ? JSON.parse(output) : {};
    } catch { throw Error('Vercel outcome unconfirmed; read back before any further action'); }
  };
}

/** Existing authorised token stays in memory. Fetch submits once, with redirects
 * forbidden. The journal must reconcile 201/202, timeouts and failed responses
 * using domain/target readback; HTTP success alone never proves promotion.
 */
export function productionFrontendHttpTransport(token,{operation,allowWrite=false,fetcher=fetch}={}) {
  const {contract:c} = validate(operation);
  check(typeof token === 'string' && token.length > 20, 'Existing Vercel login required');
  const reads = new Set(['/v9/projects/'+PROJECT,'/v13/deployments/'+c.id,
    '/v9/projects/'+PROJECT+'/domains',...c.domains.map(d=>'/v4/aliases/'+d.name)]);
  return async(path,{method='GET',body}={})=>{
    check(method === 'GET' ? reads.has(path) && body === undefined : allowWrite && method === 'POST' &&
      path === `/v10/projects/${PROJECT}/promote/${c.id}` && JSON.stringify(body) === '{}',
    'Vercel request outside exact release scope');
    try {
      const response=await fetcher('https://api.vercel.com'+path+'?teamId='+TEAM,{
        method,redirect:'error',signal:AbortSignal.timeout(45000),
        headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
        ...(method === 'POST' ? {body:'{}'} : {}),
      });
      check(method === 'POST' ? [201,202].includes(response.status) : response.status === 200,
        'Vercel response unsuccessful');
      return method === 'POST' ? {} : await response.json();
    } catch { throw Error('Vercel outcome unconfirmed; read back before any further action'); }
  };
}

export function loadFrontendOperation() {
  const base = 'supabase/release/learn-production/';
  const plan = JSON.parse(readFileSync(base+'release-sequence.plan.json'));
  const operations = JSON.parse(readFileSync(base+'release-operations.manifest.json'));
  check(operations.projectRef === BACKEND && operations.planSha256 === digest(plan) &&
    JSON.stringify(plan.steps) === JSON.stringify(operations.operations.map(({id,kind,pinSha256})=>({id,kind,pinSha256}))),
  'Release plan binding differs');
  return validate(operations.operations.find(o=>o.kind === 'frontend'));
}
