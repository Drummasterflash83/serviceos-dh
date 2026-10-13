/** Read back the three installed QuickBooks TEST runtimes; no provider access. */
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import ts from 'typescript';
import {savedCliToken} from './learn-test-readiness.mjs';
import {edgeRuntimeBundle} from './learn-email-runtime-edge-bundle.mjs';
function structure(source) {
  const js = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      removeComments: true,
    },
  }).outputText;
  const tree = ts.createSourceFile(
    "runtime.js",
    js,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.JS,
  );
  function walk(n) {
    if (ts.isParenthesizedExpression(n)) return walk(n.expression);
    if (ts.isBlock(n) && n.statements.length === 1 && ts.isForOfStatement(n.statements[0]))
      return walk(n.statements[0]);
    if (
      ts.isBinaryExpression(n) &&
      [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(
        n.operatorToken.kind,
      )
    ) {
      const terms = [];
      function collect(x) {
        if (ts.isParenthesizedExpression(x)) return collect(x.expression);
        if (ts.isBinaryExpression(x) && x.operatorToken.kind === n.operatorToken.kind) {
          collect(x.left);
          collect(x.right);
        } else terms.push(walk(x));
      }
      collect(n);
      return ["logical", n.operatorToken.kind, terms];
    }
    const kids = [];
    ts.forEachChild(n, (c) => {
      kids.push(walk(c));
    });
    return [
      n.kind,
      ts.isSourceFile(n) ? null : (n.text ?? n.escapedText ?? null),
      n.operator ?? null,
      ts.isVariableDeclarationList(n) ? n.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let) : null,
      kids,
    ];
  }
  return JSON.stringify(walk(tree));
}

const project='saatxzwxvdvqevbnskxy',names=['quickbooks-oauth-start','quickbooks-oauth-callback','learn-quickbooks-worker'];
const token=savedCliToken(),root='.verification-results/quickbooks-runtime-readback-'+Date.now();mkdirSync(root,{recursive:true,mode:0o700});
async function inventory(){const r=await fetch(`https://api.supabase.com/v1/projects/${project}/functions`,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('TEST runtime inventory unavailable');return r.json();}
const before=await inventory(),reports=[];
for(const name of names){
 const live=before.find(x=>x.slug===name);if(live?.version!==1||live.status!=='ACTIVE'||live.verify_jwt!==false)throw Error('Unexpected QuickBooks TEST runtime version');
 const download=spawnSync('/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase',['functions','download',name,'--project-ref',project,'--workdir',root],{env:{...process.env,SUPABASE_ACCESS_TOKEN:token},encoding:'utf8',timeout:60000,maxBuffer:2097152});
 if(download.status!==0)throw Error('TEST function readback unconfirmed');
 const bundle=edgeRuntimeBundle([{name,verifyJwt:false}]),folder=root+'/supabase/functions/'+name+'/',missing=[],changed=[],matched=[];
 for(const f of bundle.files){
  const path=folder+(f.path===name+'/index.ts'?'index.ts':'functions/'+f.path);
  if(!existsSync(path)){missing.push(f.path);continue;}
  if(structure(f.source)!==structure(readFileSync(path,'utf8')))changed.push(f.path);else matched.push(f.path);
 }
 const liveImports=[];
 for(const f of bundle.files){
  const emitted=ts.transpileModule(f.source,{compilerOptions:{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext}}).outputText;
  const tree=ts.createSourceFile(f.path,emitted,ts.ScriptTarget.ESNext,true,ts.ScriptKind.JS);
  function visit(n){
   let spec;if((ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier)spec=n.moduleSpecifier.text;
   if(ts.isCallExpression(n)&&n.expression.kind===ts.SyntaxKind.ImportKeyword)spec=n.arguments[0]?.text;
   if(typeof spec==='string'&&spec.startsWith('.')&&missing.some(m=>resolve(m)===resolve(dirname(f.path),spec)))liveImports.push(f.path);
   ts.forEachChild(n,visit);
  }visit(tree);
 }
 if(changed.length||liveImports.length)throw Error('TEST runtime closure differs: '+name+' '+changed.join(','));
 reports.push({name,version:live.version,artifactHash:live.ezbr_sha256,matchingRuntimeModules:matched.length,omittedTypeOnlyModules:missing,sourceClosureSha256:bundle.sha256});
}
const after=await inventory();
for(const r of reports){const current=after.find(f=>f.slug===r.name);if(current?.version!==r.version||current.ezbr_sha256!==r.artifactHash)throw Error('TEST runtime changed during readback');}
const report={state:'downloaded_runtime_closures_verified',project,checkedAt:new Date().toISOString(),reports,providerRequests:0,limitations:['Source closure readback and public guards only; no company OAuth, accounting requests or hosted token rotation.']};
writeFileSync(root+'/report.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({...report,path:root+'/report.json'}));
