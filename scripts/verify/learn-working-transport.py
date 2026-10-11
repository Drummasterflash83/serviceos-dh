"""Actual HTTP RPC through a cached PostgREST sidecar; no host ports/network."""
import base64
import hashlib
import hmac
import json
import subprocess
import time

sidecar=TARGET+'-http'
secret='synthetic-only-working-time-http-key-2026'
tenant='aaa50000-0000-4000-8000-000000000001'
request='ff150000-0000-4000-8000-000000090001'
owner='bbb50000-0000-4000-8000-000000000001'
def encoded(v):return base64.urlsafe_b64encode(json.dumps(v,separators=(',',':')).encode()).rstrip(b'=').decode()
def token(sub):
    message=encoded({'alg':'HS256','typ':'JWT'})+'.'+encoded({'role':'authenticated','sub':sub,'exp':int(time.time())+600})
    return message+'.'+base64.urlsafe_b64encode(hmac.new(secret.encode(),message.encode(),hashlib.sha256).digest()).rstrip(b'=').decode()
def sql(query):
    return docker('exec',TARGET,'psql','-U','supabase_admin','-d','roster_verify','-qAtc',query).stdout.decode().strip()
def rpc(name,args,sub=owner):
    headers=['-H','Content-Type: application/json']
    if sub:headers+=['-H','Authorization: Bearer '+token(sub)]
    result=docker('exec','-i',TARGET,'curl','--silent','--show-error','--max-time','30','-w','\n%{http_code}',*headers,
      '--data-binary','@-','http://127.0.0.1:3000/rpc/'+name,input=json.dumps(args).encode())
    body,status=result.stdout.rsplit(b'\n',1)
    return int(status),json.loads(body),len(body)
try:
    docker('run','-d','--pull=never','--network','container:'+TARGET,'--name',sidecar,
      '-e','PGRST_DB_URI=postgresql://supabase_admin@127.0.0.1:5432/roster_verify','-e','PGRST_DB_SCHEMAS=public',
      '-e','PGRST_DB_ANON_ROLE=anon','-e','PGRST_JWT_SECRET='+secret,'-e','PGRST_SERVER_PORT=3000','public.ecr.aws/supabase/postgrest:v14.5')
    for _ in range(40):
        probe=subprocess.run([DOCKER,'exec',TARGET,'curl','-s','--max-time','1','-o','/dev/null','-w','%{http_code}','http://127.0.0.1:3000/'],capture_output=True)
        if probe.returncode==0 and probe.stdout==b'200':break
        time.sleep(.25)
    else:raise RuntimeError('Isolated PostgREST did not become ready')
    period=json.loads(sql("select jsonb_build_object('start',starts,'end',ends,'policy',(select member_policy->>'id' from working_collection_fixture)) from working_http_fixture"))
    args={'p_tenant':tenant,'p_kind':'workingTime','p_subject':'ddd50000-0000-4000-8000-000000000001','p_policy':period['policy'],'p_revision':2,
      'p_start':period['start'],'p_end':period['end'],'p_request':request,'p_reason':'Synthetic HTTP receipt verification'}
    status,progress,_=rpc('learn_work_collection_begin',args)
    assert status==200,(status,progress)
    while progress['state']=='collecting':
        status,progress,_=rpc('learn_work_collection_step',{'p_tenant':tenant,'p_request':request,'p_after':progress['processed']})
        assert status==200,(status,progress)
    assert progress['state']=='completed'
    ordinal=int(sql(f"select ordinal from learn_work_collection_items where run_id='{request}' and object_id='eee50000-0000-4000-8000-000000090001'"))
    args={'p_tenant':tenant,'p_request':request,'p_part':'workingItem','p_after':ordinal}
    status,body,byte_count=rpc('learn_work_collection_evidence',args)
    assert status==200 and byte_count>1800000
    event=body['data']['history']['events'][0]
    assert event['before']['attributes']['synthetic']==event['after']['attributes']['synthetic']=='z'*900000
    status,_,_=rpc('learn_work_collection_evidence',args,sub=None)
    assert status in (401,403),'Anonymous evidence must remain denied'
    status,_,_=rpc('learn_work_collection_evidence',args,sub='bbb40000-0000-0000-0000-000000000006')
    assert status==403,'Foreign tenant must remain denied'
    status,_,_=rpc('learn_performance_append',{'p_tenant_id':tenant,'p_measurement':{},'p_reason':'Untrusted browser append'})
    assert status in (401,403,404),'Authenticated browser must not invent automatic values'
    # A larger captured history exceeds the retained input bound. The API must
    # return its supported-limit code and preserve the last committed checkpoint.
    sql("update working_http_fixture set starts=clock_timestamp();insert into intelligence_objects(id,tenant_id,domain,object_type,object_class,subject,status,responsible_ref,attributes) values ('eee50000-0000-4000-8000-000000090002','aaa50000-0000-4000-8000-000000000001','serviceos','Action','action','Synthetic over-limit source','ready','{\"kind\":\"member\",\"ref\":\"ddd50000-0000-4000-8000-000000000001\"}',jsonb_build_object('synthetic',repeat('q',1050000)));update working_http_fixture set ends=clock_timestamp();")
    period=json.loads(sql("select jsonb_build_object('start',starts,'end',ends,'policy',(select member_policy->>'id' from working_collection_fixture)) from working_http_fixture"))
    oversized='ff150000-0000-4000-8000-000000090002'
    args={'p_tenant':tenant,'p_kind':'workingTime','p_subject':'ddd50000-0000-4000-8000-000000000001','p_policy':period['policy'],'p_revision':2,
      'p_start':period['start'],'p_end':period['end'],'p_request':oversized,'p_reason':'Synthetic oversized history rejection'}
    status,progress,_=rpc('learn_work_collection_begin',args)
    assert status==200
    while True:
        previous=progress
        status,progress,_=rpc('learn_work_collection_step',{'p_tenant':tenant,'p_request':oversized,'p_after':previous['processed']})
        if status!=200:break
        assert progress['state']=='collecting','Oversized evidence must never become a measurement'
    assert status==500 and progress['code']=='54000',(status,progress.get('code'))
    status,retained,_=rpc('learn_work_collection_status',{'p_tenant':tenant,'p_request':oversized})
    assert status==200 and retained==previous,'Failed batch must keep its prior committed checkpoint'
    assert sql(f"select count(*) from measurements where id='{oversized}'")=='0'
    assert sql(f"select count(*) from learn_working_collection_items where run_id='{oversized}' and ordinal>{previous['processed']} and history is not null")=='0'
    print(json.dumps({'workingTimeHTTP':'passed','postgrest':'v14.5','retainedItemBytes':byte_count,'attributesEachPreserved':900000,'anonymousAndForeignDenied':True,'directBrowserAppendDenied':True,'oversizedHTTPCode':'54000','failedBatchAtomic':True}),flush=True)
finally:
    subprocess.run([DOCKER,'rm','-f',sidecar],capture_output=True)
