-- Every audited task step must produce a notification, including a second
-- rehearsal whose human-readable progress message happens to be identical.
begin;
create or replace function public.care_desk_publish_progress() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.feedback_id is not null and (new.version is distinct from old.version or new.stage is distinct from old.stage or new.customer_update is distinct from old.customer_update) then
  update public.receptionist_feedback set response=new.customer_update,
   status=case new.stage when 'received' then 'New' when 'reviewing' then 'Reviewing' when 'approval' then 'Reviewing' when 'approved' then 'In progress' when 'verifying' then 'Ready to test' when 'resolved' then 'Resolved' end
  where id=new.feedback_id and tenant_id=new.tenant_id;
 end if;
 return new;
end $$;
revoke all on function public.care_desk_publish_progress() from public,anon,authenticated;
commit;
