export type ImportedSource = {
  key: string; provider: 'commusoft' | 'quickbooks'; scope: string; external_id: string;
  version_id: string; name: string; contact_name: string | null; email: string | null;
  phone: string | null; address: string | null; active: boolean | null;
  observed_at: string; source_updated_at: string | null;
  review_state: 'reviewed' | 'unreviewed' | 'review_changed' | 'source_conflict';
};
export type ImportedAccount = { key: string; card_id: string | null; name: string; sources: ImportedSource[]; total_sources: number };
export type ImportedScope = { tenant: string; actor: string; environment: 'production' | 'sandbox'; provider: 'all' | 'commusoft' | 'quickbooks'; query: string; after: string | null; group: string | null; operatorReason?: string };
export type ImportedPage = { rows: ImportedAccount[]; next_after: string | null; observed_at: string; counts: { commusoft_records: number; quickbooks_accounts: number; displayed_accounts: number; matched_accounts: number; unreviewed_records: number; records_needing_review: number; matching_results: number } };
const uuid=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(x);
const key=(x:unknown):x is string=>typeof x==='string'&&x.length<=240&&/^(card:[a-f0-9-]{36}|(commusoft|quickbooks):[A-Za-z0-9-]{1,64}:[A-Za-z0-9-]{1,128})$/.test(x);
const time=(x:unknown):x is string=>typeof x==='string'&&Number.isFinite(Date.parse(x));
const count=(x:unknown):x is number=>Number.isSafeInteger(x)&&Number(x)>=0;
const text=(x:unknown,n:number):x is string=>typeof x==='string'&&x.length>0&&x.length<=n;
const nullable=(x:unknown,n:number)=>x===null||text(x,n);
const object=(x:unknown):x is Record<string,any>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const bad=()=>Error('Captured customer records could not be verified. Refresh or ask OpenFolk to check access.');
export function readImportedCustomers(p:unknown,s:ImportedScope,now=Date.now()):ImportedPage {
 if(!uuid(s.tenant)||!uuid(s.actor)||!['production','sandbox'].includes(s.environment)||!['all','commusoft','quickbooks'].includes(s.provider)||s.query.length>200||s.query!==s.query.trim()||(s.after!==null&&!key(s.after))||(s.group!==null&&!key(s.group))||!object(p)
  ||p.version!=='imported-customer-catalog/1'||p.coverage!=='retained_source_accounts'||p.tenant_id!==s.tenant||p.actor_id!==s.actor||p.environment!==s.environment||p.provider!==s.provider||p.query!==s.query||p.after!==s.after||p.group!==s.group||p.operator_mode!==(s.operatorReason!==undefined)
  ||!uuid(p.audit_id)||!time(p.observed_at)||Math.abs(Date.parse(p.observed_at)-now)>60000||!Array.isArray(p.rows)||p.rows.length>25||(p.next_after!==null&&!key(p.next_after))||!object(p.counts))throw bad();
 const counts=['commusoft_records','quickbooks_accounts','displayed_accounts','matched_accounts','unreviewed_records','records_needing_review','matching_results'];
 if(Object.keys(p.counts).length!==counts.length||counts.some(k=>!count(p.counts[k]))||p.counts.matching_results<p.rows.length||p.counts.matched_accounts>p.counts.displayed_accounts)throw bad();
 let prior=s.after;const seen=new Set<string>();
 for(const r of p.rows){
  if(!object(r)||!key(r.key)||seen.has(r.key)||(prior!==null&&r.key<=prior)||!(r.card_id===null||uuid(r.card_id))||!text(r.name,2000)||!Array.isArray(r.sources)||r.sources.length<1||r.sources.length>5||!count(r.total_sources)||r.total_sources<r.sources.length)throw bad();
  if(s.group===null&&r.card_id!==null&&r.key!=='card:'+r.card_id)throw bad();
  const sourceKeys=new Set<string>();
  for(const a of r.sources){if(!object(a)||!['commusoft','quickbooks'].includes(a.provider)||!text(a.scope,64)||!text(a.external_id,128)||a.key!==`${a.provider}:${a.scope}:${a.external_id}`||!key(a.key)||sourceKeys.has(a.key)||!uuid(a.version_id)||!text(a.name,2000)||!nullable(a.contact_name,4500)||!nullable(a.email,2000)||!nullable(a.phone,2000)||!nullable(a.address,13000)||![true,false,null].includes(a.active)||!time(a.observed_at)||!(a.source_updated_at===null||time(a.source_updated_at))||!['reviewed','unreviewed','review_changed','source_conflict'].includes(a.review_state)||(s.provider!=='all'&&a.provider!==s.provider)||(r.card_id!==null&&a.review_state!=='reviewed'))throw bad();sourceKeys.add(a.key);}
  if(s.group!==null&&(r.sources.length!==1||r.key!==r.sources[0].key))throw bad();
  if(s.group===null&&r.card_id===null&&(r.sources.length!==1||r.key!==r.sources[0].key))throw bad();
  seen.add(r.key);prior=r.key;
 }
 if(p.next_after!==null&&(p.rows.length!==25||p.next_after!==p.rows[p.rows.length-1]?.key))throw bad();
 return {rows:p.rows as ImportedAccount[],counts:p.counts as ImportedPage['counts'],next_after:p.next_after as string|null,observed_at:p.observed_at};
}
