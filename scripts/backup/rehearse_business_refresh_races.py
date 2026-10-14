"""Controlled two-session races; only accepts the caller's networkless restore."""
import json,subprocess,time,select
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

def run_races(target,out):
    target.verify_boundary()
    base=Path('scripts/verify/learn-customer-context-lookup.assert.sql').read_text().split('-- Reproduce the large customer case')[0]
    base=base.replace('pg_temp.','refresh_fixture.').replace('create temporary table','create table')
    setup="begin;set local search_path=refresh_fixture,public,pg_catalog;set local plpgsql.check_asserts=on;create schema refresh_fixture;grant usage on schema refresh_fixture to authenticated,anon,service_role;\n"+base+"""
reset role;
insert into public.feature_flags(tenant_id,flag,value) values(refresh_fixture.sc(1),'learn.enabled','true'),(refresh_fixture.sc(1),'learn.inputs.commusoft.enabled','true') on conflict do nothing;update public.feature_flags set value='true' where tenant_id=refresh_fixture.sc(1) and flag in('learn.enabled','learn.inputs.commusoft.enabled');
insert into public.tenant_connectors(tenant_id,connector_id,provider,category,status,enabled) values(refresh_fixture.sc(1),'commusoft','commusoft','business','active',true);
update public.provider_connections set verified_at=clock_timestamp()-interval '1 minute' where id=refresh_fixture.sc(70);
update public.jobs j set title='Job 100',description=null,created_date=null,completed_date=null,metadata=jsonb_set(j.metadata,'{learn_business_input,timestamps}',public.learn_commusoft_job_fields(v.payload,'100')->'timestamps') from public.learn_business_input_versions v where j.id=refresh_fixture.sc(20) and v.id=(j.metadata#>>'{learn_business_input,source_version_id}')::uuid;
select refresh_fixture.scsource('jobs','{"id":100,"propertyID":1,"status":"completed","description":"001. Concurrent review"}');
create table refresh_fixture.inputs(plan jsonb);
grant select,insert on refresh_fixture.inputs to authenticated;
select set_config('request.jwt.claim.sub',refresh_fixture.sc(10)::text,true);
set local role authenticated;
insert into refresh_fixture.inputs select public.openfolk_business_review(refresh_fixture.sc(1),'learn_commusoft_job_refresh_plan','Prepare offline concurrent review',jsonb_build_object('p_tenant',refresh_fixture.sc(1),'p_link',(select id from public.learn_business_input_links where false))) ->'result';
commit;
"""
    # The authenticated role cannot directly read private identity links; prepare
    # that link id under the fixture owner before entering the real facade.
    setup=setup.replace("create table refresh_fixture.inputs(plan jsonb);", "create table refresh_fixture.inputs(plan jsonb);create table refresh_fixture.identity as select id from public.learn_business_input_links where tenant_id=refresh_fixture.sc(1) and collection='jobs' and external_id='100';grant select on refresh_fixture.identity to authenticated;")
    setup=setup.replace('(select id from public.learn_business_input_links where false)','(select id from refresh_fixture.identity)')
    records=[]
    for index,(first_action,second_action,expected) in enumerate([('apply','apply','committed'),('cancel','apply','cancelled'),('apply','cancel','committed')]):
        db='refresh_race_'+str(index)
        target.query('create database '+db+' template postgres owner postgres;')
        args=target._psql();args[args.index('-d')+1]=db
        command=[target.docker,*args]
        def query(sql):
            p=subprocess.run(command,input=sql.encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=45)
            if p.returncode:
                (out/(db+'-error.private.log')).write_bytes(p.stderr)
                raise RuntimeError('Offline concurrency query failed: '+db)
            return p.stdout.decode().strip()
        query(setup)
        assert json.loads(query('select plan from refresh_fixture.inputs;'))['state']=='ready'
        preserved="select jsonb_build_object('links',(select md5(string_agg(to_jsonb(l)::text,'' order by id)) from public.learn_business_input_links l where tenant_id=refresh_fixture.sc(1)),'versions',(select md5(string_agg(to_jsonb(v)::text,'' order by id)) from public.learn_business_input_versions v where tenant_id=refresh_fixture.sc(1)),'profile',(select to_jsonb(p) from public.profiles p where id=refresh_fixture.sc(10)));"
        before=query(preserved)
        def body(action,name):
            return "begin;set local statement_timeout='25s';set local search_path=refresh_fixture,public,pg_catalog;set local application_name='"+name+"';set local request.jwt.claim.role='authenticated';select set_config('request.jwt.claim.sub',refresh_fixture.sc(10)::text,true);set local role authenticated;select public.openfolk_business_review(refresh_fixture.sc(1),'learn_commusoft_job_refresh','Offline simultaneous review',jsonb_build_object('p_tenant',refresh_fixture.sc(1),'p_request',refresh_fixture.sc(800),'p_link',plan->>'link_id','p_source',plan->>'source_version_id','p_revision',plan->>'revision','p_reason','Offline simultaneous review','p_action','"+action+"'))->'result' from refresh_fixture.inputs;"
        first=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,bufsize=0)
        first.stdin.write((body(first_action,'refresh_first_'+str(index))+"select 'FIRST_DONE';\n").encode());first.stdin.flush()
        lines=[];deadline=time.monotonic()+30
        # -t -A emits one JSON row. A separate marker confirms the first mutation
        # exists in an uncommitted transaction before the second session starts.
        while True:
            if time.monotonic()>deadline:raise RuntimeError('First transaction did not reach barrier')
            ready,_,_=select.select([first.stdout],[],[],1)
            if not ready:continue
            line=first.stdout.readline().decode().strip()
            if not line:
                if first.poll() is not None:raise RuntimeError('First transaction exited before barrier')
                continue
            lines.append(line)
            if line=='FIRST_DONE':break
        with ThreadPoolExecutor(max_workers=1) as pool:
            second=pool.submit(subprocess.run,command,input=(body(second_action,'refresh_second_'+str(index))+'commit;').encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=35)
            blocked=False
            for _ in range(50):
                observed=target.query("select count(*) from pg_stat_activity where datname='"+db+"' and application_name='refresh_second_"+str(index)+"' and wait_event_type='Lock';")
                if observed=='1':blocked=True;break
                if second.done():break
                time.sleep(.1)
            first.stdin.write(b'commit;\n');first.stdin.close();first.stdin=None
            first_out,first_err=first.communicate(timeout=15)
            other=second.result(timeout=35)
        (out/(db+'-stderr.private.log')).write_bytes(first_err+other.stderr)
        if first.returncode or other.returncode:raise RuntimeError('Race transaction failed')
        def receipt(output):
            values=[json.loads(x) for x in output.splitlines() if x.startswith('{')]
            if len(values)!=1:raise RuntimeError('Expected exactly one receipt')
            return values[0]
        one=receipt('\n'.join(lines)),receipt(other.stdout.decode())
        assert blocked and one[0]==one[1] and one[0]['state']==expected
        state=json.loads(query("select jsonb_build_object('refreshes',(select count(*) from public.learn_business_input_refreshes),'cancellations',(select count(*) from public.learn_business_input_refresh_cancellations),'jobStatus',(select status from public.jobs where id=refresh_fixture.sc(20)));"))
        assert state==({'refreshes':1,'cancellations':0,'jobStatus':'completed'} if expected=='committed' else {'refreshes':0,'cancellations':1,'jobStatus':'open'})
        assert query(preserved)==before
        records.append({'first':first_action,'second':second_action,'secondObservedWaitingOnLock':blocked,'matchingReceipts':True,'state':expected,'exactlyOneDurableOutcome':True,'identitySourceAndProfilePreserved':True})
    return records
