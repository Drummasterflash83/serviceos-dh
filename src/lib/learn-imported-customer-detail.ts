import type { ImportedScope } from './learn-imported-customers';
export type SourceDetailKind='jobs'|'sites'|'contacts'|'transactions'|'subaccounts';
export type SourceDetailScope=Pick<ImportedScope,'tenant'|'actor'|'environment'|'operatorReason'>&{source:string;sourceVersion:string;kind:SourceDetailKind;after:string|null};
export type SourceDetailRow={version_id:string;external_id:string;entity:string;title:string;status:string|null;email:string|null;phone:string|null;address:string|null;role:string|null;parent_reference:string|null;transaction_date:string|null;due_date:string|null;amount:string|null;balance:string|null;currency:string|null;observed_at:string};
export type SourceDetailPage={rows:SourceDetailRow[];total:number;held:number;next_after:string|null;observed_at:string};
const uuid=(x:unknown)=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
const time=(x:unknown)=>typeof x==='string'&&Number.isFinite(Date.parse(x));
const n=(x:unknown)=>Number.isSafeInteger(x)&&Number(x)>=0;
const text=(x:unknown,max:number)=>typeof x==='string'&&x.length>0&&x.length<=max;
const optional=(x:unknown,max:number)=>x===null||text(x,max);
const money=(x:unknown)=>x===null||(typeof x==='string'&&x.length<=100&&/^-?\d+(\.\d+)?$/.test(x));
const object=(x:unknown):x is Record<string,any>=>!!x&&typeof x==='object'&&!Array.isArray(x);
export function readImportedCustomerDetail(p:unknown,s:SourceDetailScope,now=Date.now()):SourceDetailPage {
 function fail():never{throw Error('Captured source details could not be verified. Refresh to check current access.');}
 if(!object(p)||!uuid(s.tenant)||!uuid(s.actor)||!uuid(s.sourceVersion)||(s.after!==null&&!uuid(s.after))||!['production','sandbox'].includes(s.environment)||!['jobs','sites','contacts','transactions','subaccounts'].includes(s.kind)||p.version!=='imported-customer-detail/1'||p.coverage!=='native_source_relationships'||p.tenant_id!==s.tenant||p.actor_id!==s.actor||p.environment!==s.environment||p.source_key!==s.source||p.source_version!==s.sourceVersion||p.kind!==s.kind||p.after!==s.after||p.operator_mode!==(s.operatorReason!==undefined)||!uuid(p.audit_id)||!time(p.observed_at)||Math.abs(Date.parse(p.observed_at)-now)>60000||!Array.isArray(p.rows)||p.rows.length>25||!n(p.total)||p.total<p.rows.length||!n(p.held)||(p.next_after!==null&&!uuid(p.next_after)))fail();
 let prior=s.after;const seen=new Set<string>(),entities={jobs:['Job'],sites:['Site'],contacts:['Contact'],transactions:['Invoice','Payment','CreditMemo','SalesReceipt','Estimate'],subaccounts:['Subaccount']};
 for(const r of p.rows){if(!object(r)||!uuid(r.version_id)||(prior!==null&&r.version_id<=prior)||seen.has(r.version_id)||!text(r.external_id,128)||!entities[s.kind].includes(r.entity)||!text(r.title,2200)||!optional(r.status,400)||!optional(r.email,1000)||!optional(r.phone,400)||!optional(r.address,3400)||!optional(r.role,600)||!optional(r.parent_reference,128)||!optional(r.transaction_date,64)||!optional(r.due_date,64)||!money(r.amount)||!money(r.balance)||!(r.currency===null||(typeof r.currency==='string'&&/^[A-Z]{3}$/.test(r.currency)))||!time(r.observed_at))fail();seen.add(r.version_id);prior=r.version_id;}
 if(p.next_after!==null&&(p.rows.length!==25||p.next_after!==p.rows[p.rows.length-1].version_id))fail();
 return{rows:p.rows,total:p.total,held:p.held,next_after:p.next_after,observed_at:p.observed_at};
}
