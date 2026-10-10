-- Service-only status fields needed by the existing security-invoker backlog view.
-- Does not grant transcript/insight content, writes, user authority or start work.
begin;
grant select (tenant_id,recording_id,status) on public.phone_transcripts to service_role;
grant select (tenant_id,recording_id) on public.phone_ai_insights to service_role;
commit;
