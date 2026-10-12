-- Credential access for owned Microsoft queue jobs. Reuses the private OAuth
-- table; adds no credentials, consent, account, schedule, or capture activation.
-- A future trusted consent callback must verify identity before writing the
-- learnMicrosoft association. Unbound legacy token rows fail closed.
begin;
create function public.learn_microsoft_credential_read(
 p_tenant uuid,p_account uuid,p_mailbox uuid,p_binding uuid,p_kind text,p_folder text,
 p_job uuid,p_worker text,p_claim integer,p_client uuid
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare b public.learn_microsoft_mailbox_bindings%rowtype; t public.email_oauth_tokens%rowtype;
begin
 if current_setting('role',true) is distinct from 'service_role' then
  raise exception 'learn_microsoft_credential_forbidden' using errcode='42501';end if;
 perform public.learn_microsoft_journal_guard(p_tenant,p_account,p_mailbox,p_binding,p_kind,p_folder,p_job,p_worker,p_claim);
 select * into strict b from public.learn_microsoft_mailbox_bindings where id=p_binding and tenant_id=p_tenant;
 select * into t from public.email_oauth_tokens where tenant_id=p_tenant and email_account_id=p_account and provider='microsoft_365' for share;
 if not found or p_client is null or t.raw_payload->'learnMicrosoft' is distinct from
  jsonb_build_object('contract','microsoft-delegated-credential/1','microsoftTenantId',b.microsoft_tenant_id,
   'mailboxId',b.mailbox_id,'bindingId',b.id,'clientId',p_client)
 then raise exception 'learn_microsoft_credential_unbound' using errcode='PT409';end if;
 -- A long lock wait must not allow an expired claim to acquire credentials.
 perform public.learn_microsoft_journal_guard(p_tenant,p_account,p_mailbox,p_binding,p_kind,p_folder,p_job,p_worker,p_claim);
 return jsonb_build_object('contract','microsoft-credential/1','tenantId',p_tenant,'accountId',p_account,
  'mailboxId',b.mailbox_id,'bindingId',b.id,'microsoftTenantId',b.microsoft_tenant_id,'clientId',p_client,
  'tokenId',t.id,'updatedAt',t.updated_at,'accessToken',t.access_token,'refreshToken',t.refresh_token,
  'expiresAt',t.expires_at,'scope',t.scope,'tokenType',t.token_type);
end $$;

create function public.learn_microsoft_credential_refresh(
 p_tenant uuid,p_account uuid,p_mailbox uuid,p_binding uuid,p_kind text,p_folder text,
 p_job uuid,p_worker text,p_claim integer,p_client uuid,p_token uuid,p_updated_at timestamptz,
 p_old_refresh text,p_access text,p_refresh text,p_expires timestamptz,p_scope text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare t public.email_oauth_tokens%rowtype; proof jsonb;
begin
 if current_setting('role',true) is distinct from 'service_role' then
  raise exception 'learn_microsoft_credential_forbidden' using errcode='42501';end if;
 -- Lock consistently: capture switch, job, account, binding, then credential.
 perform public.learn_microsoft_journal_guard(p_tenant,p_account,p_mailbox,p_binding,p_kind,p_folder,p_job,p_worker,p_claim);
 select * into t from public.email_oauth_tokens where tenant_id=p_tenant and email_account_id=p_account and provider='microsoft_365' for update;
 if not found then raise exception 'learn_microsoft_credential_unbound' using errcode='PT409';end if;
 proof:=public.learn_microsoft_credential_read(p_tenant,p_account,p_mailbox,p_binding,p_kind,p_folder,p_job,p_worker,p_claim,p_client);
 if p_token is null or p_updated_at is null or p_old_refresh is null or
    t.id is distinct from p_token or t.updated_at is distinct from p_updated_at or t.refresh_token is distinct from p_old_refresh then
  return jsonb_build_object('contract','microsoft-credential-refresh/1','state','changed');end if;
 if p_access is null or octet_length(p_access) not between 1 and 32768 or p_access~'[[:space:][:cntrl:]]'
  or p_refresh is null or octet_length(p_refresh) not between 1 and 32768 or p_refresh~'[[:space:][:cntrl:]]'
  or p_expires is null or p_expires<=clock_timestamp()+interval '120 seconds' or p_expires>clock_timestamp()+interval '1 day'
  or p_scope is null or octet_length(p_scope)>4096 or not
   (regexp_split_to_array(lower(p_scope),'\s+') && array['mail.read','https://graph.microsoft.com/mail.read'])
 then raise exception 'learn_microsoft_credential_invalid' using errcode='22023';end if;
 update public.email_oauth_tokens set access_token=p_access,refresh_token=p_refresh,expires_at=p_expires,
  scope=p_scope,token_type='Bearer',updated_at=clock_timestamp() where id=t.id;
 perform public.learn_microsoft_journal_guard(p_tenant,p_account,p_mailbox,p_binding,p_kind,p_folder,p_job,p_worker,p_claim);
 return jsonb_build_object('contract','microsoft-credential-refresh/1','state','saved');
end $$;
revoke all on function public.learn_microsoft_credential_read(uuid,uuid,uuid,uuid,text,text,uuid,text,integer,uuid) from public,anon,authenticated;
revoke all on function public.learn_microsoft_credential_refresh(uuid,uuid,uuid,uuid,text,text,uuid,text,integer,uuid,uuid,timestamptz,text,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.learn_microsoft_credential_read(uuid,uuid,uuid,uuid,text,text,uuid,text,integer,uuid) to service_role;
grant execute on function public.learn_microsoft_credential_refresh(uuid,uuid,uuid,uuid,text,text,uuid,text,integer,uuid,uuid,timestamptz,text,text,text,timestamptz,text) to service_role;
commit;
