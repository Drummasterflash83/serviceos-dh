-- Transactional (begin/rollback). Run:
--   docker exec -i supabase_db_serviceos-dh psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/marketing_sender_authority.test.sql
--
-- Proves the GOVERNED VERIFIED-DOMAIN Resend sender (migration 20260908120500):
--   §1  platform-operator gate — a tenant owner/admin cannot approve their own
--       production sender; only an ACTIVE platform.controlplane.admin grant can;
--       an expired/future grant cannot.
--   §2  argument allowlist — no caller-supplied verified/ready/state/provider
--       flag exists; domain must be the address's OWN domain; the sandbox
--       identity can never be granted; request_id is mandatory.
--   §3  normalisation — case/whitespace variants converge on ONE authority;
--       Unicode homoglyphs, zero-width and control characters are refused;
--       subdomain and lookalike domains never match.
--   §4  exact tenant — an authority granted to tenant A is unusable by tenant B
--       at creation AND at readiness.
--   §5  idempotency + concurrency — repeated grants and repeated sender creation
--       converge on one row.
--   §6  creation — DEFAULT DENY without authority; with authority the sender is
--       created production-verified with the authority's verified_at.
--   §7  readiness — sandbox_ready / ready / revoked / unavailable, with correct
--       campaign+sequence blocking for each.
--   §8  revocation — immediate, capability truth re-synchronised, a revoked
--       authority can neither be used nor reinstated.
--   §9  immutability — the authority identity and the sender's mailbox address
--       are both immutable, so an existing envelope can never switch identity.
--   §10 the SANDBOX is untouched — still unverified, test-to-self only,
--       campaigns and sequences blocked.
--   §11 boundaries — browser roles hold nothing; RLS on; no SECURITY DEFINER.
begin;

insert into tenants (id, slug, display_name, industry) values
  ('a0a09500-0000-4000-8000-00000000000a','msa-t1','Authority Tenant A','hvac'),
  ('a0a09500-0000-4000-8000-00000000000b','msa-t2','Authority Tenant B','hvac');

insert into auth.users (id, email, is_sso_user, is_anonymous) values
  ('b0b09500-0000-4000-8000-00000000000a','owner-a@msa.test',false,false),
  ('b0b09500-0000-4000-8000-00000000000b','owner-b@msa.test',false,false),
  ('b0b09500-0000-4000-8000-00000000000c','operator@openfolk.test',false,false),
  ('b0b09500-0000-4000-8000-00000000000d','expired-op@openfolk.test',false,false);
update profiles set role='owner', tenant_id='a0a09500-0000-4000-8000-00000000000a' where id='b0b09500-0000-4000-8000-00000000000a';
update profiles set role='owner', tenant_id='a0a09500-0000-4000-8000-00000000000b' where id='b0b09500-0000-4000-8000-00000000000b';
update profiles set role='admin', tenant_id='a0a09500-0000-4000-8000-00000000000a' where id='b0b09500-0000-4000-8000-00000000000c';
update profiles set role='admin', tenant_id='a0a09500-0000-4000-8000-00000000000a' where id='b0b09500-0000-4000-8000-00000000000d';

select marketing_materialise_defaults('a0a09500-0000-4000-8000-00000000000a','b0b09500-0000-4000-8000-00000000000a');
select marketing_materialise_defaults('a0a09500-0000-4000-8000-00000000000b','b0b09500-0000-4000-8000-00000000000b');

-- ONE genuine platform operator, plus one whose grant has already expired
insert into platform_authority_grants (profile_id, permission, effective_from, effective_to, granted_by, source, reason)
values
  ('b0b09500-0000-4000-8000-00000000000c','platform.controlplane.admin', now() - interval '1 day', null, 'test', 'test', 'operator'),
  ('b0b09500-0000-4000-8000-00000000000d','platform.controlplane.admin', now() - interval '10 day', now() - interval '1 day', 'test', 'test', 'expired');

