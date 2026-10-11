"""Actual dispatch and operator authority functions in the offline fixture only."""
import json,concurrent.futures

def verify_dispatch(sql,denied,file):
 def ident(n):return 'ce440000-aaaa-4000-8000-'+str(n).zfill(12)
 tenant,route,account,mailbox,actor=[ident(n) for n in range(1,6)]
 # Load the actual grant model and operator admission helper over minimal tables.
 sql("""create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
 create table profiles(id uuid primary key,tenant_id uuid,role text);
 create table authority_permissions(permission text primary key);
 insert into authority_permissions values('platform.controlplane.view'),('platform.controlplane.admin');
 create table view_as_context(actor_user_id uuid,expires_at timestamptz,ended_at timestamptz);""")
 authority=file('supabase/migrations/20260821120000_openfolk_control_plane.sql')
 sql(authority[authority.index('create table if not exists platform_authority_grants ('):authority.index('-- OpenFolk-operator resolver')])
 resolver=file('supabase/migrations/20260822120000_platform_authority_decoupled_from_role.sql')
 sql(resolver[resolver.index('create or replace function current_user_is_openfolk_operator('):resolver.index('-- ── Governed record')])
 access=file('supabase/migrations/20261031160000_learn_operator_inputs.sql')
 sql(access[access.index('create function public.learn_operator_input_access('):access.index('-- Explicit booleans only.')])
 migration=file('supabase/migrations/20261101450000_learn_voicemail_dispatch.sql')
 sql(migration.replace('\ncommit;','\nrollback;'))
 assert sql("select to_regclass('receptionist_voicemail_dispatch_receipts') is null and not exists(select 1 from information_schema.columns where table_name='receptionist_voicemail_scans' and column_name='dispatch_code')")=='t'
 sql(migration)
 denied('set role authenticated;select voicemail_schedule_tick();','permission denied')
 denied(f"set role authenticated;select voicemail_discovery_status_data('{tenant}','{route}');",'permission denied')
 # No configured routes -> no write heartbeat and no claims of coverage.
 sql('update receptionist_voicemail_email_routes set enabled=false;')
 def tick():return json.loads(sql('set role service_role;select voicemail_schedule_tick();'))
 assert tick()['state']=='idle'
 assert sql('select count(*) from receptionist_voicemail_dispatch_receipts')=='0'
 # Give one valid route over 1,000 retained rows; a second route has a disabled
 # mailbox account; a third must wait for the bounded, fair next tick.
 sql(f"update receptionist_voicemail_email_routes set enabled=true where id='{route}';update receptionist_voicemail_scans set next_scan_at=null,last_id=null,completed_at=null,rows_examined=0,pages=0 where route_id='{route}';")
 sql(f"insert into email_accounts values('{ident(30)}','{tenant}','disabled@example.invalid','gmail','disabled');")
 sql(f"insert into receptionist_voicemail_email_routes(id,tenant_id,mailbox_id,email_account_id,recipient_email,signing_domain,owner_user_id,access_mode,received_from,received_until,binding_evidence,verified_by,enabled) select '{ident(7)}',tenant_id,mailbox_id,'{ident(30)}','disabled@example.invalid',signing_domain,owner_user_id,access_mode,received_from,received_until,'Synthetic disabled account',verified_by,true from receptionist_voicemail_email_routes where id='{route}';")
 sql(f"update receptionist_voicemail_email_routes set enabled=true where id='{ident(6)}';")
 # Route 6 must be valid but the overlap affects candidates only, not ordinary rows.
 sql(f"insert into email_messages(id,tenant_id,provider,provider_message_id,subject) select ('ce440001-aaaa-4000-8000-'||lpad(n::text,12,'0'))::uuid,'{tenant}','gmail',to_hex(n),'ordinary email' from generate_series(1,1100)n;")
 # Force the disabled account route to be considered ahead of the overlapping one.
 sql(f"update receptionist_voicemail_scans set last_dispatch_at=clock_timestamp(),dispatch_next_at=clock_timestamp()+interval '1 day' where route_id='{ident(6)}';")
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda _:tick(),range(2)))
 fresh=[r for r in results if r['state']!='busy' and r['historical_receipt'] is False]
 assert len(fresh)==1,results
 r=fresh[0];assert r['state']=='attention' and r['routes_attempted']==2 and r['routes_failed']==1 and r['pages']==5 and r['rows_examined']==500,r
 again=tick();assert again['historical_receipt'] is True
 assert {k:v for k,v in again.items() if k!='historical_receipt'}=={k:v for k,v in r.items() if k!='historical_receipt'}
 assert sql(f"select dispatch_code from receptionist_voicemail_scans where route_id='{ident(7)}'")=='voicemail_route_unverified'
 assert sql(f"select rows_examined from receptionist_voicemail_scans where route_id='{route}'")=='500'
 denied('set role service_role;truncate receptionist_voicemail_dispatch_receipts;','permission denied')
 denied('update receptionist_voicemail_dispatch_receipts set receipt=receipt;','voicemail_job_evidence_immutable')
 # Offline fixture clock advance: clear the minute receipt as postgres, not as
 # the service. This does not assert wall-clock cron delivery or deployed timing.
 sql('truncate receptionist_voicemail_dispatch_receipts,receptionist_voicemail_scan_receipts;')
 sql(f"update receptionist_voicemail_scans set dispatch_next_at=null,last_dispatch_at=null where route_id='{ident(6)}';")
 before_second=int(sql(f"select rows_examined from receptionist_voicemail_scans where route_id='{ident(6)}'"))
 second=tick();assert second['routes_attempted']==1 and second['rows_examined']==500,second
 assert int(sql(f"select rows_examined from receptionist_voicemail_scans where route_id='{ident(6)}'"))==before_second+500
 # A receipt failure rolls back the whole tick, including scan attempts.
 sql('truncate receptionist_voicemail_dispatch_receipts,receptionist_voicemail_scan_receipts;')
 sql(f"update receptionist_voicemail_scans set dispatch_next_at=null where route_id='{route}';")
 before=sql("select jsonb_agg(to_jsonb(s) order by route_id) from receptionist_voicemail_scans s")
 sql("""create function dispatch_failure_probe() returns trigger language plpgsql as $$begin raise exception 'synthetic_dispatch_rollback';end$$;
 create trigger dispatch_failure_probe before insert on receptionist_voicemail_dispatch_receipts for each row execute function dispatch_failure_probe();""")
 denied('set role service_role;select voicemail_schedule_tick();','synthetic_dispatch_rollback')
 assert before==sql("select jsonb_agg(to_jsonb(s) order by route_id) from receptionist_voicemail_scans s")
 sql('drop trigger dispatch_failure_probe on receptionist_voicemail_dispatch_receipts;drop function dispatch_failure_probe();')
 sql(f"insert into feature_flags values('{tenant}','learn.inputs.email.enabled','false');")
 paused=tick();assert paused['state']=='attention' and paused['jobs_enqueued']==0 and paused['rows_examined']==0,paused
 assert sql(f"select rows_examined from receptionist_voicemail_scans where route_id='{route}'")=='500'
 operator=ident(40)
 # Actual operator gate: ordinary tenant owner denied, active view grant allowed,
 # expired grant and View-As denied. Content/owner access is never conferred.
 sql(f"insert into auth.users values('{operator}');insert into profiles values('{operator}','{tenant}','owner');")
 auth=f"set role authenticated;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='{operator}';set test.tenant='{tenant}';"
 read=auth+f"select learn_operator_voicemail_status('{tenant}');"
 denied(read,'learn_operator_forbidden')
 sql(f"insert into platform_authority_grants(profile_id,permission,granted_by,reason) values('{operator}','platform.controlplane.view','synthetic','Offline fixture only');")
 assert sql(auth+f"select can_manage_voicemail('{tenant}','{mailbox}');")=='f'
 assert sql(auth+f"select count(*) from receptionist_voicemails where tenant_id='{tenant}';")=='0'
 result=json.loads(sql(read));assert result['tenant_id']==tenant and result['next_after'] is None
 assert len(result['routes'])==3 and all(v['status']['coverage_complete'] is False and v['status']['capture_allowed'] is False for v in result['routes'])
 assert all(set(v)=={'route_id','enabled','extension','status'} for v in result['routes'])
 assert 'Synthetic source text' not in json.dumps(result) and 'synthetic@example.invalid' not in json.dumps(result)
 # Pagination includes disabled/unscanned routes without claiming their counts are capture.
 sql(f"insert into receptionist_voicemail_email_routes(id,tenant_id,mailbox_id,email_account_id,recipient_email,signing_domain,owner_user_id,access_mode,received_from,received_until,binding_evidence,verified_by,enabled) select ('ce440002-aaaa-4000-8000-'||lpad(n::text,12,'0'))::uuid,tenant_id,mailbox_id,email_account_id,recipient_email,signing_domain,owner_user_id,access_mode,received_from,received_until,'Synthetic pagination',verified_by,false from receptionist_voicemail_email_routes cross join generate_series(1,21)n where id='{route}';")
 first=json.loads(sql(read));assert len(first['routes'])==20 and first['next_after']==first['routes'][-1]['route_id']
 last=json.loads(sql(auth+f"select learn_operator_voicemail_status('{tenant}','{first['next_after']}');"));assert len(last['routes'])==4 and last['next_after'] is None
 assert set(v['route_id'] for v in first['routes']).isdisjoint(v['route_id'] for v in last['routes'])
 sql(f"insert into view_as_context values('{operator}',clock_timestamp()+interval '1 hour',null);")
 denied(read,'learn_operator_preview_forbidden');sql('delete from view_as_context;')
 sql('update platform_authority_grants set effective_to=clock_timestamp();')
 denied(read,'learn_operator_forbidden')
 print('PASS: dispatch migration rollback, idle no-write, 2-route/5-page limits, concurrent tick and receipt replay, route backoff/fairness, atomic rollback, capture pause, actual operator view grant, owner/expired/View-As denial and private aggregate-only output')
