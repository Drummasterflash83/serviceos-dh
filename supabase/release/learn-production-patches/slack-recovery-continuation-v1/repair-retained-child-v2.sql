-- Prepared-only exact repair for the already-succeeded, receipt-linked recovery.
-- Run only after the source patch is verified. No cursor/source/request mutation.
begin;
set local search_path=pg_catalog;
set local request.jwt.claim.role='service_role';set local request.jwt.claim.sub='';set local request.jwt.claims='{"role":"service_role"}';

set local lock_timeout='3s';set local statement_timeout='30s';
do $guard$begin
if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz' or current_setting('serviceos.release_sha256',true) is distinct from 'b40a4549a11381913bbe0f4e89a74c3b2c296f9cb69bd2efada031cd97b72dd1' then raise exception 'Exact continuation release target/source/role required';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_finish_job(uuid,uuid,text,integer,jsonb)'::regprocedure) is distinct from '1858a7e3b1714fbd4ccf35208ac9fd5d|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Reviewed continuation function/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_campaign_job_allowed(uuid,uuid)'::regprocedure) is distinct from '383ee9a76dee87a499e43f69df1480f4|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Reviewed continuation function/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_campaign_claim_allowed(uuid,uuid)'::regprocedure) is distinct from 'e06723e3b884bbf56e38efdb86e0c2ab|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Reviewed continuation function/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_campaign_recover_page(uuid,uuid,jsonb,text)'::regprocedure) is distinct from '29fc3bba92be4e9346dc49cc3ef9fe65|postgres|{postgres=X/postgres}' then raise exception 'Reviewed continuation function/access differs';end if;
end$guard$;
do $$declare j public.platform_jobs%rowtype;p public.platform_jobs%rowtype;
 r public.slack_campaign_recovery_requests%rowtype;a public.connector_accounts%rowtype;m public.slack_history_campaign_channels%rowtype;
 prior jsonb;begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz' then raise exception 'Exact production repair target required';end if;
 select * into strict j from public.platform_jobs where id='7b90eec5-fd4f-4bbf-ae99-6fc5a6c9d71c' for update;
 prior:=to_jsonb(j);
 select * into strict p from public.platform_jobs where id=j.parent_job_id for share;
 select * into strict r from public.slack_campaign_recovery_requests where id='1f814589-1f33-4e0c-be49-7ea54c94381f' for share;
 select * into strict a from public.connector_accounts where id='b702b4af-6e78-4789-a7c8-0d968f1abc27' for share;
 select * into strict m from public.slack_history_campaign_channels where campaign_id='a3980d74-29fa-4655-a914-61219cdf7dad' and account_id=a.id for share;
 if j.tenant_id is distinct from '00000000-0000-0000-0000-000000000001'::uuid
  or j.job_type is distinct from 'slack.history_sync' or j.status is distinct from 'queued' or j.attempt_count is distinct from 0
  or j.claimed_by is not null or j.lease_expires_at is not null or j.metadata ? 'slack_page_v1'
  or j.parent_job_id is distinct from 'd067667b-f494-44ca-84c2-4496137deb81'::uuid
  or p.status is distinct from 'succeeded' or r.job_id is distinct from p.id
  or r.tenant_id is distinct from j.tenant_id or r.account_id is distinct from a.id or r.campaign_id is distinct from m.campaign_id
  or a.tenant_id is distinct from j.tenant_id or m.tenant_id is distinct from j.tenant_id
  or m.current_import is distinct from 'b247e279-57cf-4ab0-9840-4c308b8ab854'::uuid
  or a.settings->'slack_history'->>'consentReference' is distinct from 'learn-slack-import:'||m.current_import::text
  or p.metadata->'slack_page_v1'->'next' is distinct from a.sync_cursor
  or p.metadata->'slack_finish_v1'->'answer'->>'successor_id' is distinct from j.id::text
  or j.payload is distinct from p.payload or j.payload->>'campaign_recovery_id' is distinct from r.id::text
  or j.payload->>'history_import_id' is distinct from m.current_import::text
  or a.sync_cursor->'complete' is distinct from 'false'::jsonb
  or not public.learn_slack_campaign_job_allowed(j.tenant_id,p.id)
 then raise exception 'Retained receipt-linked continuation changed';end if;
 update public.platform_jobs set payload=payload-'campaign_recovery_id' where id=j.id;
 select * into strict j from public.platform_jobs where id=j.id;
 if (to_jsonb(j)-array['payload','updated_at']) is distinct from (prior-array['payload','updated_at'])
  or j.payload is distinct from (prior->'payload')-'campaign_recovery_id'
  or not public.learn_slack_campaign_job_allowed(j.tenant_id,j.id)
  or not public.learn_slack_campaign_claim_allowed(j.tenant_id,j.id)
  or (select sync_cursor from public.connector_accounts where id=a.id) is distinct from a.sync_cursor
 then raise exception 'Continuation preservation/readiness failed';end if;
end$$;
commit;