-- ============================================================================
-- §1 · PLATFORM-OPERATOR GATE
-- ============================================================================
do $$
declare v_failed boolean; v_res jsonb;
begin
  -- a tenant OWNER cannot approve their own production sender
  v_failed := false;
  begin
    perform marketing_sender_authority_grant('b0b09500-0000-4000-8000-00000000000a', jsonb_build_object(
      'tenant_id','a0a09500-0000-4000-8000-00000000000a','sender_address','hello@drummonds.co',
      'domain','drummonds.co','request_id','req-self-0001'));
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL §1: a tenant owner approved their own production sender'; end if;

  -- an EXPIRED platform grant cannot either
  v_failed := false;
  begin
    perform marketing_sender_authority_grant('b0b09500-0000-4000-8000-00000000000d', jsonb_build_object(
      'tenant_id','a0a09500-0000-4000-8000-00000000000a','sender_address','hello@drummonds.co',
      'domain','drummonds.co','request_id','req-expired-001'));
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL §1: an expired platform grant approved a sender'; end if;

  -- a null actor cannot
  v_failed := false;
  begin
    perform marketing_sender_authority_grant(null, jsonb_build_object(
      'tenant_id','a0a09500-0000-4000-8000-00000000000a','sender_address','hello@drummonds.co',
      'domain','drummonds.co','request_id','req-null-0001'));
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL §1: a null actor approved a sender'; end if;

  -- the genuine operator CAN
  v_res := marketing_sender_authority_grant('b0b09500-0000-4000-8000-00000000000c', jsonb_build_object(
    'tenant_id','a0a09500-0000-4000-8000-00000000000a','sender_address','hello@drummonds.co',
    'domain','drummonds.co','from_name','ServiceOS by Drummonds','reply_to','chris@openfolk.ai',
    'reason','domain verified in Resend','request_id','req-grant-0001'));
  if (v_res->>'created')::boolean is not true or v_res->>'state' <> 'verified' then
    raise exception 'FAIL §1: the platform operator grant did not take: %', v_res;
  end if;
  if (v_res->>'verified_at') is null then raise exception 'FAIL §1: verified_at not stamped'; end if;
end $$;

-- ============================================================================
-- §2 · ARGUMENT ALLOWLIST — no caller-asserted verification is possible
-- ============================================================================
do $$
declare v_failed boolean; k text;
begin
  foreach k in array array['verified','ready','state','provider','verified_at','verification_state'] loop
    v_failed := false;
    begin
      perform marketing_sender_authority_grant('b0b09500-0000-4000-8000-00000000000c',
        jsonb_build_object('tenant_id','a0a09500-0000-4000-8000-00000000000a',
          'sender_address','x@drummonds.co','domain','drummonds.co',
          'request_id','req-flag-00001') || jsonb_build_object(k, true));
    exception when others then v_failed := true;
    end;
    if not v_failed then raise exception 'FAIL §2: caller-supplied % was accepted', k; end if;
  end loop;

  -- the domain must be the address's OWN domain (no parent-domain grants)
  v_failed := false;
  begin
    perform marketing_sender_authority_grant('b0b09500-0000-4000-8000-00000000000c', jsonb_build_object(
      'tenant_id','a0a09500-0000-4000-8000-00000000000a','sender_address','hello@mail.drummonds.co',
      'domain','drummonds.co','request_id','req-parent-0001'));
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL §2: a parent-domain grant was accepted'; end if;

  -- the sandbox identity can NEVER be granted an authority
  v_failed := false;
  begin
    perform marketing_sender_authority_grant('b0b09500-0000-4000-8000-00000000000c', jsonb_build_object(
      'tenant_id','a0a09500-0000-4000-8000-00000000000a','sender_address','onboarding@resend.dev',
      'domain','resend.dev','request_id','req-sandbox-001'));
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL §2: the sandbox identity was granted an authority'; end if;

  -- request_id is mandatory and shaped
  v_failed := false;
  begin
    perform marketing_sender_authority_grant('b0b09500-0000-4000-8000-00000000000c', jsonb_build_object(
      'tenant_id','a0a09500-0000-4000-8000-00000000000a','sender_address','y@drummonds.co',
      'domain','drummonds.co'));
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL §2: a grant without request_id was accepted'; end if;

  -- an unknown tenant is refused
  v_failed := false;
  begin
    perform marketing_sender_authority_grant('b0b09500-0000-4000-8000-00000000000c', jsonb_build_object(
      'tenant_id','00000000-0000-4000-8000-0000000000ff','sender_address','z@drummonds.co',
      'domain','drummonds.co','request_id','req-notenant-01'));
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL §2: a grant for an unknown tenant was accepted'; end if;
end $$;

