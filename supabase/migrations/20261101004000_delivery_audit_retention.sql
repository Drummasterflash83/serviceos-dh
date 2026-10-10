-- Delivery publication uses the shared audit log. Prevent history mutation,
-- including TRUNCATE; clients cannot read or append raw operator audit records.
begin;
create function public.learn_delivery_audit_immutable() returns trigger
language plpgsql set search_path='' as $$
begin
 raise exception 'Control Plane history is append-only' using errcode='23001';
end $$;
revoke all on function public.learn_delivery_audit_immutable() from public,anon,authenticated;
create trigger learn_delivery_audit_no_update before update on public.controlplane_change_log
for each row execute function public.learn_delivery_audit_immutable();
create trigger learn_delivery_audit_no_delete before delete on public.controlplane_change_log
for each row execute function public.learn_delivery_audit_immutable();
create trigger learn_delivery_audit_no_truncate before truncate on public.controlplane_change_log
for each statement execute function public.learn_delivery_audit_immutable();
alter table public.controlplane_change_log enable row level security;
revoke all on public.controlplane_change_log from anon,authenticated;
grant select on public.controlplane_change_log to authenticated;
grant select,insert on public.controlplane_change_log to service_role;
revoke update,delete,truncate on public.controlplane_change_log from service_role;
drop policy if exists controlplane_change_log_select on public.controlplane_change_log;
create policy controlplane_change_log_select on public.controlplane_change_log for select to authenticated
using (public.current_user_is_openfolk_operator());
commit;
