// Local-only transactional proof. All fixtures and schema additions roll back.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const strip = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
    .replace(/^begin;\s*$/gim, "")
    .replace(/^commit;\s*$/gim, "");
const sql = `
begin;
${strip("supabase/migrations/20261018120000_client_invoices.sql")}
${strip("supabase/migrations/20261021120000_operator_delivery_editors.sql")}
create temp table proof_ids as select gen_random_uuid() t,gen_random_uuid() other_t,gen_random_uuid() admin_id,gen_random_uuid() user_id,gen_random_uuid() invoice;
grant select on proof_ids to authenticated;
insert into public.tenants(id,slug,display_name) select t,'op-proof-'||t,'Synthetic operator proof' from proof_ids union all select other_t,'op-proof-'||other_t,'Other proof' from proof_ids;
insert into auth.users(id,email) select admin_id,'admin-'||admin_id||'@example.invalid' from proof_ids union all select user_id,'user-'||user_id||'@example.invalid' from proof_ids;
insert into public.profiles(id,tenant_id,role) select admin_id,t,'owner' from proof_ids union all select user_id,other_t,'viewer' from proof_ids on conflict(id) do update set tenant_id=excluded.tenant_id,role=excluded.role;
insert into public.platform_authority_grants(profile_id,permission,granted_by) select admin_id,'platform.controlplane.admin','local-proof' from proof_ids;
insert into public.client_programmes(tenant_id,content) select t,'{}'::jsonb from proof_ids union all select other_t,'{}'::jsonb from proof_ids;
insert into public.client_invoices(id,tenant_id,reference,issued_on,amount_pence,status,description,outcome_note,payment_basis,storage_path,sha256) select invoice,t,'PROOF-1',current_date,10000,'paid','Unchanged invoice','Original note','Synthetic',t||'/proof.pdf',repeat('a',64) from proof_ids;
create function pg_temp.check_that(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label;end$$;
create function pg_temp.refuses(command text,label text,expected text default null) returns void language plpgsql as $$declare blocked boolean:=false;begin begin execute command; exception when others then if expected is not null and sqlstate<>expected then raise; end if; blocked:=true;end;perform pg_temp.check_that(blocked,label);end$$;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select user_id::text from proof_ids),true);
select pg_temp.refuses(format('select public.operator_update_invoice_notes(%L,%L,1,%L,%L)',t,invoice,'Forged','bad'),'ordinary client invoice write refused','42501') from proof_ids;
select pg_temp.refuses(format('select public.operator_update_delivery(%L,0,%L::jsonb,%L)',t,'{"summary":"bad","areas":[],"readinessNote":"","next":"bad"}','bad'),'ordinary client delivery write refused','42501') from proof_ids;
select pg_temp.check_that((select count(*) from public.client_invoices)=0,'other-tenant invoices hidden by RLS');
select set_config('request.jwt.claim.sub',(select admin_id::text from proof_ids),true);
select pg_temp.check_that(public.operator_update_invoice_notes(t,invoice,1,'Revised delivery note','Proof update')=2,'administrator publishes invoice note') from proof_ids;
select pg_temp.refuses(format('select public.operator_update_invoice_notes(%L,%L,1,%L,%L)',t,invoice,'Stale','bad'),'stale invoice edit refused','40001') from proof_ids;
select pg_temp.refuses(format('select public.operator_update_invoice_notes(%L,%L,2,%L,%L)',other_t,invoice,'Cross-tenant mismatch','bad'),'mismatched invoice tenant refused') from proof_ids;
select pg_temp.refuses(format('select public.operator_update_invoice_notes(%L,%L,2,%L,%L)',t,invoice,'Note',''),'missing audit reason refused') from proof_ids;
select pg_temp.refuses(format('update public.client_invoices set amount_pence=1 where id=%L',invoice),'direct money edit refused','42501') from proof_ids;
select pg_temp.check_that(public.operator_update_delivery(t,0,'{"summary":"Ready to review","areas":[{"title":"Emma","status":"Review","detail":"Synthetic proof"}],"readinessNote":"Not a phone-line test","next":"Review together"}','Proof publication')=1,'administrator publishes first delivery update') from proof_ids;
select pg_temp.refuses(format('select public.operator_update_delivery(%L,0,%L::jsonb,%L)',t,'{"summary":"bad","areas":[],"readinessNote":"","next":"bad"}','bad'),'stale delivery edit refused','40001') from proof_ids;
select pg_temp.refuses(format('select public.operator_update_delivery(%L,1,%L::jsonb,%L)',t,'{"summary":"bad","areas":[{}],"readinessNote":"","next":"bad"}','bad'),'invalid delivery fields refused') from proof_ids;
select pg_temp.refuses(format('select public.operator_update_delivery(%L,1,%L::jsonb,%L)',t,'{"summary":"bad","areas":[],"readinessNote":"","next":"bad","unexpected":true}','bad'),'unexpected delivery fields refused') from proof_ids;
reset role;
select pg_temp.check_that((select count(*) from public.controlplane_change_log c,proof_ids p where c.tenant_id=p.t and c.action in ('client.invoice.notes_updated','client.delivery.updated') and c.actor=p.admin_id::text)=2,'both writes audited with real actor');
select pg_temp.check_that((select amount_pence=10000 and status='paid' and sha256=repeat('a',64) and reference='PROOF-1' and version=2 from public.client_invoices i,proof_ids p where i.id=p.invoice),'financial facts unchanged');
insert into public.client_portal_access(tenant_id,profile_id) select t,user_id from proof_ids;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select user_id::text from proof_ids),true);
select pg_temp.check_that((select outcome_note='Revised delivery note' from public.client_invoices),'client sees published note');
select pg_temp.check_that((select content->>'summary'='Ready to review' from public.client_delivery_updates),'client sees published delivery');
reset role;
insert into public.view_as_context(tenant_id,actor_user_id,subject_kind,reason) select t,admin_id,'role','proof' from proof_ids;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select admin_id::text from proof_ids),true);
select pg_temp.refuses(format('select public.operator_update_invoice_notes(%L,%L,2,%L,%L)',t,invoice,'Preview mutation','bad'),'view-as invoice mutation refused','42501') from proof_ids;
select pg_temp.refuses(format('select public.operator_update_delivery(%L,1,%L::jsonb,%L)',t,'{"summary":"bad","areas":[],"readinessNote":"","next":"bad"}','bad'),'view-as delivery mutation refused','42501') from proof_ids;
reset role;
rollback;
`;
execFileSync(
  "docker",
  [
    "exec",
    "-i",
    "supabase_db_serviceos-dh",
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1",
  ],
  { input: sql, stdio: ["pipe", "pipe", "inherit"] },
);
console.log("Operator delivery proof passed; all fixtures/schema rolled back.");
