-- Drummonds historical voicemail expansion approved by Chris, 13 October 2026.
-- Exact existing recipients; existing managers-only visibility; no owner inference.
-- Caller owns the transaction. This script creates no users, grants or schedules.
do $routes$
declare
 t constant uuid := '00000000-0000-0000-0000-000000000001';
 actor constant uuid := 'ec84daae-b135-4547-a1de-794bfcd3fbf2';
 op text := current_setting('serviceos.voicemail_action',true);
 item record;
 existing public.receptionist_voicemail_email_routes%rowtype;
 changed integer;
begin
 if current_setting('serviceos.voicemail_project',true) is distinct from 'tgbnakbxwcqjeimygroz'
 or current_setting('serviceos.voicemail_run',true) is distinct from 'additional-history-20261013'
 or op is null or op not in ('enable','pause') then raise exception 'Reviewed voicemail scope required';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-input-setup:'||t::text,0));
 if op='enable' and (not public.learn_capture_allowed(t,'phone') or not public.learn_capture_allowed(t,'email'))
 then raise exception 'Voicemail capture baseline differs';end if;
 if op='enable' and (not exists(select 1 from auth.users where id=actor and email='chris@openfolk.ai')
 or (select count(*) from storage.buckets where id in ('receptionist-voicemails','learn-voicemail-sources') and not public)<>2)
 then raise exception 'Actor or private storage differs';end if;
 for item in select * from (values
 ('ce102013-aaaa-4000-8000-000000000001'::uuid,'2fe5541f-14f8-4a1f-8f04-4ee6cd0b095d'::uuid,'102','b0550415-3544-4efc-854e-98429cbbdb7f'::uuid,'liz@drummondheating.co.uk','2026-07-28T00:00:00Z'::timestamptz,'2026-10-07T00:00:00Z'::timestamptz),
 ('ce102013-aaaa-4000-8000-000000000002'::uuid,'2fe5541f-14f8-4a1f-8f04-4ee6cd0b095d'::uuid,'102','70e5dc4b-6b03-42d2-a3a6-325720008381'::uuid,'anna@drummondheating.co.uk','2026-06-30T00:00:00Z'::timestamptz,'2026-07-02T00:00:00Z'::timestamptz),
 ('ce103013-aaaa-4000-8000-000000000001'::uuid,'09fdb14e-bc54-451a-9af2-5ef1a58be397'::uuid,'103','75c07707-6caa-4d12-8245-16886f36209e'::uuid,'office@drummondheating.co.uk','2026-05-21T00:00:00Z'::timestamptz,'2026-10-02T00:00:00Z'::timestamptz),
 ('ce105013-aaaa-4000-8000-000000000001'::uuid,'6bf01480-f2c5-4b72-b9d1-c13ff7eef62a'::uuid,'105','845085ff-389c-42ce-b633-2b61cddcda87'::uuid,'tony@drummondheating.co.uk','2026-07-27T00:00:00Z'::timestamptz,'2026-10-01T00:00:00Z'::timestamptz)
 ) as scope(id,mailbox,extension,account,recipient,from_at,until_at)
 loop
  select * into existing from public.receptionist_voicemail_email_routes where id=item.id;
  if found and (existing.tenant_id<>t or existing.mailbox_id<>item.mailbox or existing.email_account_id<>item.account
   or existing.recipient_email<>item.recipient or existing.signing_domain<>'birchills-net.20251104.gappssmtp.com'
   or existing.owner_user_id is not null or existing.access_mode<>'managers_only'
   or existing.received_from<>item.from_at or existing.received_until is distinct from item.until_at
   or existing.verified_by<>actor) then raise exception 'Existing historical route differs';end if;
  if op='pause' then
   update public.receptionist_voicemail_email_routes set enabled=false where id=item.id and tenant_id=t;
   get diagnostics changed=row_count;
   if changed<>1 then raise exception 'Exact historical route missing';end if;
   continue;
  end if;
  perform 1 from public.receptionist_mailboxes where id=item.mailbox and tenant_id=t and provider='birchills'
   and extension=item.extension and owner_user_id is null for share;
  if not found then raise exception 'Existing voicemail mailbox differs';end if;
  perform 1 from public.email_accounts where id=item.account and tenant_id=t and provider='gmail'
   and email_address=item.recipient and status='active_dwd' for share;
  if not found then raise exception 'Existing Workspace account differs';end if;
  if (select array_agg(user_id::text order by user_id::text) from public.receptionist_mailbox_managers where tenant_id=t and mailbox_id=item.mailbox)
   is distinct from array['3c029f57-dbf9-4484-a803-896e721373c9','ec84daae-b135-4547-a1de-794bfcd3fbf2']
  then raise exception 'Existing private mailbox managers differ';end if;
  if exists(select 1 from public.receptionist_voicemail_email_routes r where r.tenant_id=t and r.mailbox_id=item.mailbox
   and r.email_account_id=item.account and r.id<>item.id
   and r.received_from<item.until_at and (r.received_until is null or r.received_until>item.from_at))
  then raise exception 'Overlapping historical route requires review';end if;
  if existing.id is not null then
   update public.receptionist_voicemail_email_routes set enabled=true where id=item.id;
  else
   insert into public.receptionist_voicemail_email_routes(id,tenant_id,mailbox_id,email_account_id,recipient_email,signing_domain,
    owner_user_id,access_mode,received_from,received_until,binding_evidence,verified_by,enabled)
   values(item.id,t,item.mailbox,item.account,item.recipient,'birchills-net.20251104.gappssmtp.com',null,'managers_only',item.from_at,item.until_at,
    'Chris authorised all voicemail intake on 13 October 2026. Authenticated Gmail profile and exact message metadata match the existing recipient and retained receipt. Signed original and audio are verified by the importer. Preserve existing Chris/Heidi managers; do not infer historical owners. Fixed historical window; pause after this run.',actor,true);
  end if;
 end loop;
end $routes$;
