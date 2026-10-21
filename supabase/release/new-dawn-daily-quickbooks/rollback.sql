-- Stop future daily reads. Existing private report receipts remain intact.
begin;
select cron.unschedule('openfolk-quickbooks-daily-reports');
with stopped as (
 update public.learn_quickbooks_daily_reports set enabled=false,revision=revision+1,
  changed_at=clock_timestamp() where connection_id='04d68333-fc13-42c2-a500-789f386f015c'::uuid
  and tenant_id='00000000-0000-0000-0000-000000000001'::uuid and enabled
 returning tenant_id,connection_id,revision
)
insert into public.controlplane_change_log
 (tenant_id,actor,action,resource_type,resource_id,after,reason,
  correlation_id,view_as_active,source)
select tenant_id,'system:release','quickbooks.daily_report_emergency_pause',
 'quickbooks',connection_id::text,
 jsonb_build_object('enabled',false,'revision',revision),
 'Stop future daily QuickBooks source reads during release rollback',
 gen_random_uuid()::text,false,'new-dawn-quickbooks-daily-rollback'
from stopped;
commit;
