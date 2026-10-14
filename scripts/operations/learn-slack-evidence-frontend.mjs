/** Isolated Git frontend release. Existing aliases/protections only; one attempt
 * per mutation, durable intent and readback. Never rebuilds via promotion. */
import{readFileSync,writeFileSync,existsSync}from'node:fs';
import{homedir}from'node:os';
const [mode,environment,revision='01']=process.argv.slice(2);
if(!['plan','create','inspect','promote'].includes(mode)||!['test','live'].includes(environment)||!['01','02'].includes(revision))throw Error('Exact mode, environment and frontend revision required');
const root='.verification-results/learn-slack-evidence-frontends-20261014-'+revision;
const candidate=JSON.parse(readFileSync(root+'/candidates.json')).find(c=>c.environment===environment);
if(!candidate||!new RegExp('^codex/learn-slack-evidence-'+environment+'-20261014$').test(candidate.branch)||!/^[a-f0-9]{40}$/.test(candidate.sha))throw Error('Isolated candidate required');
const live=environment==='live',project=live?'prj_XEuCp5gnEireW5WynUgkRp9QNiXa':'prj_KOScR3ShQmvxjrwLAJ68yTh93Pcs',team='team_PGUQWiaAZZkMTCM9nSHahIpG';
const names=live?['app.openfolk.ai','openfolk.ai','serviceos-dh.vercel.app','www.openfolk.ai']:['serviceos-learn-test-allkin.vercel.app','test.openfolk.ai'];
const token=JSON.parse(readFileSync(homedir()+'/Library/Application Support/com.vercel.cli/auth.json')).token;
const file=name=>root+'/'+environment+'-'+name+'.json';
const save=(name,data,exclusive=false)=>writeFileSync(file(name),JSON.stringify(data,null,2)+'\n',{mode:0o600,...(exclusive?{flag:'wx'}:{})});
const read=name=>JSON.parse(readFileSync(file(name)));
async function api(path,body){const r=await fetch('https://api.vercel.com'+path+'?teamId='+team,{method:body?'POST':'GET',redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error('Vercel '+r.status+'; inspect before any retry');return r.json();}
async function current(){const p=await api('/v9/projects/'+project),domains=await api('/v9/projects/'+project+'/domains');
 if(p.id!==project||p.accountId!==team||(live?p.link?.repoId!==1285975013:p.link!=null)||p.ssoProtection?.deploymentType!==(live?'all_except_custom_domains':'all')||p.rollingRelease||domains.pagination?.next)throw Error('Project/security scope differs');
 const aliases=[];for(const name of names){const a=await api('/v4/aliases/'+name);if(a.projectId!==project)throw Error('Alias project differs');aliases.push({name,deployment:a.deploymentId,redirect:a.redirect??null});}
 return{project,protection:p.ssoProtection,production:p.targets?.production?.id,domains:domains.domains.map(d=>({name:d.name,redirect:d.redirect??null,gitBranch:d.gitBranch??null,verified:d.verified})).sort((a,b)=>a.name.localeCompare(b.name)),aliases};
}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const before=await current();
if(mode==='plan'){
 const ids=new Set(before.aliases.map(a=>a.deployment));if(ids.size!==1)throw Error('Alias baseline differs');
 const d=await api('/v13/deployments/'+before.aliases[0].deployment);
 if(d.readyState!=='READY'||d.gitSource?.sha!==candidate.base)throw Error('Actual deployed Git baseline differs');
 save('plan',{candidate,before,at:new Date().toISOString()},true);console.log(JSON.stringify({environment,state:'prepared',sha:candidate.sha,aliases:names}));
}else{
 const plan=read('plan');if(!same(plan.candidate,candidate))throw Error('Candidate differs');
 if(mode==='create'){
  if(!same(before,plan.before))throw Error('Baseline changed');
  const request={name:live?'serviceos-dh':'serviceos-learn-test',project,...(live?{target:'production'}:{}),autoAssignCustomDomains:false,gitSource:{type:'github',repoId:'1285975013',ref:candidate.branch,sha:candidate.sha},projectSettings:{framework:'tanstack-start',buildCommand:'npm run build',installCommand:'npm install',nodeVersion:'24.x'}};
  save('create-intent',{request,at:new Date().toISOString()},true);
  const d=await api('/v13/deployments',request);save('deployment',{id:d.id??d.uid,url:d.url,sha:candidate.sha});
  if(!same(await current(),plan.before))throw Error('Creation changed aliases/project');
  console.log(JSON.stringify({environment,state:'submitted',id:d.id??d.uid,url:d.url}));
 }else{
  const saved=read('deployment'),d=await api('/v13/deployments/'+saved.id);
  if(d.projectId!==project||d.ownerId!==team||d.gitSource?.sha!==candidate.sha||d.meta?.githubCommitSha!==candidate.sha||d.gitSource?.type!=='github'||String(d.gitSource?.repoId)!=='1285975013'||(d.target??null)!==(live?'production':null)||d.autoAssignCustomDomains!==false||d.aliasError)throw Error('Deployment source/target differs');
  save('inspection',{id:d.id,url:d.url,sha:d.gitSource.sha,state:d.readyState,at:new Date().toISOString(),current:before});
  if(mode==='inspect'){console.log(JSON.stringify({environment,state:d.readyState,id:d.id,url:d.url,aliases:before.aliases}));}
  else{
   if(d.readyState!=='READY'||!same(before.protection,plan.before.protection)||before.production!==plan.before.production||!same(before.domains,plan.before.domains))throw Error('Release readiness/security drift');
   const proof=read('binding');if(proof.sha!==candidate.sha||proof.deployment!==d.id||proof.backend!==(live?'tgbnakbxwcqjeimygroz':'saatxzwxvdvqevbnskxy')||proof.rendered!==true)throw Error('Exact rendered backend proof required');
   const backend=JSON.parse(readFileSync('.verification-results/learn-slack-evidence-'+environment+'-20261014-01/verified.json'));if(backend.state!=='installed_source_reader_verified')throw Error('Verified backend required');
   for(const old of plan.before.aliases){const now=before.aliases.find(a=>a.name===old.name);if(now.redirect!==old.redirect||![old.deployment,d.id].includes(now.deployment))throw Error('Concurrent alias change');}
   for(const old of plan.before.aliases){
    const latest=await current();if(!same(latest.protection,plan.before.protection)||!same(latest.domains,plan.before.domains)||latest.production!==plan.before.production)throw Error('Project changed during release');
    const now=latest.aliases.find(a=>a.name===old.name);if(now.deployment===d.id)continue;if(now.deployment!==old.deployment||now.redirect!==old.redirect)throw Error('Alias changed');
    save('alias-intent-'+old.name,{deployment:d.id,previous:old,at:new Date().toISOString()},true);
    await api('/v2/deployments/'+d.id+'/aliases',{alias:old.name,...(old.redirect?{redirect:old.redirect}:{})});
    const a=await api('/v4/aliases/'+old.name);if(a.deploymentId!==d.id||a.projectId!==project||(a.redirect??null)!==old.redirect)throw Error('Alias outcome unconfirmed; inspect');
   }
   const after=await current();if(after.aliases.some(a=>a.deployment!==d.id)||!same(after.protection,plan.before.protection)||!same(after.domains,plan.before.domains))throw Error('Alias release incomplete');
   save('verified',{environment,id:d.id,sha:candidate.sha,url:d.url,after,state:'aliases_verified',at:new Date().toISOString(),rollback:plan.before.aliases});console.log(JSON.stringify({environment,state:'aliases_verified',id:d.id,sha:candidate.sha,aliases:names}));
  }
 }
}
