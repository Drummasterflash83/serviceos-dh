-- An exact held-page retry can outlive its 24-hour account slice while the
-- previously approved fixed-window campaign remains active. Renew only that
-- account slice, capped at the original campaign expiry; preserve the source
-- window, current import, cursor, page budget and consent reference.
begin;
do $$
declare
  definition text;
  old_guard text := 'or (a.settings->''slack_history''->>''expiresAt'')::timestamptz<=clock_timestamp()';
  new_guard text := 'or h.expires_at<=clock_timestamp()';
  insertion text := '  insert into public.platform_jobs(id,tenant_id,connector_id,job_type,job_key,status,max_attempts,available_at,payload,created_by,created_at)';
  renewal text := $renew$
  if (a.settings->'slack_history'->>'expiresAt')::timestamptz<=clock_timestamp() then
   update public.connector_accounts
      set settings=jsonb_set(settings,'{slack_history,expiresAt}',to_jsonb(least(h.expires_at,clock_timestamp()+interval '24 hours')),false)
    where id=a.id and tenant_id=p_tenant;
  end if;
$renew$;
begin
  definition := pg_get_functiondef('public.learn_slack_campaign_recover_page(uuid,uuid,jsonb,text)'::regprocedure);
  if length(definition)-length(replace(definition,old_guard,''))<>length(old_guard)
     or length(definition)-length(replace(definition,insertion,''))<>length(insertion)
     or position('if (a.settings->''slack_history''->>''expiresAt'')::timestamptz<=clock_timestamp() then' in definition)>0
  then raise exception 'Slack exact recovery baseline differs'; end if;
  execute replace(replace(definition,old_guard,new_guard),insertion,renewal||insertion);
end$$;
commit;