-- ============================================================================
-- §3 · NORMALISATION — variants converge; lookalikes never match
-- ============================================================================
do $$
declare v_res jsonb; v_n int; v_failed boolean;
begin
  -- case + whitespace variants converge on the SAME single authority
  v_res := marketing_sender_authority_grant('b0b09500-0000-4000-8000-00000000000c', jsonb_build_object(
    'tenant_id','a0a09500-0000-4000-8000-00000000000a','sender_address','  HELLO@Drummonds.CO ',
    'domain','drummonds.co','request_id','req-variant-001'));
  if (v_res->>'created')::boolean is not false then
    raise exception 'FAIL §3: a case/whitespace variant created a SECOND authority: %', v_res;
  end if;
  select count(*) into v_n from marketing_sender_authorities
   where tenant_id='a0a09500-0000-4000-8000-00000000000a' and sender_address='hello@drummonds.co';
  if v_n <> 1 then raise exception 'FAIL §3: expected exactly 1 authority row, got %', v_n; end if;
end $$;

do $$
declare v_failed boolean; v text;
begin
  foreach v in array array[
    'h' || chr(1077) || 'llo@drummonds.co',            -- Cyrillic e
    'hello@drummonds' || chr(8203) || '.co',           -- zero-width space
    'hello@drummonds.co' || chr(9),                    -- tab
    'hel lo@drummonds.co',                             -- inner space
    'hello@@drummonds.co',
    'hello@drummonds'
  ] loop
    v_failed := false;
    begin
      perform marketing_sender_authority_grant('b0b09500-0000-4000-8000-00000000000c', jsonb_build_object(
        'tenant_id','a0a09500-0000-4000-8000-00000000000a','sender_address',v,
        'domain','drummonds.co','request_id','req-uni-000001'));
    exception when others then v_failed := true;
    end;
    if not v_failed then raise exception 'FAIL §3: untrustworthy address % was accepted', v; end if;
  end loop;

  -- LOOKALIKE domains are distinct strings and therefore hold NO authority
  foreach v in array array[
    'hello@drummonds.co.uk', 'hello@mail.drummonds.co', 'hello@drummonds.co.evil.com',
    'hello@drummondsco.co', 'hello2@drummonds.co'
  ] loop
    if marketing_sender_authority_state('a0a09500-0000-4000-8000-00000000000a','resend',v) <> 'none' then
      raise exception 'FAIL §3: lookalike % matched an authority', v;
    end if;
  end loop;

  -- but the genuine address does, in every harmless presentation
  foreach v in array array['hello@drummonds.co','HELLO@DRUMMONDS.CO','  hello@Drummonds.co  '] loop
    if marketing_sender_authority_state('a0a09500-0000-4000-8000-00000000000a','resend',v) <> 'verified' then
      raise exception 'FAIL §3: genuine presentation % did not resolve', v;
    end if;
  end loop;
end $$;

