-- Directory-verified profile identity for existing Workspace aliases.
-- Do not infer bindings for retained accounts or rename historical source keys.
begin;
set local lock_timeout='3s';
alter table public.google_workspace_mailboxes
 add column directory_primary_email text,
 add column directory_identity_conflict boolean not null default false,
 add constraint google_workspace_directory_primary_email_valid check(
  directory_primary_email is null or
  (length(directory_primary_email)<=320 and directory_primary_email=lower(directory_primary_email)
   and directory_primary_email~'^[^[:space:]@]+@[^[:space:]@]+$'));
comment on column public.google_workspace_mailboxes.directory_primary_email is
 'Primary email returned by the complete tenant-bound directory scan. Null means unverified; never infer from an alias string.';
comment on column public.google_workspace_mailboxes.directory_identity_conflict is
 'Latched when a known address resolves to a different directory owner. Capture remains held pending explicit identity review; history is retained.';
-- Serialize conflicting directory refreshes at the row update, so two scans
-- that both read an unbound address cannot silently replace the first owner.
create function public.learn_workspace_identity_guard() returns trigger
language plpgsql set search_path=pg_catalog as $$begin
 if old.directory_primary_email is not null then
  if (new.tenant_id,new.connection_id,lower(new.email_address)) is distinct from
     (old.tenant_id,old.connection_id,lower(old.email_address)) then
   raise exception 'workspace_identity_scope_changed' using errcode='PT409';
  end if;
  if new.directory_primary_email is distinct from old.directory_primary_email then
   new.directory_primary_email:=old.directory_primary_email;
   new.directory_identity_conflict:=true;
  end if;
 end if;
 new.directory_identity_conflict:=old.directory_identity_conflict or new.directory_identity_conflict;
 return new;
end $$;
revoke all on function public.learn_workspace_identity_guard() from public,anon,authenticated,service_role;
create trigger learn_workspace_identity_guard before update on public.google_workspace_mailboxes
 for each row execute function public.learn_workspace_identity_guard();
commit;
