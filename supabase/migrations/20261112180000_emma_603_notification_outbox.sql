-- Emma emergency 603 notification reservation. No route, sender, schedule or
-- source is activated by this migration. Provider-delivery verification is a
-- separate gate; an accepted email is never called delivered here.
begin;

create table public.receptionist_emergency_603_delivery_config (
  tenant_id uuid primary key references public.tenants(id),
  email_owner text not null check (email_owner in ('openfolk_sender','birchills_distribution')),
  reviewed_slack_channel text not null check (reviewed_slack_channel ~ '^[CG][A-Z0-9]+$'),
  route_version text not null check (length(btrim(route_version)) between 1 and 120),
  preparation_enabled boolean not null default false,
  sender_enabled boolean not null default false,
  reviewed_at timestamptz not null,
  check (not sender_enabled or preparation_enabled)
);

create table public.receptionist_emergency_603_outbox (
  delivery_id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  source_id uuid not null,
  target text not null check (target in ('rob_email','tony_email','urgent_slack')),
  destination text not null,
  mailbox_message_id uuid not null,
  audio_sha256 text not null check (audio_sha256 ~ '^[a-f0-9]{64}$'),
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  proof_sha256 text not null check (proof_sha256 ~ '^[a-f0-9]{64}$'),
  route_version text not null,
  email_owner text not null check (email_owner='openfolk_sender'),
  state text not null default 'prepared'
    check (state in ('prepared','reserved','submitted','posted','uncertain')),
  reservation_id uuid,
  reserved_until timestamptz,
  provider_reference text,
  created_at timestamptz not null default clock_timestamp(),
  settled_at timestamptz,
  unique (tenant_id,source_id,target),
  foreign key (tenant_id,source_id) references public.receptionist_voicemail_sources(tenant_id,id),
  check ((state='reserved')=(reservation_id is not null and reserved_until is not null)),
  check (state<>'posted' or (target='urgent_slack' and nullif(provider_reference,'') is not null)),
  check (state<>'submitted' or (target in ('rob_email','tony_email') and nullif(provider_reference,'') is not null))
);
create index receptionist_emergency_603_prepared_idx
  on public.receptionist_emergency_603_outbox(tenant_id,created_at,delivery_id)
  where state='prepared';

alter table public.receptionist_emergency_603_delivery_config enable row level security;
alter table public.receptionist_emergency_603_outbox enable row level security;
revoke all on public.receptionist_emergency_603_delivery_config, public.receptionist_emergency_603_outbox from public,anon,authenticated;
grant select on public.receptionist_emergency_603_delivery_config, public.receptionist_emergency_603_outbox to service_role;
grant update on public.receptionist_emergency_603_delivery_config to service_role;
grant insert,update on public.receptionist_emergency_603_outbox to service_role;

create function public.emma_603_outbox_immutable() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op='DELETE' then raise exception 'emma_603_immutable' using errcode='22023';end if;
  if (to_jsonb(new)-array['state','reservation_id','reserved_until','provider_reference','settled_at'])
    <> (to_jsonb(old)-array['state','reservation_id','reserved_until','provider_reference','settled_at']) then
    raise exception 'emma_603_immutable' using errcode='22023';end if;
  return new;
end $$;
create trigger emma_603_outbox_immutable before update or delete
  on public.receptionist_emergency_603_outbox for each row execute function public.emma_603_outbox_immutable();

-- Match the candidate receiver's SHA-256 UUID exactly. Fixed version/variant
-- bits are intentional; the recipient or channel is part of the input.
create function public.emma_603_delivery_id(p_tenant uuid,p_source uuid,p_message uuid,p_destination text)
returns uuid language sql immutable strict set search_path=pg_catalog as $$
  with h as (select encode(extensions.digest(
    p_tenant::text||E'\n'||p_source::text||E'\n'||p_message::text||E'\n'||p_destination,'sha256'),'hex') as v)
  select (substr(v,1,8)||'-'||substr(v,9,4)||'-5'||substr(v,14,3)||'-a'||substr(v,18,3)||'-'||substr(v,21,12))::uuid from h;