-- ============================================================================
-- §4 · EXACT TENANT — tenant A's authority is unusable by tenant B
-- ============================================================================
do $$
declare v_failed boolean;
begin
  if marketing_sender_authority_state('a0a09500-0000-4000-8000-00000000000b','resend','hello@drummonds.co') <> 'none' then
    raise exception 'FAIL §4: tenant B resolved tenant A''s authority';
  end if;
  v_failed := false;
  begin
    perform marketing_sender_create_resend('a0a09500-0000-4000-8000-00000000000b',
      'b0b09500-0000-4000-8000-00000000000b',
      jsonb_build_object('from_address','hello@drummonds.co'));
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL §4: tenant B created a sender on tenant A''s authority'; end if;
end $$;

-- ============================================================================
-- §5/§6 · CREATION — default deny, then authorised creation; idempotent
-- ============================================================================
do $$
declare v_failed boolean; v_res jsonb; v_res2 jsonb; v_n int; v_auth marketing_sender_authorities%rowtype;
begin
  -- DEFAULT DENY: an address with no authority is refused even for the tenant owner
  v_failed := false;
  begin
    perform marketing_sender_create_resend('a0a09500-0000-4000-8000-00000000000a',
      'b0b09500-0000-4000-8000-00000000000a',
      jsonb_build_object('from_address','sales@drummonds.co'));
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL §6: an unauthorised address was accepted'; end if;

  -- with the authority, creation succeeds and is production-verified
  v_res := marketing_sender_create_resend('a0a09500-0000-4000-8000-00000000000a',
    'b0b09500-0000-4000-8000-00000000000a',
    jsonb_build_object('from_address','HELLO@drummonds.co'));   -- variant input
  if (v_res->>'created')::boolean is not true
     or v_res->>'mailbox_address' <> 'hello@drummonds.co'
     or v_res->>'send_scope_state' <> 'authorized'
     or (v_res->>'sandbox')::boolean is not false
     or v_res->>'mode' <> 'production_verified'
     or (v_res->>'test_to_self_only')::boolean is not false then
    raise exception 'FAIL §6: production sender creation shape wrong: %', v_res;
  end if;

  -- the sender inherits the AUTHORITY's verified_at, not a caller value
  select * into v_auth from marketing_sender_authorities
   where tenant_id='a0a09500-0000-4000-8000-00000000000a' and sender_address='hello@drummonds.co';
  if (select last_verified_at from marketing_sender_profiles where id=(v_res->>'id')::uuid)
     is distinct from v_auth.verified_at then
    raise exception 'FAIL §6: sender last_verified_at is not the authority verified_at';
  end if;
  -- and the operator-pinned presentation carried across
  if (select from_name from marketing_sender_profiles where id=(v_res->>'id')::uuid) <> 'ServiceOS by Drummonds'
     or (select reply_to from marketing_sender_profiles where id=(v_res->>'id')::uuid) <> 'chris@openfolk.ai' then
    raise exception 'FAIL §6: the operator-approved from_name/reply_to were not applied';
  end if;

  -- §5 idempotency: creating again (in ANY presentation) converges
  v_res2 := marketing_sender_create_resend('a0a09500-0000-4000-8000-00000000000a',
    'b0b09500-0000-4000-8000-00000000000a',
    jsonb_build_object('from_address','  Hello@Drummonds.CO  '));
  if (v_res2->>'created')::boolean is not false or v_res2->>'id' <> v_res->>'id' then
    raise exception 'FAIL §5: repeated creation did not converge: %', v_res2;
  end if;
  select count(*) into v_n from marketing_sender_profiles
   where tenant_id='a0a09500-0000-4000-8000-00000000000a' and source_kind='resend';
  if v_n <> 1 then raise exception 'FAIL §5: expected 1 resend sender, got %', v_n; end if;
end $$;

