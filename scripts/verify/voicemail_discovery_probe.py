"""Synthetic retained-email enumeration against real discovery and queue DDL."""
import json, uuid, concurrent.futures

def verify_discovery(sql, denied, file):
 def ident(n): return 'ce440000-aaaa-4000-8000-'+str(n).zfill(12)
 def lit(s): return "'"+str(s).replace("'","''")+"'"
 tenant,route,account,mailbox,actor=[ident(n) for n in range(1,6)]
 sql('''create table public.email_messages(id uuid primary key,tenant_id uuid,provider text,provider_message_id text,
 from_email text,subject text,received_at timestamptz,raw_payload jsonb);
 grant select on public.email_messages to service_role;''')
 migration=file('supabase/migrations/20261101440000_learn_voicemail_discovery.sql')
 sql(migration.replace('\ncommit;','\nrollback;'))
 assert sql("select to_regclass('receptionist_voicemail_scans') is null")=='t'
 sql(migration)
 sql(f"""insert into tenants(id) values('{tenant}');insert into auth.users(id) values('{actor}');
 insert into email_accounts values('{account}','{tenant}','synthetic@example.invalid','gmail','active_dwd');
 insert into receptionist_mailboxes(id,tenant_id,provider_mailbox_id,display_name,extension,owner_user_id)
 values('{mailbox}','{tenant}','discovery-synthetic','Synthetic discovery','601','{actor}');
 insert into receptionist_voicemail_email_routes(id,tenant_id,mailbox_id,email_account_id,recipient_email,signing_domain,owner_user_id,access_mode,received_from,received_until,binding_evidence,verified_by,enabled)
 values('{route}','{tenant}','{mailbox}','{account}','synthetic@example.invalid','birchills-net.20251104.gappssmtp.com','{actor}','owner','2026-10-01','2026-11-01','Synthetic discovery fixture','{actor}',true);""")
 def statement(request=None, r=route, t=tenant):
  return f"set role service_role;select voicemail_discover_page('{t}','{r}','{request or uuid.uuid4()}');"
 def page(request=None): return json.loads(sql(statement(request)))
 def status(): return json.loads(sql(f"set role service_role;select voicemail_discovery_status('{tenant}','{route}');"))
 def restart(): sql(f"update receptionist_voicemail_scans set next_scan_at=clock_timestamp()-interval '1 second' where route_id='{route}';")
 def add(n, **kw):
  raw={'provider_account_id':account,'label_ids':['INBOX'],'provider_availability':'available'}
  raw.update(kw.pop('raw',{}))
  fields={'id':ident(n),'tenant_id':tenant,'provider':'gmail','provider_message_id':hex(n)[2:],'from_email':'synthetic@birchills.net',
   'subject':'New message in mailbox 601 from synthetic','received_at':'2026-10-11 08:00:00+00','raw_payload':json.dumps(raw)}
  fields.update(kw)
  vals=','.join('null' if v is None else lit(v) for v in fields.values())
  sql('insert into email_messages('+','.join(fields)+') values('+vals+');')
 denied(statement(t=ident(9)),'voicemail_route_unverified')
 denied(statement().replace('set role service_role','set role authenticated'),'permission denied')
 denied('set role authenticated;select * from receptionist_voicemail_candidates;','permission denied')
 assert status()['generation'] is None and status()['coverage_complete'] is False
 # More than one page, including known templates, irrelevant sources, legacy and drafts.
 for n in range(100,203): add(n,subject='ordinary email')
 add(10);add(11,raw={'provider_account_id':None});add(12,raw={'label_ids':['DRAFT']})
 add(13,received_at=None);add(14,raw={'provider_availability':'unavailable'});add(15,received_at='2026-10-11 08:00:00.0001+00')
 add(16,raw={'provider_account_id':ident(900)});add(17,received_at='2026-11-01');add(18,from_email='synthetic@evil.invalid')
 add(19,subject='New message in mailbox 602 from synthetic')
 add(20,provider_message_id='invalid-id')
 req=str(uuid.uuid4())
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: both=list(pool.map(lambda _:page(req),range(2)))
 assert both[0]==both[1] and both[0]['rows_examined']==100 and both[0]['state']=='scanning'
 assert both[0]['jobs_enqueued']==1 and both[0]['needs_review']==5 and both[0]['excluded']==1,both
 denied(statement(req,r=ident(9)),'voicemail_discovery_request_conflict')
 second=page();assert second['state']=='retained_pass_complete' and second['pass_rows_examined']==114,second
 summary=status();assert summary['candidates']==7 and summary['jobs']=={'queued':1},summary
 assert summary['coverage_complete'] is False
 assert page()['state']=='waiting'
 assert sql(f"select payload->>'internalDate' from platform_jobs where tenant_id='{tenant}'")=='1791705600000'
 # Job remains immutable across rescans, even after settlement/dead-letter.
 sql(f"update platform_jobs set status='dead_letter' where tenant_id='{tenant}';")
 restart();page();page();assert status()['jobs']=={'dead_letter':1}
 # A newly verified legacy binding and label correction are picked up on a new pass.
 sql(f"update email_messages set raw_payload=jsonb_set(raw_payload,'{{provider_account_id}}',to_jsonb('{account}'::text)) where id='{ident(11)}';")
 sql(f"update email_messages set raw_payload=jsonb_set(raw_payload,'{{label_ids}}','[]') where id='{ident(12)}';")
 # Insert with an id behind the cursor; next pass still sees it.
 add(9)
 restart();first=page();page();assert first['jobs_enqueued']==3 and status()['jobs']=={'queued':3,'dead_letter':1}
 # Disable/capture controls reject before advancing, while old receipts are readable.
 before=sql(f"select row_to_json(s) from receptionist_voicemail_scans s where route_id='{route}'")
 sql(f"update receptionist_voicemail_email_routes set enabled=false where id='{route}';")
 denied(statement(),'voicemail_route_unverified');assert page(req)==both[0]
 sql(f"update receptionist_voicemail_email_routes set enabled=true where id='{route}';insert into feature_flags values('{tenant}','learn.inputs.phone.enabled','false');")
 denied(statement(),'voicemail_capture_paused')
 assert before==sql(f"select row_to_json(s) from receptionist_voicemail_scans s where route_id='{route}'")
 sql(f"delete from feature_flags where tenant_id='{tenant}';")
 # Overlapping enabled routes are review-only, rather than double assignment.
 sql(f"insert into receptionist_voicemail_email_routes select '{ident(6)}',tenant_id,mailbox_id,email_account_id,recipient_email,signing_domain,owner_user_id,access_mode,received_from,received_until,binding_evidence,verified_by,verified_at,enabled from receptionist_voicemail_email_routes where id='{route}';")
 add(21);restart();page();page()
 assert sql(f"select code from receptionist_voicemail_candidates where route_id='{route}' and email_message_id='{ident(21)}'")=='voicemail_route_ambiguous'
 assert status()['jobs']=={'queued':3,'dead_letter':1}
 sql(f"update receptionist_voicemail_email_routes set enabled=false where id='{ident(6)}';")
 restart();assert page()['jobs_enqueued']==1;page()
 # Exact request receipts and queue/cursor writes roll back together on failure.
 add(22);restart()
 sql("""create function fail_discovery_probe() returns trigger language plpgsql as $$begin raise exception 'synthetic_discovery_rollback';end$$;
 create trigger fail_discovery_probe before insert on receptionist_voicemail_scan_receipts for each row execute function fail_discovery_probe();""")
 before=sql(f"select row_to_json(s) from receptionist_voicemail_scans s where route_id='{route}'")
 count=sql(f"select count(*) from platform_jobs where tenant_id='{tenant}'")
 retry=str(uuid.uuid4());denied(statement(retry),'synthetic_discovery_rollback')
 assert count==sql(f"select count(*) from platform_jobs where tenant_id='{tenant}'")
 assert before==sql(f"select row_to_json(s) from receptionist_voicemail_scans s where route_id='{route}'")
 sql('drop trigger fail_discovery_probe on receptionist_voicemail_scan_receipts;drop function fail_discovery_probe();')
 assert page(retry)['jobs_enqueued']==1;page()
 # A replacement route cannot silently reassign a retained source already queued.
 sql(f"update receptionist_voicemail_email_routes set enabled=(id='{ident(6)}') where tenant_id='{tenant}';")
 replacement=json.loads(sql(statement(r=ident(6))))
 assert replacement['jobs_enqueued']==0
 assert sql(f"select code from receptionist_voicemail_candidates where route_id='{ident(6)}' and email_message_id='{ident(10)}'")=='voicemail_source_previously_routed'
 # Signed-in roles cannot inspect even aggregate private mailbox discovery.
 denied(f"set role authenticated;select voicemail_discovery_status('{tenant}','{route}');",'permission denied')
 denied('update receptionist_voicemail_scan_receipts set receipt=receipt;','voicemail_job_evidence_immutable')
 print('PASS: discovery rollback, bounded multi-page scan, concurrent lost-reply replay, exact source identity, legacy review, draft exclusion, unavailable/time/ID review, source/tenant filtering, pause, rescan corrections, late inserts, no dead-letter loop, ambiguous routes, atomic enqueue/cursor/receipt and private aggregates')
