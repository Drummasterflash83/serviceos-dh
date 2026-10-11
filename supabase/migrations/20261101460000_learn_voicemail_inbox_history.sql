-- Discover existing caller-visible historical messages after a mailbox is reassigned.
-- SECURITY INVOKER throughout: no new message, mailbox or Storage permission.
begin;
create function public.learn_voicemail_mailboxes(p_tenant uuid,p_after uuid default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if current_user <> 'authenticated' or auth.uid() is null or p_tenant is null then
  raise exception using errcode='42501',message='Signed-in voicemail access required';
 end if;
 with visible_ids as materialized (
  select id from public.receptionist_mailboxes where tenant_id=p_tenant
  union
  select mailbox_id from public.receptionist_voicemails where tenant_id=p_tenant
 ), page_ids as materialized (
  select id from visible_ids where p_after is null or id>p_after order by id limit 21
 ), shown as materialized (
  select id from page_ids order by id limit 20
 ), rows as (
  select s.id,
   case when b.id is null then 'Earlier private messages' else b.display_name end as display_name,
   case when b.id is null then '' else b.extension end as extension,
   b.notification_email,b.email_enabled,
   coalesce(b.sync_state,'awaiting_connection') as sync_state,b.last_synced_at,
   (select count(*) from public.receptionist_voicemails v where v.tenant_id=p_tenant and v.mailbox_id=s.id) as message_count,
   case when b.id is null then 'retained_messages' else 'current' end as access_scope
  from shown s left join public.receptionist_mailboxes b on b.tenant_id=p_tenant and b.id=s.id
 )
 select jsonb_build_object('version','learn-voicemail-mailboxes/1','tenant_id',p_tenant,
  'after',p_after,'observed_at',statement_timestamp(),
  'next_after',case when (select count(*) from page_ids)>20 then (select id from shown order by id desc limit 1) else null end,
  'rows',coalesce((select jsonb_agg(to_jsonb(r) order by id) from rows r),'[]'::jsonb)) into result;
 return result;
end$$;
revoke all on function public.learn_voicemail_mailboxes(uuid,uuid) from public,anon,service_role;
grant execute on function public.learn_voicemail_mailboxes(uuid,uuid) to authenticated;
comment on function public.learn_voicemail_mailboxes(uuid,uuid) is
 'Caller-RLS paginated private inbox. Historical-only rows contain no current mailbox configuration; count only messages already visible to caller.';
commit;