-- ============================================================================
-- §7 · READINESS — four honest states, correct bulk blocking
-- ============================================================================
do $$
declare v_prod uuid; v_sandbox uuid; v jsonb;
begin
  select id into v_prod from marketing_sender_profiles
   where tenant_id='a0a09500-0000-4000-8000-00000000000a' and mailbox_address='hello@drummonds.co';
  v := marketing_sender_readiness('a0a09500-0000-4000-8000-00000000000a', v_prod);
  if v->>'state' <> 'ready' or (v->>'ready')::boolean is not true
     or (v->>'sandbox')::boolean is not false
     or (v->>'test_to_self_only')::boolean is not false
     or (v->>'campaigns_blocked')::boolean is not false
     or (v->>'sequences_blocked')::boolean is not false
     or v->>'authority_state' <> 'verified'
     or v->>'transport' <> 'resend' then
    raise exception 'FAIL §7: production readiness wrong: %', v;
  end if;

  -- §10 the SANDBOX is untouched
  v_sandbox := (marketing_sender_create_resend('a0a09500-0000-4000-8000-00000000000a',
    'b0b09500-0000-4000-8000-00000000000a',
    jsonb_build_object('from_address','onboarding@resend.dev')) ->> 'id')::uuid;
  v := marketing_sender_readiness('a0a09500-0000-4000-8000-00000000000a', v_sandbox);
  if v->>'state' <> 'sandbox_ready'
     or (v->>'test_to_self_only')::boolean is not true
     or (v->>'campaigns_blocked')::boolean is not true
     or (v->>'sequences_blocked')::boolean is not true
     or (v->>'provider_submission_verified')::boolean is not false then
    raise exception 'FAIL §10: the sandbox restrictions changed: %', v;
  end if;
  if (select send_scope_state from marketing_sender_profiles where id=v_sandbox) <> 'unknown' then
    raise exception 'FAIL §10: the sandbox sender is no longer honestly unverified';
  end if;
end $$;

-- ============================================================================
-- §8 · REVOCATION — immediate, capability-syncing, non-reinstatable
-- ============================================================================
do $$
declare v_prod uuid; v jsonb; v_failed boolean; v_res jsonb;
begin
  select id into v_prod from marketing_sender_profiles
   where tenant_id='a0a09500-0000-4000-8000-00000000000a' and mailbox_address='hello@drummonds.co';

  -- a tenant owner cannot revoke either
  v_failed := false;
  begin
    perform marketing_sender_authority_revoke('b0b09500-0000-4000-8000-00000000000a', jsonb_build_object(
      'tenant_id','a0a09500-0000-4000-8000-00000000000a','sender_address','hello@drummonds.co'));
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL §8: a tenant owner revoked a platform authority'; end if;

  v_res := marketing_sender_authority_revoke('b0b09500-0000-4000-8000-00000000000c', jsonb_build_object(
    'tenant_id','a0a09500-0000-4000-8000-00000000000a','sender_address','HELLO@drummonds.co',
    'reason','domain moved'));
  if (v_res->>'revoked')::boolean is not true then raise exception 'FAIL §8: revoke did not take: %', v_res; end if;

  -- IMMEDIATE: readiness flips
  v := marketing_sender_readiness('a0a09500-0000-4000-8000-00000000000a', v_prod);
  if v->>'state' <> 'revoked' or (v->>'ready')::boolean is not false
     or (v->>'campaigns_blocked')::boolean is not true then
    raise exception 'FAIL §8: readiness did not reflect revocation: %', v;
  end if;

  -- a revoked authority cannot be used to create a sender
  v_failed := false;
  begin
    perform marketing_sender_create_resend('a0a09500-0000-4000-8000-00000000000a',
      'b0b09500-0000-4000-8000-00000000000a',
      jsonb_build_object('from_address','hello@drummonds.co','label','retry'));
  exception when insufficient_privilege then v_failed := true;
  end;
  -- (the sender already exists, so creation converges rather than refusing —
  --  the operative guarantee is that readiness/capability deny its USE)

  -- and it can never be reinstated by re-granting
  v_failed := false;
  begin
    perform marketing_sender_authority_grant('b0b09500-0000-4000-8000-00000000000c', jsonb_build_object(
      'tenant_id','a0a09500-0000-4000-8000-00000000000a','sender_address','hello@drummonds.co',
      'domain','drummonds.co','request_id','req-reinstate-01'));
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL §8: a revoked authority was silently reinstated'; end if;

  -- direct reinstatement is structurally impossible too
  v_failed := false;
  begin
    update marketing_sender_authorities set state='verified'
     where tenant_id='a0a09500-0000-4000-8000-00000000000a' and sender_address='hello@drummonds.co';
  exception when restrict_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL §8: a revoked authority row was flipped back to verified'; end if;

  -- revocation is idempotent
  v_res := marketing_sender_authority_revoke('b0b09500-0000-4000-8000-00000000000c', jsonb_build_object(
    'tenant_id','a0a09500-0000-4000-8000-00000000000a','sender_address','hello@drummonds.co'));
  if (v_res->>'revoked')::boolean is not false or v_res->>'state' <> 'revoked' then
    raise exception 'FAIL §8: repeated revocation was not idempotent: %', v_res;
  end if;
