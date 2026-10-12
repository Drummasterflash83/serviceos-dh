/** Planning only: classify a production archive and current TEST public schema.
 * Never derives destructive SQL or treats TEST as the entire desired database.
 */
import {readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const digest=x=>createHash('sha256').update(x).digest('hex');
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)
 ?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
function keyed(rows,key){
 if(!Array.isArray(rows))throw Error('Missing schema inventory');
 const map=new Map();
 for(const row of rows){
  if(typeof row?.name!=='string'||!row.name||map.has(key(row)))throw Error('Invalid or duplicate schema identity');
  map.set(key(row),row);
 }
 return map;
}
function compareObjects(production,test,key){
 const a=keyed(production,key),b=keyed(test,key);
 const additions=[],preserveProductionOnly=[],changed=[],unchanged=[];
 for(const id of [...new Set([...a.keys(),...b.keys()])].sort()){
  if(!a.has(id)){additions.push(id);continue;}
  if(!b.has(id)){preserveProductionOnly.push(id);continue;}
  const old=a.get(id),next=b.get(id);
  if(canonical(old)===canonical(next)){unchanged.push(id);continue;}
  const entry={identity:id,changedFacets:[...new Set([...Object.keys(old),...Object.keys(next)])]
   .filter(k=>canonical(old[k])!==canonical(next[k])).sort()};
  if(entry.changedFacets.includes('columns')){
   const columns=compareObjects(old.columns,next.columns,v=>v.name);
   entry.columns={additions:columns.additions,preserveProductionOnly:columns.preserveProductionOnly,
    changed:columns.changed};
  }
  for(const facet of ['constraints','indexes','triggers','policies']){
   if(entry.changedFacets.includes(facet)){
    const delta=compareObjects(old[facet],next[facet],v=>v.name);
    entry[facet]={additions:delta.additions,preserveProductionOnly:delta.preserveProductionOnly,changed:delta.changed};
   }
  }
  changed.push(entry);
 }
 return {additions,preserveProductionOnly,changed,unchanged};
}
export function reconcileSchema(production,test){
 return {
  tables:compareObjects(production.tables,test.tables,v=>v.name),
  functions:compareObjects(production.functions,test.functions,v=>{
   if(typeof v.arguments!=='string')throw Error('Function signature missing');
   return `${v.name}(${v.arguments})`;
  }),
  views:compareObjects(production.views,test.views,v=>v.name),
 };
}

export function inspectPackagePins(directory){
 return readdirSync(directory).filter(f=>/^\d{3}_.+\.sql$/.test(f)).sort().map(file=>{
  const sha256=digest(readFileSync(`${directory}/${file}`));
  const manifestPath=`${directory}/${file.replace(/\.sql$/,'.manifest.json')}`;
  const manifest=existsSync(manifestPath)?JSON.parse(readFileSync(manifestPath,'utf8')):null;
  return {file,sha256,manifestPin:manifest?manifest.sha256===sha256?'matched':'mismatch':'absent',
   productionExecutionAllowed:false};
 });
}

function run(){
 if(process.argv.slice(2).join(' ')!=='--compare-existing-baselines')throw Error('Explicit offline comparison required');
 const prod='.verification-results/production-release-baseline-v1',test='.verification-results/test-release-baseline-v1';
 const read=(p)=>JSON.parse(readFileSync(p,'utf8'));
 const pr=read(prod+'/report.json'),tr=read(test+'/report.json');
 if(pr.state!=='offline_release_baseline_recorded'||!pr.containerRemoved||tr.state!=='test_release_metadata_recorded'
   ||tr.projectRef!=='saatxzwxvdvqevbnskxy'||pr.inventorySqlSha256!==tr.inventorySqlSha256)
  throw Error('Complete compatible baseline receipts required');
 const production=read(prod+'/schema.json'),candidate=read(test+'/schema.json');
 const delta=reconcileSchema(production,candidate);
 const packages=inspectPackagePins('supabase/release/learn-test');
 const ledger=read(test+'/migration-ledger.json');
 const receiptHashes=new Set(ledger.map(r=>r.source_sha256));
 for(const p of packages)p.hostedReceiptMatched=receiptHashes.has(p.sha256);
 const report={version:'learn-production-release-reconciliation/1',observedAt:new Date().toISOString(),
  state:'planning_baseline_only',productionSnapshotAt:'2026-10-12T00:25:21.393518Z',
  productionArchive:pr.archive,testObservedAt:tr.observedAt,inventorySqlSha256:pr.inventorySqlSha256,
  sourceArtifacts:{productionSchemaSha256:digest(readFileSync(prod+'/schema.json')),
   testSchemaSha256:digest(readFileSync(test+'/schema.json'))},
  baselineCounts:{production:pr.objectCounts,test:tr.objectCounts},
  summary:Object.fromEntries(Object.entries(delta).map(([k,v])=>[k,Object.fromEntries(Object.entries(v).map(([n,a])=>[n,a.length]))])),
  differences:delta,packages,
  guards:{productionChanged:false,hostedTestChanged:false,providerRequests:0,sourceRowsPublished:0,
   offlineContainerRemoved:true,productionMigrationPrepared:false,productionMigrationRehearsed:false,promotionReady:false},
  requiredReview:[
   'Preserve every production-only object and column; TEST is a partial schema, not a replacement target.',
   'Review shared-table policy, ACL, trigger, constraint and index changes against existing production clients and writers.',
   'Resolve migration ownership/dependency conflicts in a production-specific additive package; never execute TEST bundles on production.',
   'Rehearse the exact package with source fingerprints, roles, trigger behavior and application journeys before promotion approval.',
   'Refresh the production baseline before execution: this report describes the retained archive, not current live state.'
  ],
  limitations:['Public-schema structure only; this is not a complete cross-schema dependency graph.',
   'The production archive omits pg_net response/queue rows; full service/Vault recovery remains unproven.',
   'Function identities include argument names; signature reconciliation needs review before replacement.',
   'Matching a TEST package hash or receipt proves provenance, not production suitability or successful real-provider acceptance.']};
 const output='docs/operations/evidence/learn-production-release-reconciliation-2026-10-12.json';
 writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({state:report.state,summary:report.summary,packageCount:packages.length,
  mismatchedPins:packages.filter(p=>p.manifestPin==='mismatch').map(p=>p.file),
  receiptMissing:packages.filter(p=>!p.hostedReceiptMatched).map(p=>p.file),output}));
 if(packages.some(p=>p.manifestPin==='mismatch'))process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)run();
