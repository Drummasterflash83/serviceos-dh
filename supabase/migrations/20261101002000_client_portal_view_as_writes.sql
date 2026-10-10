-- Client preview is read-only, including direct PostgREST writes. Existing
-- membership/operator policies remain mandatory; this only restricts writes.
begin;
create function public.client_portal_write_context() returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and not exists (
  select 1 from public.view_as_context where actor_user_id=auth.uid()
   and ended_at is null and (expires_at is null or expires_at>now())
 );
$$;
revoke all on function public.client_portal_write_context() from public,anon,authenticated;
grant execute on function public.client_portal_write_context() to authenticated;

create policy programme_preview_insert_guard on public.client_programmes
 as restrictive for insert to authenticated with check(public.client_portal_write_context());
create policy programme_preview_update_guard on public.client_programmes
 as restrictive for update to authenticated using(public.client_portal_write_context())
 with check(public.client_portal_write_context());
create policy programme_note_preview_guard on public.client_programme_notes
 as restrictive for insert to authenticated with check(public.client_portal_write_context());
create policy feedback_preview_insert_guard on public.receptionist_feedback
 as restrictive for insert to authenticated with check(public.client_portal_write_context());
create policy feedback_preview_update_guard on public.receptionist_feedback
 as restrictive for update to authenticated using(public.client_portal_write_context())
 with check(public.client_portal_write_context());
commit;
