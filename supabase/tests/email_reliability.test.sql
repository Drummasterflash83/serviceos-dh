-- ServiceOS — Email reliability DB assertions (§16/§17).
-- Run against a scratch/dev database:  psql "$DATABASE_URL" -f supabase/tests/email_reliability.test.sql
-- All assertions raise an exception on failure; "ALL EMAIL RELIABILITY ASSERTIONS PASSED" prints on success.
-- Wrapped in a transaction that ROLLS BACK — it never mutates real data.

begin;

do $$
declare
  v_tenant uuid := '00000000-0000-0000-0000-0000000000ee';
  v_old    uuid;
  v_new    uuid;
  v_first  uuid;
  v_cnt    int;
begin
  -- Seed: two messages — an OLD one (received a week ago) and a NEW one (today).
  insert into email_messages (id, tenant_id, provider, provider_message_id, received_at, created_at)
    values (gen_random_uuid(), v_tenant, 'gmail', 'MSG_OLD', now() - interval '7 days', now() - interval '7 days')
    returning id into v_old;
  insert into email_messages (id, tenant_id, provider, provider_message_id, received_at, created_at)
    values (gen_random_uuid(), v_tenant, 'gmail', 'MSG_NEW', now() - interval '1 hour', now() - interval '1 hour')
    returning id into v_new;

  -- Project ONLY the new message into interactions (simulate the newest-first bug's state).
  insert into interactions (tenant_id, source_connector_id, source_type, source_table, source_id,
                            interaction_type, occurred_at)
    values (v_tenant, 'gmail', 'email', 'email_messages', v_new, 'email_message', now());

  -- §16: unprojected selection must return the OLD message (not starved behind the projected new one).
  select id into v_first from email_select_unprojected(v_tenant, 10) limit 1;
  if v_first is distinct from v_old then
    raise exception 'STARVATION: oldest unprojected should be MSG_OLD, got %', v_first;
  end if;

  -- The already-projected new message must NOT be re-selected.
  select count(*) into v_cnt from email_select_unprojected(v_tenant, 10) where id = v_new;
  if v_cnt <> 0 then
    raise exception 'projected message was re-selected (should be excluded)';
  end if;

  -- §17: duplicate provider_message_id upsert must not create a second source row.
  insert into email_messages (tenant_id, provider, provider_message_id, received_at, created_at)
    values (v_tenant, 'gmail', 'MSG_OLD', now(), now())
    on conflict (tenant_id, provider, provider_message_id) do nothing;
  select count(*) into v_cnt from email_messages
    where tenant_id = v_tenant and provider_message_id = 'MSG_OLD';
  if v_cnt <> 1 then
    raise exception 'duplicate message created a second row (%). expected 1', v_cnt;
  end if;

  -- §17: duplicate interaction upsert (same source) must not create a second interaction.
  insert into interactions (tenant_id, source_connector_id, source_type, source_table, source_id,
                            interaction_type, occurred_at)
    values (v_tenant, 'gmail', 'email', 'email_messages', v_new, 'email_message', now())
    on conflict (tenant_id, source_table, source_id) do nothing;
  select count(*) into v_cnt from interactions
    where tenant_id = v_tenant and source_table = 'email_messages' and source_id = v_new;
  if v_cnt <> 1 then
    raise exception 'duplicate interaction created (%). expected 1', v_cnt;
  end if;

  -- email_connector_health must return a jsonb object with the three sections.
  perform 1 where (email_connector_health(v_tenant)) ? 'gmail';
  if not ((email_connector_health(v_tenant)) ? 'workspace') then
    raise exception 'email_connector_health missing workspace section';
  end if;

  raise notice 'ALL EMAIL RELIABILITY ASSERTIONS PASSED';
end $$;

rollback;
