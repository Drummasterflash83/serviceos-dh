-- Read an existing credential only for an owned, approved Slack job. This does
-- not create/rotate/revoke credentials, expose Vault to clients, or call Slack.
begin;
create function public.learn_slack_read_credential(
 p_tenant_id uuid,p_job_id uuid,p_claimed_by text,p_attempt_count integer,
 p_connection_id uuid,p_revision timestamptz,p_secret_id uuid
) returns text language plpgsql security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;a public.connector_accounts%rowtype;cfg jsonb;secret text;begin
 if auth.role() is distinct from 'service_role' then raise exception 'slack_credential_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'slack_credential_snapshot' using errcode='22023';end if;
 select * into j from public.platform_jobs where id=p_job_id and tenant_id=p_tenant_id for update;
 if not found or j.status<>'running' or j.job_type<>'slack.history_sync' or
  p_claimed_by is null or j.claimed_by is distinct from p_claimed_by or
  p_attempt_count is null or j.attempt_count is distinct from p_attempt_count or
  j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp() or j.metadata ? 'slack_page_v1' then return null;end if;
 select * into a from public.connector_accounts where id=(j.payload->>'connector_account_id')::uuid
  and tenant_id=p_tenant_id for share;
 if not found or a.status<>'active' then return null;end if;
 cfg:=a.settings->'slack_history';
 if cfg->'approved' is distinct from 'true'::jsonb or
  coalesce((cfg->>'expiresAt')::timestamptz,'-infinity')<=clock_timestamp() or
  (cfg->>'connectionId')::uuid is distinct from p_connection_id then return null;end if;
 perform 1 from public.tenant_connectors where id=a.tenant_connector_id and tenant_id=p_tenant_id
  and connector_id='slack' and enabled and status='active' for share;
 if not found then return null;end if;
 perform 1 from public.provider_connections where id=p_connection_id and tenant_id=p_tenant_id
  and provider='slack' and status='configured' and revoked_at is null and updated_at=p_revision
  and non_secret_config->>'team_id'=cfg->>'teamId' and 'bot_token'=any(configured_fields)
  and secret_refs->>'bot_token'=p_secret_id::text for share;
 if not found then return null;end if;
 -- Require both the stored reference and the existing broker's tenant-qualified
 -- name. A foreign/mismatched reference or a stale connection resolves nothing.
 select decrypted_secret into secret from vault.decrypted_secrets
  where id=p_secret_id and name='provider_secret:'||p_tenant_id::text||':slack:bot_token';
 if j.lease_expires_at<=clock_timestamp() then return null;end if;
 return secret;
end $$;
revoke all on function public.learn_slack_read_credential(uuid,uuid,text,integer,uuid,timestamptz,uuid)
 from public,anon,authenticated;
grant execute on function public.learn_slack_read_credential(uuid,uuid,text,integer,uuid,timestamptz,uuid) to service_role;
commit;
