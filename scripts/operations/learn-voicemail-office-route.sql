-- Reviewed Drummonds shared-office historical voicemail route; no permission grants.
-- Caller owns BEGIN/COMMIT (or ROLLBACK for an offline rehearsal).
-- Set serviceos.voicemail_action to enable or pause, and the approved project/run.
do $route$
declare
 t constant uuid := '00000000-0000-0000-0000-000000000001';
 rid constant uuid := 'ce601013-aaaa-4000-8000-000000000001';
 mid constant uuid := '92ce776b-20eb-4ac2-bca6-17ba130697cb';
 aid constant uuid := '75c07707-6caa-4d12-8245-16886f36209e';
 actor constant uuid := 'ec84daae-b135-4547-a1de-794bfcd3fbf2';
 op text := current_setting('serviceos.voicemail_action',true);
 changed integer;
begin
 if current_setting('serviceos.voicemail_project',true) is distinct from 'tgbnakbxwcqjeimygroz'
 or current_setting('serviceos.voicemail_run',true) is distinct from 'office-601-history-20261013'
 or op is null or op not in ('enable','pause') then raise exception 'Reviewed voicemail scope required';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-input-setup:'||t::text,0));
 if op='pause' then
  update public.receptionist_voicemail_email_routes set enabled=false
  where id=rid and tenant_id=t and mailbox_id=mid and email_account_id=aid;
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'Exact voicemail route missing';end if;
  return;
 end if;
 if exists(select 1 from public.receptionist_voicemail_email_routes where tenant_id=t)
 or not public.learn_capture_allowed(t,'phone') or not public.learn_capture_allowed(t,'email')
 then raise exception 'Voicemail capture baseline differs';end if;
 perform 1 from public.receptionist_mailboxes where id=mid and tenant_id=t and provider='birchills'
 and extension='601' and owner_user_id is null for share;
 if not found then raise exception 'Shared-office mailbox differs';end if;
 perform 1 from public.email_accounts where id=aid and tenant_id=t and provider='gmail'
 and email_address='office@drummondheating.co.uk' and status='active_dwd' for share;
 if not found then raise exception 'Existing Workspace account differs';end if;
 if (select array_agg(user_id::text order by user_id::text) from public.receptionist_mailbox_managers where tenant_id=t and mailbox_id=mid)
 is distinct from array['3c029f57-dbf9-4484-a803-896e721373c9','ec84daae-b135-4547-a1de-794bfcd3fbf2']
 then raise exception 'Existing private mailbox managers differ';end if;
 if not exists(select 1 from auth.users where id=actor and email='chris@openfolk.ai')
 or (select count(*) from storage.buckets where id in ('receptionist-voicemails','learn-voicemail-sources') and not public)<>2
 then raise exception 'Actor or private storage differs';end if;
 insert into public.receptionist_voicemail_email_routes(id,tenant_id,mailbox_id,email_account_id,recipient_email,signing_domain,
 owner_user_id,access_mode,received_from,received_until,binding_evidence,verified_by,enabled)
 values(rid,t,mid,aid,'office@drummondheating.co.uk','birchills-net.20251104.gappssmtp.com',null,'managers_only',
 '2026-07-19T00:00:00Z','2026-10-09T00:00:00Z',
 'Owner-approved office-601-history-20261013. Existing Birchills mailbox 601; signed provider notification to the existing Office Workspace account. No owner inferred; retain existing Chris/Heidi manager access. Historical window only; pause after verification.',actor,true);
end $route$;
