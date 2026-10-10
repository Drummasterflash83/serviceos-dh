/** Select existing delivery/audit definitions without installing billing or storage. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const hash=s=>createHash('sha256').update(s).digest('hex');
export const DELIVERY_SOURCES=[
 'supabase/migrations/20260821120000_openfolk_control_plane.sql',
 'supabase/migrations/20261018120000_client_invoices.sql',
 'supabase/migrations/20261021120000_operator_delivery_editors.sql',
 'supabase/migrations/20261101004000_delivery_audit_retention.sql',
];
function between(source,start,end){
 const at=source.indexOf(start),to=source.indexOf(end,at);
 if(at<0||to<=at||source.indexOf(start,at+1)!==-1)throw Error('Delivery source selection changed');
 return source.slice(at,to);
}
export function deliverySource(){
 const sources=DELIVERY_SOURCES.map(path=>({path,source:readFileSync(path,'utf8')}));
 const audit=between(sources[0].source,'create table if not exists controlplane_change_log (','-- ── Append-only enforcement')
  .replace('create table if not exists controlplane_change_log','create table public.controlplane_change_log').replaceAll('create index if not exists','create index');
 const table=between(sources[1].source,'create table public.client_delivery_updates (','insert into storage.buckets');
 const update=between(sources[2].source,'create function public.operator_update_delivery(','revoke all on function public.operator_update_invoice_notes');
 const retention=sources[3].source.replace('\nbegin;\n','\n').replace('\ncommit;\n','\n');
 return {sql:[audit,retention,table,'alter table public.client_delivery_updates add column version integer not null default 1;',update,
 'revoke all on function public.operator_update_delivery(uuid,integer,jsonb,text) from public,anon;\ngrant execute on function public.operator_update_delivery(uuid,integer,jsonb,text) to authenticated;'].join('\n'),sources:sources.map(s=>({path:s.path,sha256:hash(s.source)}))};
}
