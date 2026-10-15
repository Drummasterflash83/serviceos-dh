-- Make the already authorised job-review search find the latest retained
-- Commusoft open/ongoing, pending and on-hold source statuses before pagination.
-- This changes only a private immutable matcher. It does not project identities,
-- confirm job completion, call Commusoft, change review authority or alter rows.
begin;
do $$
declare
  definition text;
  old_predicate text := $old$select coalesce(query='' or p_external=query or
  (case when p_kind='site' then p_payload->>'parentPropertyID' when p_kind in ('job','contact') then p_payload->>'propertyID' end)=query or
  strpos(lower(value),query)>0,false) from term,fields;$old$;
  new_predicate text := $new$select coalesce(
  case when p_kind='job' and query='status:open-work' then
    p_payload->>'status' in ('Open','ongoing','pending','on_hold')
  else query='' or p_external=query or
    (case when p_kind='site' then p_payload->>'parentPropertyID' when p_kind in ('job','contact') then p_payload->>'propertyID' end)=query or
    strpos(lower(value),query)>0 end,
  false) from term,fields;$new$;
begin
  definition := pg_get_functiondef('public.learn_commusoft_source_matches(jsonb,text,text,text)'::regprocedure);
  if md5(definition)='c19b0bd500f741aa48c838da2a5a669e' then
    -- The guarded hosted release can precede migration-ledger replay.
    return;
  end if;
  if md5(definition)<>'a40af8f72b2c0fe802a0ec739ac7133b'
    or position(old_predicate in definition)=0
    or length(definition)-length(replace(definition,old_predicate,''))<>length(old_predicate) then
    raise exception 'Commusoft source matcher differs from reviewed TEST/LIVE baseline';
  end if;
  execute replace(definition,old_predicate,new_predicate);
end $$;
commit;
