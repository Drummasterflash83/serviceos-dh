begin;

-- Candidate-only decisions. No recordings, transcripts, contact details or tokens.
create table public.receptionist_intake_decisions (
  event_key text primary key check (event_key ~ '^[a-f0-9]{64}$'),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  tenant_id uuid not null default '00000000-0000-0000-0000-000000000001'
    check (tenant_id = '00000000-0000-0000-0000-000000000001'),
  candidate_id uuid not null default 'dcfc2e66-a438-43ab-b863-467f5a5089df'
    check (candidate_id = 'dcfc2e66-a438-43ab-b863-467f5a5089df'),
  call_id uuid not null,
  reason text not null check (reason ~ '^[a-z_]{1,64}$'),
  accepted boolean not null,
  response jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.receptionist_intake_decisions enable row level security;
revoke all on public.receptionist_intake_decisions from public, anon, authenticated;
grant all on public.receptionist_intake_decisions to service_role;
create index receptionist_intake_decisions_call_idx on public.receptionist_intake_decisions(call_id, created_at);

-- One atomic, retry-safe decision. No request can choose a tenant/destination.
create function public.receptionist_intake_record(
  p_event_key text, p_payload_hash text, p_call_id uuid,
  p_reason text, p_accepted boolean, p_response jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare old public.receptionist_intake_decisions; result jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service only'; end if;
  if p_event_key !~ '^[a-f0-9]{64}$' or p_payload_hash !~ '^[a-f0-9]{64}$'
    or p_call_id is null or p_reason not in ('accepted','untrusted_binding','wrong_event','call_binding_mismatch',
      'office_not_closed','malformed_parameters','missing_intake','invalid_artifact','fabricated_source_evidence',
      'unusable_location','invalid_callback','unconfirmed_callback','stale_callback','stale_name_or_location','classification_mismatch')
    or p_accepted is null or p_accepted is distinct from (p_reason='accepted') then
    raise exception 'Invalid decision';
  end if;
  -- Global lock also enforces the modest daily cap under concurrent calls.
  perform pg_advisory_xact_lock(hashtextextended('emma_candidate_intake', 0));
  select * into old from public.receptionist_intake_decisions where event_key=p_event_key;
  if found then
    if old.payload_hash is distinct from p_payload_hash or old.call_id is distinct from p_call_id then
      return jsonb_build_object('error','This intake request changed. Do not hand over. Ask only for the missing caller details.');
    end if;
    return old.response;
  end if;
  if (select count(*) from public.receptionist_intake_decisions where created_at >= now()-interval '24 hours') >= 120
    or (select count(*) from public.receptionist_intake_decisions where call_id=p_call_id) >= 10
    or exists(select 1 from public.receptionist_intake_decisions where call_id=p_call_id and accepted) then
    return jsonb_build_object('error','The test intake check cannot continue. Do not repeat the transfer or claim it succeeded. Explain that OpenFolk must review this test.');
  end if;
  -- Do not turn this service-role RPC into a way to store arbitrary caller data.
  if p_accepted then
    result := '{"destination":{"type":"assistant","assistantId":"41bd1fd0-3ebf-4f43-9ded-512cb9305455","contextEngineeringPlan":{"type":"all"}}}'::jsonb;
    if p_response is distinct from result then raise exception 'Unapproved destination'; end if;
  else
    result := jsonb_build_object('error',format('Emergency intake not verified (%s). No handoff or telephone transfer was authorised. Continue with the caller and ask only for missing or corrected intake details. Never delay immediate safety advice. If details cannot be supplied, this needs OpenFolk review; do not invent a transfer or promise dispatch, voicemail or email delivery.',p_reason));
    if p_response is distinct from result then raise exception 'Invalid rejection'; end if;
  end if;
  insert into public.receptionist_intake_decisions(event_key,payload_hash,call_id,reason,accepted,response)
    values(p_event_key,p_payload_hash,p_call_id,p_reason,p_accepted,result);
  return result;
end $$;
revoke all on function public.receptionist_intake_record(text,text,uuid,text,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.receptionist_intake_record(text,text,uuid,text,boolean,jsonb) to service_role;

-- Private deployment snapshot is separate from the original launch baseline.
create table public.receptionist_intake_installation (
  tenant_id uuid primary key check (tenant_id='00000000-0000-0000-0000-000000000001'),
  actor_id uuid not null references auth.users(id),
  candidate_id uuid not null check (candidate_id='dcfc2e66-a438-43ab-b863-467f5a5089df'),
  state text not null check (state in ('prepared','verified','review_required')),
  before_candidate jsonb not null,
  before_handoff jsonb not null,
  candidate_hash text not null,
  handoff_hash text not null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.receptionist_intake_installation enable row level security;
revoke all on public.receptionist_intake_installation from public,anon,authenticated;
grant all on public.receptionist_intake_installation to service_role;
commit;
