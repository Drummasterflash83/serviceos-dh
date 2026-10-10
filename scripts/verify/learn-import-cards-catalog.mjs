/** Existing customer-card projection metadata; no customer values or source reads. */
import {readGovernedImportCatalog} from './learn-governed-import-catalog.mjs';
import {communicationQuery} from './learn-card-communication-catalog.mjs';
import {RULES_FUNCTION_QUERY} from './learn-rules-catalog.mjs';
export const IMPORT_CARD_FUNCTIONS=['learn_import_customer_card','learn_import_customer_card_after_link','learn_import_customer_cards_reconcile'];
export const IMPORT_CARD_INDEXES=['learn_customer_card_person_uk','learn_customer_card_company_uk'];
export const IMPORT_CARD_TRIGGER='learn_import_customer_card_after_link';
export const IMPORT_CARD_FUNCTION_QUERY=RULES_FUNCTION_QUERY.replace(/p\.proname in \([^)]*\)/,`p.proname in (${IMPORT_CARD_FUNCTIONS.map(n=>`'${n}'`).join(',')})`).replace(' as functions',' as import_card_functions');
export const IMPORT_CARD_STATE_QUERY=`select jsonb_build_object(
 'triggers',(select coalesce(jsonb_agg(jsonb_build_object('name',t.tgname,'table',c.relname,'enabled',t.tgenabled) order by c.relname,t.tgname),'[]') from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and t.tgname='${IMPORT_CARD_TRIGGER}'),
 'indexes',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive,'unique',i.indisunique) order by c.relname),'[]') from pg_index i join pg_class c on c.oid=i.indexrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in (${IMPORT_CARD_INDEXES.map(n=>`'${n}'`).join(',')}))
) as import_card_state`;
export async function readImportCardsCatalog(args){
 const c=await readGovernedImportCatalog(args),f=await communicationQuery(args.token,IMPORT_CARD_FUNCTION_QUERY,args);
 const s=await communicationQuery(args.token,IMPORT_CARD_STATE_QUERY,args);
 if(f?.length!==1||!Array.isArray(f[0]?.import_card_functions)||s?.length!==1||!Array.isArray(s[0]?.import_card_state?.triggers)||!Array.isArray(s[0]?.import_card_state?.indexes))throw Error('Import card metadata incomplete');
 return {...c,importCardFunctions:f[0].import_card_functions,importCardState:s[0].import_card_state};
}