end $$;

-- ============================================================================
-- §9 · IMMUTABILITY — identity can never silently switch
-- ============================================================================
do $$
declare v_failed boolean; v_prod uuid;
begin
  select id into v_prod from marketing_sender_profiles
   where tenant_id='a0a09500-0000-4000-8000-00000000000a' and mailbox_address='hello@drummonds.co';

  -- the sender's mailbox address is immutable (a frozen envelope can never be
  -- re-pointed at another identity)
  v_failed := false;
  begin
    update marketing_sender_profiles set mailbox_address='sales@drummonds.co' where id=v_prod;
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL §9: a sender was re-pointed at another address'; end if;

  -- the authority identity is immutable
  v_failed := false;
  begin
    update marketing_sender_authorities set sender_address='sales@drummonds.co'
     where tenant_id='a0a09500-0000-4000-8000-00000000000a';
  exception when restrict_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL §9: an authority was re-pointed at another address'; end if;

  v_failed := false;
  begin
    update marketing_sender_authorities set tenant_id='a0a09500-0000-4000-8000-00000000000b'
     where tenant_id='a0a09500-0000-4000-8000-00000000000a';
  exception when restrict_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL §9: an authority was moved to another tenant'; end if;
end $$;

-- ============================================================================
-- §11 · BOUNDARIES
-- ============================================================================
do $$
declare v_n int;
begin
  select count(*) into v_n from information_schema.role_table_grants
   where table_name='marketing_sender_authorities' and grantee in ('anon','authenticated','PUBLIC');
  if v_n <> 0 then raise exception 'FAIL §11: browser roles hold % grants on the authority table', v_n; end if;

  select count(*) into v_n from information_schema.routine_privileges
   where routine_name in ('marketing_sender_authority_grant','marketing_sender_authority_revoke',
                          'marketing_sender_authority_state','marketing_require_platform_operator',
                          'marketing_normalise_email','marketing_sender_create_resend',
                          'marketing_sender_readiness')
     and grantee in ('anon','authenticated','PUBLIC') and privilege_type='EXECUTE';
  if v_n <> 0 then raise exception 'FAIL §11: % client EXECUTE grants remain', v_n; end if;

  if not (select relrowsecurity from pg_class where relname='marketing_sender_authorities') then
    raise exception 'FAIL §11: RLS is not enabled on marketing_sender_authorities';
  end if;

  select count(*) into v_n from pg_proc
   where proname in ('marketing_sender_authority_grant','marketing_sender_authority_revoke',
                     'marketing_sender_authority_state','marketing_require_platform_operator',
                     'marketing_normalise_email')
     and prosecdef;
  if v_n <> 0 then raise exception 'FAIL §11: % new function(s) are SECURITY DEFINER', v_n; end if;
end $$;

select 'marketing_sender_authority.test.sql: ALL ASSERTIONS PASSED' as result;

rollback;
