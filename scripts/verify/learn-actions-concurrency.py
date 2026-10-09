"""Controlled two-session races in the disposable verification database only."""
import concurrent.futures
import select
import subprocess
import time
import uuid


def verify_authority_races(run, docker, target, database):
    def ok(sql):
        return run(sql)

    def refused(result, message):
        assert result.returncode and message.encode() in result.stderr, result.stderr.decode()[-800:]

    def action(item, actor=811, tenant=801, version=1, status='in_progress', verb='start'):
        return f"select work_transition_apply(verify.id({tenant}),verify.id({item}),{version},'{status}','{{}}',jsonb_build_object('verb','{verb}','actor',jsonb_build_object('user_id',verify.id({actor}))),null);"

    class Held:
        def __init__(self, sql):
            self.name='learn-race-'+uuid.uuid4().hex[:12]
            self.process=subprocess.Popen([docker,'exec','-i',target,'psql','-X','-qAt','-h','127.0.0.1','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-f','-'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,bufsize=0)
            self.send(f"set application_name='{self.name}';begin;set role service_role;"+sql)
        def send(self, sql):
            marker='ready_'+uuid.uuid4().hex
            self.process.stdin.write((sql+f"select '{marker}';\n").encode());self.process.stdin.flush()
            deadline=time.monotonic()+10;line=b''
            while time.monotonic()<deadline:
                if select.select([self.process.stdout],[],[],.1)[0]:
                    c=self.process.stdout.read(1)
                    if not c:raise RuntimeError('Controlled SQL session ended: '+self.process.stderr.read().decode()[-500:])
                    line+=c
                    if c==b'\n':
                        if line.strip()==marker.encode():return
                        line=b''
            raise RuntimeError('Controlled SQL session did not reach marker')
        def commit(self):self.send('commit;')
        def close(self):
            if self.process.poll() is None:
                self.process.stdin.close()
                try:self.process.wait(timeout=10)
                except subprocess.TimeoutExpired:self.process.kill();self.process.wait()
            assert self.process.returncode==0,'Controlled SQL session failed'
        def __enter__(self):return self
        def __exit__(self,*args):self.close()

    def wait_on_holder(name, holder):
        # Evidence of an actual blocked backend, not a sleep guessed to overlap.
        query=f"select exists(select 1 from pg_stat_activity a join pg_stat_activity h on h.pid=any(pg_blocking_pids(a.pid)) where a.datname='{database}' and a.application_name='{name}' and h.application_name='{holder.name}' and a.wait_event_type='Lock')"
        for _ in range(100):
            if run(query).stdout.strip()==b't':return
            time.sleep(.02)
        raise AssertionError('Expected authority ordering did not block on the held transaction')

    def race_after(holder, sql, role='service_role'):
        name='learn-wait-'+uuid.uuid4().hex[:12]
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            future=pool.submit(run,f"set application_name='{name}';set lock_timeout='8s';set role {role};"+sql,False)
            try:
                wait_on_holder(name,holder)
            finally:
                holder.commit()
            return future.result(timeout=10)

    ok("insert into intelligence_objects(id,tenant_id,domain,object_type,subject,status,responsible_ref) select verify.id(n),verify.id(801),'serviceos','Action','Synthetic authority race','ready',jsonb_build_object('kind','member','ref',verify.id(831)) from generate_series(871,879)n;insert into intelligence_objects(id,tenant_id,domain,object_type,subject,status,responsible_ref) values(verify.id(890),verify.id(802),'serviceos','Action','Foreign tenant parallel action','ready',jsonb_build_object('kind','member','ref',verify.id(835)));update responsibility_assignments set effective_to=null where id=verify.id(861);")
    with Held("update responsibility_assignments set effective_to=clock_timestamp() where id=verify.id(861);") as held:
        result=race_after(held,action(871,812))
        refused(result,'Work authority changed or does not cover this item')
    assert run("select status='ready' and version=1 from intelligence_objects where id=verify.id(871)").stdout.strip()==b't'
    assert run("select count(*)=1 from object_state_history where object_id=verify.id(871)").stdout.strip()==b't'
    print('Cover revocation first: blocked action rereads committed authority and writes nothing: PASS',flush=True)

    ok("update responsibility_assignments set effective_to=null where id=verify.id(861);")
    with Held(action(872,812)) as held:
        refused(run("set role service_role;update responsibility_assignments set effective_to=clock_timestamp() where id=verify.id(861);",False),'Work or authority is changing')
        # Shared registry locking must not serialize actions in unrelated companies.
        ok('set role service_role;'+action(890,814,802))
        held.commit()
    ok("set role service_role;update responsibility_assignments set effective_to=clock_timestamp() where id=verify.id(861);")
    refused(run('set role service_role;'+action(872,812,version=2,status='waiting',verb='wait'),False),'Work authority changed or does not cover this item')
    print('Action first: concurrent cover revocation conflicts; retry revokes subsequent access; other company proceeds: PASS',flush=True)

    with Held(action(873)) as held:
        # The actor profile is also row-locked, so this change waits rather than
        # reaching the trigger while the old action holds the profile row.
        result=race_after(held,"update profiles set role='openfolk' where id=verify.id(811);",role='postgres')
        assert result.returncode==0,result.stderr.decode()[-500:]
    refused(run('set role service_role;'+action(874),False),'Work actor must be an authorized tenant profile')
    ok("update profiles set role='viewer' where id=verify.id(811);")
    print('Actor role changes serialize behind an action and deny the next action: PASS',flush=True)

    with Held("update state_transitions set guard='{\"approval\":true}' where domain='serviceos' and object_type='Action' and from_state='ready' and to_state='in_progress';") as held:
        refused(race_after(held,action(875)),'Illegal or unsupported guarded work state transition')
    ok("update state_transitions set guard=null where domain='serviceos' and object_type='Action' and from_state='ready' and to_state='in_progress';")
    with Held(action(876)) as held:
        refused(run("set role service_role;update state_transitions set guard='{\"approval\":true}' where domain='serviceos' and object_type='Action' and from_state='ready' and to_state='in_progress';",False),'Work is using this registry')
        held.commit()
    print('Registry changes in both orderings cannot bypass a configured condition: PASS',flush=True)

    changes=[
      "update team_members set confirmed_at=null where id=verify.id(831);",
      "insert into team_members(tenant_id,profile_id,display_name,confirmed_at) values(verify.id(801),verify.id(811),'Ambiguous concurrent identity',now());",
      "update org_units set name='Concurrent move' where id=verify.id(821);",
      "insert into authority_grants(tenant_id,member_id,permission,scope,confirmed) values(verify.id(801),verify.id(833),'work.approve','company',true);",
      "update tenants set metadata='{\"timezone\":\"Pacific/Honolulu\"}' where id=verify.id(801);",
      "update profiles set tenant_id=verify.id(802) where id=verify.id(815);",
      "insert into view_as_context(tenant_id,actor_user_id,subject_kind,subject_ref) values(verify.id(802),verify.id(811),'user',verify.id(814)::text);",
    ]
    with Held(action(877)) as held:
        for sql in changes:
            # Existing profile/tenant mutations belong to privileged control-plane
            # writers; this release must not grant service DML that was absent.
            role='postgres' if sql.startswith(('update profiles','update tenants')) else 'service_role'
            refused(run('set role '+role+';'+sql,False),'Work or authority is changing')
        held.commit()
    print('Membership, phantom identity, team, grant, timezone, profile move and cross-tenant preview mutations join the authority lock: PASS',flush=True)
    refused(run('begin isolation level repeatable read;set role service_role;'+action(878),False),'fresh read-committed snapshot')
    print('A stale repeatable-read snapshot cannot establish action authority: PASS',flush=True)
