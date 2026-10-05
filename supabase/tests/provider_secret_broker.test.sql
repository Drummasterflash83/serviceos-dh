-- ServiceOS — Provider secret broker proof (Vault write/read/replace/revoke + isolation).
-- Transactional: begin; ... rollback; so no residue. Run:
--   docker exec -i supabase_db_serviceos-dh psql -U postgres -d postgres < supabase/tests/provider_secret_broker.test.sql
-- Every assertion RAISEs EXCEPTION on failure (aborts with a clear message); a clean run
-- ending in "ALL PROVIDER-SECRET-BROKER TESTS PASSED" means every property held.
begin;

do $$
declare
  ta uuid := '11111111-1111-1111-1111-111111111111';
  tb uuid := '22222222-2222-2222-2222-222222222222';
  id1 uuid; id2 uuid;
  got text; cipher text; n int;
begin
  -- 1. create + read roundtrip
  id1 := public.provider_secret_store(ta, 'mock', 'api_key', 'SECRET-AAA-111');
  if id1 is null then raise exception 'FAIL: store returned null id'; end if;
  got := public.provider_secret_read(ta, 'mock', 'api_key');
  if got is distinct from 'SECRET-AAA-111' then raise exception 'FAIL: roundtrip got %', got; end if;

  -- 2. encrypted at rest: stored ciphertext must NOT equal the plaintext
  select secret into cipher from vault.secrets
    where name = public.provider_secret_name(ta, 'mock', 'api_key');
  if cipher = 'SECRET-AAA-111' then raise exception 'FAIL: secret stored in plaintext'; end if;
  if cipher is null then raise exception 'FAIL: no ciphertext row'; end if;

  -- 3. replacement updates in place (same id, new value, NO duplicate row)
  id2 := public.provider_secret_store(ta, 'mock', 'api_key', 'SECRET-BBB-222');
  if id2 is distinct from id1 then raise exception 'FAIL: replacement changed id % -> %', id1, id2; end if;
  got := public.provider_secret_read(ta, 'mock', 'api_key');
  if got is distinct from 'SECRET-BBB-222' then raise exception 'FAIL: replacement value %', got; end if;
  select count(*) into n from vault.secrets
    where name = public.provider_secret_name(ta, 'mock', 'api_key');
  if n <> 1 then raise exception 'FAIL: expected 1 vault row after replace, got %', n; end if;

  -- 4. tenant isolation: tenant B same provider/field is a DIFFERENT secret + different name
  perform public.provider_secret_store(tb, 'mock', 'api_key', 'SECRET-B-999');
  if public.provider_secret_name(ta,'mock','api_key') = public.provider_secret_name(tb,'mock','api_key')
    then raise exception 'FAIL: tenant names collide'; end if;
  if public.provider_secret_read(ta, 'mock', 'api_key') <> 'SECRET-BBB-222'
    then raise exception 'FAIL: tenant A leaked/overwritten by B'; end if;
  if public.provider_secret_read(tb, 'mock', 'api_key') <> 'SECRET-B-999'
    then raise exception 'FAIL: tenant B value wrong'; end if;

  -- 5. multi-field + revoke removes ALL fields for that tenant+provider only
  perform public.provider_secret_store(ta, 'mock', 'password', 'PW-AAA');
  n := public.provider_secret_revoke(ta, 'mock');
  if n <> 2 then raise exception 'FAIL: revoke removed % (expected 2)', n; end if;
  if public.provider_secret_read(ta, 'mock', 'api_key') is not null
    then raise exception 'FAIL: secret readable after revoke'; end if;
  if public.provider_secret_read(tb, 'mock', 'api_key') <> 'SECRET-B-999'
    then raise exception 'FAIL: revoke of A affected B'; end if;

  -- 6. empty-secret rejection
  begin
    perform public.provider_secret_store(ta, 'mock', 'api_key', '');
    raise exception 'FAIL: empty secret was accepted';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if; -- re-raise our own assertion
  end;

  raise notice 'behavioural properties: PASS';
end $$;

-- 7. authorization surface: decrypt/read/store/revoke are service_role-only, NOT authenticated/anon
do $$
begin
  if has_function_privilege('authenticated', 'public.provider_secret_read(uuid,text,text)', 'execute')
    then raise exception 'FAIL: authenticated can execute provider_secret_read'; end if;
  if has_function_privilege('anon', 'public.provider_secret_read(uuid,text,text)', 'execute')
    then raise exception 'FAIL: anon can execute provider_secret_read'; end if;
  if has_function_privilege('authenticated', 'public.provider_secret_store(uuid,text,text,text)', 'execute')
    then raise exception 'FAIL: authenticated can execute provider_secret_store'; end if;
  if not has_function_privilege('service_role', 'public.provider_secret_read(uuid,text,text)', 'execute')
    then raise exception 'FAIL: service_role cannot execute provider_secret_read'; end if;
  -- vault schema itself is not exposed to the Data API
  if has_schema_privilege('authenticated', 'vault', 'usage')
    then raise exception 'FAIL: authenticated has USAGE on vault schema'; end if;
  if has_schema_privilege('anon', 'vault', 'usage')
    then raise exception 'FAIL: anon has USAGE on vault schema'; end if;
  raise notice 'authorization surface: PASS';
end $$;

do $$ begin raise notice 'ALL PROVIDER-SECRET-BROKER TESTS PASSED'; end $$;

rollback;
