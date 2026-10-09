-- Recovery hardening: do not depend on a database's default table/function
-- privileges. Some historical local environments grant new tables to API roles.
-- The durable row ledger belongs to the server; safe tenant-scoped conflict and
-- identity reads remain available through their existing RLS policies.
revoke all on public.import_row_results from public, anon, authenticated;
grant select, insert, update on public.import_row_results to service_role;
revoke delete, truncate on public.import_row_results from service_role;

revoke all on public.import_entity_links, public.import_conflicts
  from public, anon, authenticated;
grant select on public.import_entity_links, public.import_conflicts to authenticated;
grant select, insert, update, delete on public.import_entity_links, public.import_conflicts
  to service_role;
revoke truncate on public.import_entity_links, public.import_conflicts from service_role;

-- Helpers introduced after the base import migration need the same explicit
-- server-only boundary as the row RPCs which call them.
revoke all on function public.import_person_contact_points(uuid, uuid, jsonb),
  public.import_resolve_job_site_exact(uuid, text, text, uuid, text),
  public.import_resolve_job_site_v2(uuid, text, text, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.import_person_contact_points(uuid, uuid, jsonb),
  public.import_resolve_job_site_exact(uuid, text, text, uuid, text),
  public.import_resolve_job_site_v2(uuid, text, text, uuid, text, text, text)
  to service_role;
