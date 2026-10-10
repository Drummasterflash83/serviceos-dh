/** Recover the existing private estimate and its gate, without the wider care system. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const INVESTMENT_SOURCES=[
 'supabase/migrations/20261023130000_receptionist_review_desk.sql',
 'supabase/migrations/20261023190000_serviceos_build_investment.sql',
];
export function investmentSource(){
 const sources=INVESTMENT_SOURCES.map(path=>({path,source:readFileSync(path,'utf8')}));
 const first=sources[0].source,start=first.indexOf('create function public.care_desk_operator()'),end=first.indexOf('create or replace function public.care_require_admin()');
 if(start<0||end<=start||first.indexOf('create function public.care_desk_operator()',start+1)!==-1)throw Error('Private gate source changed');
 return {sql:first.slice(start,end)+'\n'+sources[1].source.replace('\nbegin;\n','\n').replace('\ncommit;\n','\n'),sources:sources.map(({path,source})=>({path,sha256:createHash('sha256').update(source).digest('hex')}))};
}