$$;
revoke all on function public.emma_603_delivery_id(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.emma_603_delivery_id(uuid,uuid,uuid,text) to service_role;

-- The trusted server must first authenticate provider records and run
-- assessEmergency603DepositProof. This RPC independently checks the frozen
-- proof fields against the immutable published source, then inserts all three
-- rows in one transaction. A service-role caller remains a trust boundary.
create function public.emma_603_prepare(p_tenant uuid,p_source uuid,p_core jsonb,p_channel text)
returns table(delivery_id uuid,target text,destination text,state text)
language plpgsql security invoker set search_path=pg_catalog as $$
declare
  c public.receptionist_emergency_603_delivery_config%rowtype;
  s public.receptionist_voicemail_sources%rowtype;
  i public.receptionist_voicemail_intakes%rowtype;
  r public.receptionist_voicemail_email_routes%rowtype;
  m public.receptionist_mailboxes%rowtype;
  ident jsonb;binding jsonb;attempt jsonb;deposit jsonb;
  selected text;binding_at timestamptz;attempt_at timestamptz;deposit_at timestamptz;
  proof_hash text;destination_value text;target_value text;identifier uuid;
  existing public.receptionist_emergency_603_outbox%rowtype;
begin
  if current_user<>'service_role' then raise exception 'emma_603_forbidden' using errcode='42501';end if;
  -- Serialize replay and concurrent preparation for this one source.
  perform pg_advisory_xact_lock(hashtextextended('emma-603:'||p_tenant::text||':'||p_source::text,0));
  select * into c from public.receptionist_emergency_603_delivery_config where tenant_id=p_tenant for share;
  if not found or not c.preparation_enabled or c.email_owner<>'openfolk_sender' then
    raise exception 'emma_603_preparation_off' using errcode='55000';end if;
  if c.reviewed_slack_channel is distinct from p_channel then
    raise exception 'emma_603_route_changed' using errcode='22023';end if;
  select * into s from public.receptionist_voicemail_sources where tenant_id=p_tenant and id=p_source;
  if not found then raise exception 'emma_603_source_missing' using errcode='22023';end if;
  select * into i from public.receptionist_voicemail_intakes where tenant_id=p_tenant and id=s.intake_id;
  select * into r from public.receptionist_voicemail_email_routes where tenant_id=p_tenant and id=s.route_id;
  select * into m from public.receptionist_mailboxes where tenant_id=p_tenant and id=i.mailbox_id;
  if i.id is null or r.id is null or m.id is null
    or i.state<>'published' or i.route_id<>s.route_id or r.mailbox_id<>i.mailbox_id
    or m.provider<>'birchills' or m.extension<>'603'
    or i.provider_reference is null or i.audio_bytes<=0 then
    raise exception 'emma_603_source_not_published' using errcode='22023';end if;
  if jsonb_typeof(p_core) is distinct from 'object' or octet_length(p_core::text)>8000 then
    raise exception 'emma_603_proof_invalid' using errcode='22023';end if;
  ident:=p_core->'identity';binding:=p_core->'callBinding';deposit:=p_core->'deposit';
  if jsonb_typeof(p_core->'attempts') is distinct from 'array' or jsonb_array_length(p_core->'attempts')<>1 then
    raise exception 'emma_603_attempt_invalid' using errcode='22023';end if;
  attempt:=p_core->'attempts'->0;
  selected:=case when ident->>'classification'='commercial' then 'rob109'
    when ident->>'classification' in ('domestic','uncertain') then 'tony105' else null end;
  if ident->>'tenantId' is distinct from p_tenant::text
    or nullif(ident->>'vapiCallId','') is null or nullif(ident->>'birchillsCallId','') is null
    or length(ident->>'vapiCallId')>160 or length(ident->>'birchillsCallId')>160
    or selected is null or binding->>'source' is distinct from 'birchills'
    or binding->>'state' is distinct from 'matched'
    or attempt->>'source' is distinct from 'vapi' or attempt->>'outcome' is distinct from 'failed'
    or attempt->>'target' is distinct from selected
    or deposit->>'source' is distinct from 'birchills' or deposit->>'state' is distinct from 'deposited'
    or deposit->>'mailbox' is distinct from '603'
    or deposit->>'mailboxMessageId' is distinct from i.provider_reference::text then
    raise exception 'emma_603_proof_mismatch' using errcode='22023';end if;
  if not (binding->>'occurredAt' ~ '^\d{4}-\d\d-\d\dT'
    and attempt->>'occurredAt' ~ '^\d{4}-\d\d-\d\dT'
    and deposit->>'occurredAt' ~ '^\d{4}-\d\d-\d\dT') then
    raise exception 'emma_603_time_invalid' using errcode='22023';end if;
  binding_at:=(binding->>'occurredAt')::timestamptz;
  attempt_at:=(attempt->>'occurredAt')::timestamptz;
  deposit_at:=(deposit->>'occurredAt')::timestamptz;
  if not (isfinite(binding_at) and binding_at<attempt_at and attempt_at<deposit_at and isfinite(deposit_at)) then
    raise exception 'emma_603_order_invalid' using errcode='22023';end if;
  if not (binding->>'tenantId'=p_tenant::text and attempt->>'tenantId'=p_tenant::text and deposit->>'tenantId'=p_tenant::text
    and binding->>'vapiCallId'=ident->>'vapiCallId' and attempt->>'vapiCallId'=ident->>'vapiCallId' and deposit->>'vapiCallId'=ident->>'vapiCallId'
    and binding->>'birchillsCallId'=ident->>'birchillsCallId' and attempt->>'birchillsCallId'=ident->>'birchillsCallId' and deposit->>'birchillsCallId'=ident->>'birchillsCallId'
    and nullif(binding->>'providerEventId','') is not null and nullif(attempt->>'providerEventId','') is not null and nullif(deposit->>'providerEventId','') is not null
    and length(binding->>'providerEventId')<=160 and length(attempt->>'providerEventId')<=160 and length(deposit->>'providerEventId')<=160
    and binding->>'providerEventId'<>deposit->>'providerEventId') then
    raise exception 'emma_603_correlation_invalid' using errcode='22023';end if;
  proof_hash:=encode(extensions.digest(p_core::text,'sha256'),'hex');
  for target_value,destination_value in
    select x.target,x.destination from (values
      ('rob_email','rob@drummondheating.co.uk'),
      ('tony_email','tony@drummondheating.co.uk'),
      ('urgent_slack',c.reviewed_slack_channel)) x(target,destination)
  loop
    identifier:=public.emma_603_delivery_id(p_tenant,p_source,i.provider_reference,destination_value);
    select * into existing from public.receptionist_emergency_603_outbox o
      where o.tenant_id=p_tenant and o.source_id=p_source and o.target=target_value;
    if found and (existing.delivery_id<>identifier or existing.destination<>destination_value
      or existing.mailbox_message_id<>i.provider_reference or existing.audio_sha256<>i.audio_sha256
      or existing.content_sha256<>i.content_sha256 or existing.source_sha256<>s.raw_sha256
      or existing.proof_sha256<>proof_hash or existing.route_version<>c.route_version
      or existing.email_owner<>c.email_owner) then
      raise exception 'emma_603_replay_conflict' using errcode='22023';end if;
    if not found then
      insert into public.receptionist_emergency_603_outbox
        (delivery_id,tenant_id,source_id,target,destination,mailbox_message_id,audio_sha256,content_sha256,source_sha256,proof_sha256,route_version,email_owner)
      values(identifier,p_tenant,p_source,target_value,destination_value,i.provider_reference,i.audio_sha256,i.content_sha256,s.raw_sha256,proof_hash,c.route_version,c.email_owner);
    end if;
  end loop;
  return query select o.delivery_id,o.target,o.destination,o.state
    from public.receptionist_emergency_603_outbox o where o.tenant_id=p_tenant and o.source_id=p_source
    order by o.target;
end $$;
revoke all on function public.emma_603_prepare(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.emma_603_prepare(uuid,uuid,jsonb,text) to service_role;

-- Once sender ownership and provider bindings have been separately approved,
-- a future worker may reserve a row. Expired reservations become uncertain;
-- they are NEVER automatically returned to prepared for another send.
create function public.emma_603_claim(p_tenant uuid)
returns setof public.receptionist_emergency_603_outbox
language plpgsql security invoker set search_path=pg_catalog as $$
declare picked public.receptionist_emergency_603_outbox%rowtype;
begin
  if current_user<>'service_role' then raise exception 'emma_603_forbidden' using errcode='42501';end if;
  if not exists(select 1 from public.receptionist_emergency_603_delivery_config
    where tenant_id=p_tenant and email_owner='openfolk_sender' and preparation_enabled and sender_enabled) then
    return;end if;
  update public.receptionist_emergency_603_outbox set state='uncertain',reservation_id=null,reserved_until=null,settled_at=clock_timestamp()
    where tenant_id=p_tenant and state='reserved' and reserved_until<clock_timestamp();
  select * into picked from public.receptionist_emergency_603_outbox
    where tenant_id=p_tenant and state='prepared' order by created_at,delivery_id
    for update skip locked limit 1;
  if not found then return;end if;
  update public.receptionist_emergency_603_outbox
    set state='reserved',reservation_id=gen_random_uuid(),reserved_until=clock_timestamp()+interval '2 minutes'
    where delivery_id=picked.delivery_id returning * into picked;
  return next picked;
end $$;
revoke all on function public.emma_603_claim(uuid) from public,anon,authenticated;
grant execute on function public.emma_603_claim(uuid) to service_role;

-- Only a sender holding the current reservation can settle it. Accepted email
-- becomes submitted, never delivered. Slack requires a returned message ts.
create function public.emma_603_settle(p_delivery uuid,p_reservation uuid,p_outcome text,p_provider_reference text)
returns boolean language plpgsql security invoker set search_path=pg_catalog as $$
declare o public.receptionist_emergency_603_outbox%rowtype;
begin
  if current_user<>'service_role' then raise exception 'emma_603_forbidden' using errcode='42501';end if;
  select * into o from public.receptionist_emergency_603_outbox where delivery_id=p_delivery for update;
  if not found or o.state<>'reserved' or o.reservation_id<>p_reservation then return false;end if;
  if p_outcome not in ('submitted','posted','uncertain')
    or (p_outcome='submitted' and o.target='urgent_slack')
    or (p_outcome='posted' and o.target<>'urgent_slack')
    or (p_outcome in ('submitted','posted') and (nullif(p_provider_reference,'') is null or length(p_provider_reference)>160))
    then raise exception 'emma_603_settlement_invalid' using errcode='22023';end if;
  update public.receptionist_emergency_603_outbox
    set state=p_outcome,reservation_id=null,reserved_until=null,
      provider_reference=case when p_outcome='uncertain' then null else p_provider_reference end,
      settled_at=clock_timestamp() where delivery_id=p_delivery;
  return true;
end $$;
revoke all on function public.emma_603_settle(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.emma_603_settle(uuid,uuid,text,text) to service_role;
commit;
