-- Explicit Chris request: accept the published report; archive the obsolete test.
-- Exact identifiers and optimistic versions; either both succeed or neither does.
begin;
select public.care_close_accepted_report(
 '00000000-0000-0000-0000-000000000001','c7f57ccd-980d-42e1-947c-09f85ba89b0b',
 (select actor_id from public.receptionist_releases where id='a256764d-0c49-4b62-93b7-0332b76f07c0'),
 12,'accept','Chris explicitly requested this published wording report be resolved on 29 September 2026. Vapi configuration is confirmed; a fresh recorded voice test is still pending. This acceptance does not establish that the earlier audio stutter is fixed.'
);
select public.care_close_accepted_report(
 '00000000-0000-0000-0000-000000000001','975299f3-f723-4c21-be3c-19d6870540d3',
 (select actor_id from public.receptionist_releases where id='a256764d-0c49-4b62-93b7-0332b76f07c0'),
 2,'archive','Chris requested deletion of the earlier reviewing test on 29 September 2026 so the next test starts with a clear queue. Archived recoverably; call evidence is retained and the audio cause is not marked fixed.'
);
insert into supabase_migrations.schema_migrations(version,name,statements) values('20261023180000','feedback_archive',ARRAY['Applied scoped migration via CLI on 2026-09-29']) on conflict(version) do nothing;
commit;
