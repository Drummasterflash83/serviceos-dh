/** Compile only the two reviewed identity Edge functions. No deployment or data read. */
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {brotliCompressSync,constants} from 'node:zlib';
import {edgeRuntimeBundle} from './learn-email-runtime-edge-bundle.mjs';

const PROJECT='tgbnakbxwcqjeimygroz';
const IMAGE='public.ecr.aws/supabase/edge-runtime:v1.74.3';
const IMAGE_ID='sha256:c52405002a890ca9fcf77978671c57f3a988e03174afb277f84ac65bc917013c';
const DOCKER='/usr/local/bin/docker';
const ENDPOINTS=[
  {name:'platform-worker',verifyJwt:false,
    sourceSha256:'73d6a909d17d454f011d546d46ccf49a8b5e5a2f2d864e08e3d236fbf6486275'},
  {name:'identity-scheduled-sync',verifyJwt:false,
    sourceSha256:'611907ad225f6c25f302a35265ea6763656d3769f9384c68608e81e2627cca75'},
];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const out=resolve(process.argv[4]??'');
const privateRoot=resolve('.verification-results');
if(process.argv.length!==5||process.argv[2]!=='--prepare-only'||process.argv[3]!=='--out'||
  process.env.NEW_DAWN_IDENTITY_PROJECT!==PROJECT||
  !out.startsWith(privateRoot+'/')||existsSync(out))throw Error('exact_private_prepare_scope_required');

const bundles=ENDPOINTS.map(endpoint=>{
  const bundle=edgeRuntimeBundle([endpoint]);
  if(bundle.sha256!==endpoint.sourceSha256)throw Error(`source_closure_changed_${endpoint.name}`);
  return {...endpoint,bundle};
});
const image=spawnSync(DOCKER,['image','inspect',IMAGE,'--format','{{.Id}}'],
  {encoding:'utf8',timeout:15000,maxBuffer:1024*1024});
if(image.status!==0||image.stdout.trim()!==IMAGE_ID)throw Error('pinned_edge_image_unavailable');

mkdirSync(privateRoot,{recursive:true,mode:0o700});
mkdirSync(out,{mode:0o700});
const stage=join(out,'stage'),artifacts=join(out,'artifacts'),cache=join(out,'cache');
for(const dir of [stage,artifacts,cache])mkdirSync(dir,{mode:0o700});
const files=new Map();
for(const {bundle} of bundles)for(const file of bundle.files){
  const existing=files.get(file.path);
  if(existing!==undefined&&existing!==file.source)throw Error('shared_dependency_conflict');
  files.set(file.path,file.source);
}
for(const [name,source] of files){
  const path=join(stage,'supabase/functions',name);
  mkdirSync(dirname(path),{recursive:true,mode:0o700});
  writeFileSync(path,source,{mode:0o600});
}
writeFileSync(join(stage,'deno.json'),JSON.stringify({nodeModulesDir:'auto'}),{mode:0o600});
writeFileSync(join(stage,'supabase/config.toml'),
  `project_id = "${PROJECT}"\n`+ENDPOINTS.map(e=>`[functions.${e.name}]\nverify_jwt = false\n`).join(''),{mode:0o600});
const report={version:'new-dawn-identity-runtime-candidate/1',state:'building',project:PROJECT,
  image:IMAGE,imageId:IMAGE_ID,productionChanged:false,providerRequests:0,
  endpoints:[],sourceFiles:[...files].map(([path,source])=>({path,sha256:sha(source)})),
  preparedAt:new Date().toISOString()};
const save=()=>writeFileSync(join(out,'manifest.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
save();
for(const {name,verifyJwt,sourceSha256,bundle} of bundles){
  const built=spawnSync(DOCKER,['run','--rm','--pull=never','--network','bridge',
    '--memory','768m','--cpus','2','--env','DENO_DIR=/cache',
    '--mount',`type=bind,source=${stage},target=/work`,
    '--mount',`type=bind,source=${artifacts},target=/artifacts`,
    '--mount',`type=bind,source=${cache},target=/cache`,
    '--workdir','/work',IMAGE,'bundle','--entrypoint',
    `/work/supabase/functions/${name}/index.ts`,
    '--output',`/artifacts/${name}.eszip`,'--checksum','sha256','--timeout','55'],
    {encoding:'utf8',timeout:65000,maxBuffer:4*1024*1024});
  writeFileSync(join(out,`${name}.compile.log`),
    (built.stdout??'')+(built.stderr??''),{mode:0o600});
  if(built.status!==0){report.state='compile_failed';save();throw Error(`compile_failed_${name}`)}
  if([...files].some(([path,source])=>readFileSync(join(stage,'supabase/functions',path),'utf8')!==source))
    throw Error('staged_source_changed');
  const bytes=readFileSync(join(artifacts,`${name}.eszip`));
  if(bytes.length<1000||bytes.length>30*1024*1024||bytes.subarray(0,5).toString()!=='ESZIP')
    throw Error(`candidate_bytes_invalid_${name}`);
  const ezbr=Buffer.concat([Buffer.from('EZBR'),brotliCompressSync(bytes,
    {params:{[constants.BROTLI_PARAM_QUALITY]:4}})]);
  writeFileSync(join(artifacts,`${name}.ezbr`),ezbr,{mode:0o600,flag:'wx'});
  report.endpoints.push({name,verifyJwt,sourceClosureSha256:sourceSha256,
    sourceFileCount:bundle.files.length,eszipBytes:bytes.length,eszipSha256:sha(bytes),
    ezbrBytes:ezbr.length,ezbrSha256:sha(ezbr)});
  save();
}
report.state='compiled_local_candidate';report.completedAt=new Date().toISOString();save();
console.log(JSON.stringify({state:report.state,project:PROJECT,
  endpoints:report.endpoints,productionChanged:false,providerRequests:0}));
