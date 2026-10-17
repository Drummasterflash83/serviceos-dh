/** Targeted Control Plane release from the exact installed source closure. */
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';
const mode=process.argv.slice(2).join(' ');
if(!['--deploy-test','--deploy-live','--plan-live'].includes(mode))throw Error('Exact target mode required');
const test=mode.endsWith('test'),project=test?TEST_PROJECT:'tgbnakbxwcqjeimygroz';
const endpoint='openfolk-control-plane';
const cli='/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase';
const baseline={version:test?27:37,index:'b23648f955a7de0674636a4857bddeda3381e2ca0d4800b3dce8c38b1f3e00b8',
 roster:'6fa80764228d3710be68670dc367c5fefdfecc22f55a7cb2a114a8338f705e2e'};
const hash=s=>createHash('sha256').update(s).digest('hex');
function replaceOnce(source,needle,replacement){
 if(source.split(needle).length!==2)throw Error('Installed operator source anchor changed');
 return source.replace(needle,replacement);
}
function patchIndex(source){
 if(hash(source)!==baseline.index||source.includes('roster.member_identity_confirm'))throw Error('Operator route baseline changed');
 const insert=`case "roster.member_identity_confirm":
        {
          if (!tenantId) return fail("bad_request", "tenant_id required", 400);
          if (typeof body.member_id !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.member_id) ||
              !Number.isSafeInteger(body.expected_version) || body.expected_version < 1)
            return fail("bad_request", "Choose a current linked member and refresh its version", 400);
          if (ctx.role === "machine") return fail("forbidden", "A signed-in operator must confirm identity", 403);
          const { data, error } = await rpc("cp_confirm_member_identity", {
            p_tenant: tenantId, p_member: body.member_id,
            p_expected_version: body.expected_version, p_actor_user: ctx.userId
          });
          if (error) {
            if (error.code === "P0409") return fail("version_conflict", "Member changed; refresh before confirming", 409);
            if (error.code === "22023" || error.code === "P0002")
              return fail("identity_unverified", "This member or linked login cannot be confirmed", 409);
            return fail("write_failed", "Member identity confirmation could not be recorded", 503);
          }
          return json({ ok: true, data });
        }
      `;
 return replaceOnce(source,'case "roster.member_lifecycle":',insert+'case "roster.member_lifecycle":');
}
function patchRoster(source){
 if(hash(source)!==baseline.roster||source.includes('login_email'))throw Error('Roster reader baseline changed');
 source=replaceOnce(source,'org_unit_id,profile_id,effective_from,effective_to',
   'org_unit_id,profile_id,confirmed_at,version,effective_from,effective_to');
 const old=`  return {
    members,
    responsibilities,
    authorityGrants
  };`;
 const now=`  const linkedIds = [...new Set(members.map((m)=>m.profile_id).filter((id)=>typeof id === "string"))];
  let loginById = new Map();
  if (linkedIds.length) {
    const { data: profiles, error } = await db.from("profiles").select("id,email")
      .eq("tenant_id", tenantId).in("id", linkedIds);
    if (error || !Array.isArray(profiles) || profiles.length !== linkedIds.length)
      throw new Error("Roster login references could not be verified");
    loginById = new Map(profiles.map((p)=>[p.id, p.email]));
  }
  return {
    members: members.map((m)=>({ ...m, login_email: m.profile_id ? loginById.get(m.profile_id) ?? null : null })),
    responsibilities,
    authorityGrants
  };`;
 return replaceOnce(source,old,now);
}
const token=savedCliToken();
async function inventory(){const r=await fetch(`https://api.supabase.com/v1/projects/${project}/functions`,{
 headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error('Edge inventory unavailable');const rows=await r.json();
 if(!Array.isArray(rows)||new Set(rows.map(x=>x.slug)).size!==rows.length)throw Error('Edge inventory changed');
 return rows;
}
const before=await inventory(),prior=before.find(r=>r.slug===endpoint);
if(prior?.version!==baseline.version||prior.status!=='ACTIVE'||prior.verify_jwt!==false)
 throw Error('Pinned operator route version changed');
const body=await fetch(`https://api.supabase.com/v1/projects/${project}/functions/${endpoint}/body`,{
 headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});
if(!body.ok)throw Error('Installed Edge executable unavailable');
const rollback=Buffer.from(await body.arrayBuffer());
if(!rollback.subarray(0,5).equals(Buffer.from('ESZIP')))throw Error('Installed executable invalid');
const root=mkdtempSync(join(tmpdir(),`learn-handoff-deploy-${test?'test':'live'}-`));
const download=join(root,'download'),stage=join(root,'stage');mkdirSync(download);
const fetched=spawnSync(cli,['functions','download',endpoint,'--project-ref',project,'--workdir',download],{
 env:{...process.env,SUPABASE_ACCESS_TOKEN:token},encoding:'utf8',timeout:90000,maxBuffer:2097152});
if(fetched.status!==0)throw Error('Exact installed source download failed');
const sourceRoot=join(download,'supabase/functions',endpoint);
function walk(dir){return readdirSync(dir).flatMap(name=>{const path=join(dir,name);return statSync(path).isDirectory()?walk(path):[path];});}
const files=walk(sourceRoot);if(files.length!==24)throw Error('Installed operator closure changed');
const manifest=[],changed=[];
for(const path of files){
 const rel=relative(sourceRoot,path).replaceAll('\\','/');
 if(!/\.(ts|js|json)$/.test(rel)||rel.includes('..'))throw Error('Unexpected source path');
 const normalized=rel==='index.ts'?`${endpoint}/index.ts`:
   rel.includes('functions/')?rel.slice(rel.lastIndexOf('functions/')+'functions/'.length):rel;
 if(!normalized.startsWith('_shared/')&&normalized!==`${endpoint}/index.ts`)throw Error('Unexpected source mapping');
 let source=readFileSync(path,'utf8');const originalSha256=hash(source);
 if(normalized===`${endpoint}/index.ts`)source=patchIndex(source);
 if(normalized==='_shared/controlplane/roster.ts')source=patchRoster(source);
 if(hash(source)!==originalSha256)changed.push(normalized);
 const target=join(stage,'supabase/functions',normalized);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,source,{mode:0o600});
 manifest.push({path:normalized,sha256:hash(source)});
}
if(new Set(manifest.map(v=>v.path)).size!==24)throw Error('Mapped closure contains duplicates');
if(JSON.stringify(changed.sort())!==JSON.stringify(['_shared/controlplane/roster.ts',`${endpoint}/index.ts`].sort()))
 throw Error('Targeted source change set differs');
const candidateSha256=hash(JSON.stringify(manifest.sort((a,b)=>a.path.localeCompare(b.path))));
const parsed=ts.createSourceFile('index.ts',readFileSync(join(stage,'supabase/functions',endpoint,'index.ts'),'utf8'),ts.ScriptTarget.Latest,true);
if(parsed.parseDiagnostics.length)throw Error('Candidate operator route syntax invalid');
writeFileSync(join(stage,'supabase/config.toml'),`project_id = "${project}"\n[functions.${endpoint}]\nverify_jwt = false\n`,{mode:0o600});
const resultPath=`.verification-results/build01-handoff-controlplane-${test?'test':'live'}.json`;
const rollbackPath=`.verification-results/build01-handoff-controlplane-${test?'test':'live'}-rollback.eszip`;
if(!test){const tested=JSON.parse(readFileSync('.verification-results/build01-handoff-controlplane-test.json','utf8'));
 const authz=manifest.find(v=>v.path==='_shared/controlplane/authz.ts');
 if(authz?.sha256!=='b0b93741a58cd2075df94ee093374a71840cff15dfc8c72eae3c5f79bfd3e672')
  throw Error('Pinned LIVE operator View-As guard changed');
 const testEquivalent=hash(JSON.stringify(manifest.map(v=>v.path==='_shared/controlplane/authz.ts'
  ?{...v,sha256:'7af5d250b989e9a01c7999954328440c2ec76b1fd8e52046eef6fbc687daa94f'}:v)));
 if(tested.state!=='deployed_needs_hosted_acceptance'||tested.candidateSha256!==testEquivalent)
  throw Error('Candidate differs from TEST beyond the pinned LIVE View-As guard');}
if(mode==='--plan-live'){
 console.log(JSON.stringify({state:'reviewed_no_deployment',project,beforeVersion:prior.version,
  candidateSha256,changedPaths:changed,authzBeforeSha256:'b0b93741a58cd2075df94ee093374a71840cff15dfc8c72eae3c5f79bfd3e672',
  authzCandidateSha256:manifest.find(v=>v.path==='_shared/controlplane/authz.ts')?.sha256,
  unchangedModules:manifest.length-changed.length,testEquivalent:true,productionWrites:false}));
 process.exit(0);
}
writeFileSync(resultPath,JSON.stringify({state:'prepared',project,beforeVersion:prior.version,
 beforeWireSha256:prior.ezbr_sha256,rollbackSha256:hash(rollback),candidateSha256,
 sourceFiles:manifest.length,changedPaths:[`${endpoint}/index.ts`,'_shared/controlplane/roster.ts']},null,2)+'\n',{flag:'wx',mode:0o600});
writeFileSync(rollbackPath,rollback,{flag:'wx',mode:0o600});
const deployed=spawnSync(cli,['functions','deploy',endpoint,'--project-ref',project,'--use-api','--workdir',stage],{
 env:{...process.env,SUPABASE_ACCESS_TOKEN:token},encoding:'utf8',timeout:120000,maxBuffer:2097152});
const after=await inventory(),current=after.find(r=>r.slug===endpoint);
const others=rows=>JSON.stringify(rows.filter(r=>r.slug!==endpoint).map(r=>[r.slug,r.version,r.ezbr_sha256]).sort((a,b)=>a[0].localeCompare(b[0])));
const okay=deployed.status===0&&current?.version===prior.version+1&&current?.status==='ACTIVE'&&
 current?.verify_jwt===false&&current?.ezbr_sha256!==prior.ezbr_sha256&&others(after)===others(before);
const result={state:okay?'deployed_needs_hosted_acceptance':'requires_inspection',project,
 beforeVersion:prior.version,afterVersion:current?.version??null,beforeWireSha256:prior.ezbr_sha256,
 afterWireSha256:current?.ezbr_sha256??null,candidateSha256,sourceFiles:manifest.length,
 otherEndpointsUnchanged:others(after)===others(before),cliStatus:deployed.status};
writeFileSync(resultPath,JSON.stringify(result,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(result));if(!okay)process.exitCode=1;
