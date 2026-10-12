/** Offline preparation of the exact tested artifacts in Supabase CLI wire format.
 * This script contains no HTTP client or deployment action. */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';

const [bundled, booted, destination] = process.argv.slice(2);
const privateRoot = resolve('.verification-results') + '/';
if (process.argv.length !== 5 || [bundled,booted,destination].some(p => !p || !resolve(p).startsWith(privateRoot)))
  throw Error('Provide private bundle report, boot report and fresh output directory');
const sha = b => createHash('sha256').update(b).digest('hex');
const manifestBytes=readFileSync('supabase/release/learn-production/runtime-candidate.manifest.json');
const candidate=JSON.parse(manifestBytes), bundle=JSON.parse(readFileSync(join(bundled,'report.json'))), boot=JSON.parse(readFileSync(booted));
if (bundle.state !== 'all_candidate_endpoints_bundled' || !bundle.withinConservativeLocalBundleLimit ||
    bundle.manifestSha256 !== sha(manifestBytes) || bundle.sourceClosureSha256 !== candidate.sourceClosureSha256 ||
    boot.state !== 'all_endpoints_booted_and_rejected_missing_auth' ||
    boot.manifestSha256 !== sha(manifestBytes) || boot.sourceClosureSha256 !== candidate.sourceClosureSha256 ||
    !boot.containerRemoved || boot.artifacts.length !== 37 || boot.checks.length !== 37 ||
    new Set(boot.artifacts.map(e=>e.name)).size !== 37 || new Set(boot.checks.map(e=>e.name)).size !== 37)
  throw Error('Passing exact candidate artifacts required');
mkdirSync(destination,{mode:0o700});
const report={version:'learn-production-runtime-transport/1',projectRef:candidate.projectRef,
  state:'prepared_not_uploaded',observedAt:new Date().toISOString(),candidateManifestSha256:sha(manifestBytes),
  sourceClosureSha256:candidate.sourceClosureSha256,endpoints:[],productionChanged:false,
  format:'EZBR magic followed by Brotli compressed tested ESZIP; application/vnd.denoland.eszip',
  reference:'https://github.com/supabase/cli/blob/develop/apps/cli-go/pkg/function/batch.go',
  limitations:['No upload, deployment, gateway or positive authenticated acceptance.',
    'Runtime publication is only one step in the separately approved matching database/configuration/frontend release.']};
for(const endpoint of candidate.endpoints){
  const artifact=bundle.endpoints.find(e=>e.name===endpoint.name);
  const bootArtifact=boot.artifacts.find(e=>e.name===endpoint.name), check=boot.checks.find(e=>e.name===endpoint.name);
  if(!artifact || artifact.verifyJwt!==endpoint.verifyJwt || bootArtifact?.eszipSha256!==artifact.eszipSha256 ||
      !check?.denied || ![401,403].includes(check.status))throw Error('Endpoint metadata or acceptance mismatch');
  const body=readFileSync(join(bundled,'artifacts',endpoint.name+'.eszip'));
  if(body.length!==artifact.bytes || sha(body)!==artifact.eszipSha256)throw Error('Tested artifact changed');
  const ezbr=Buffer.concat([Buffer.from('EZBR'),brotliCompressSync(body,{params:{[constants.BROTLI_PARAM_QUALITY]:4}})]);
  if(!brotliDecompressSync(ezbr.subarray(4)).equals(body))throw Error('Wire format round trip differs');
  const hash=sha(ezbr), entrypoint='file:///work/supabase/functions/'+endpoint.name+'/index.ts';
  const params=new URLSearchParams({verify_jwt:String(endpoint.verifyJwt),entrypoint_path:entrypoint,ezbr_sha256:hash});
  const existing=!!endpoint.beforeProduction;
  if(!existing){params.set('slug',endpoint.name);params.set('name',endpoint.name);}
  const request={method:existing?'PATCH':'POST',path:`/v1/projects/${candidate.projectRef}/functions${existing?'/'+endpoint.name:''}?${params}`,
    contentType:'application/vnd.denoland.eszip',bodyFile:endpoint.name+'.ezbr'};
  writeFileSync(join(destination,endpoint.name+'.ezbr'),ezbr,{mode:0o600,flag:'wx'});
  report.endpoints.push({name:endpoint.name,verifyJwt:endpoint.verifyJwt,eszipSha256:artifact.eszipSha256,
    ezbrSha256:hash,ezbrBytes:ezbr.length,compressionRoundTrip:true,request});
}
if(report.endpoints.length!==37)throw Error('Complete candidate required');
writeFileSync(join(destination,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
console.log(JSON.stringify({state:report.state,endpoints:report.endpoints.length,
  totalBytes:report.endpoints.reduce((n,e)=>n+e.ezbrBytes,0)}));
