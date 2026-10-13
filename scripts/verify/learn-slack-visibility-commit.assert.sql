-- Run after customer-context fixture in the same isolated, rolled-back database.
reset role;
insert into connector_accounts(id,tenant_id,tenant_connector_id,account_key,status,settings)
 values(pg_temp.sc(101),pg_temp.sc(1),pg_temp.sc(91),'TSYNTHETIC:CWRITE','active',jsonb_build_object('slack_history',jsonb_build_object('approved',true,'connectionId',pg_temp.sc(90),'teamId','TSYNTHETIC','channelId','CWRITE','oldest','1791800000.000000','latest','1791800100.000000','consentReference','synthetic visibility proof','expiresAt',clock_timestamp()+interval '1 day','maxPages',1)));
insert into platform_jobs(id,tenant_id,job_type,job_key,status,payload,claimed_by,attempt_count,lease_expires_at)
 values(pg_temp.sc(102),pg_temp.sc(1),'slack.history_sync','synthetic-visibility-write','running',jsonb_build_object('connector_account_id',pg_temp.sc(101)),'synthetic-visibility-worker',1,clock_timestamp()+interval '10 minutes');
create temporary table vp as
 select jsonb_build_object('scopeKey',jsonb_build_array(pg_temp.sc(1)::text,'TSYNTHETIC','CWRITE','1791800000.000000','1791800100.000000','synthetic visibility proof')::text,'pages',0,'cursor',null,'complete',false) cp,
 jsonb_build_array(jsonb_build_object('tenant_id',pg_temp.sc(1),'channel_id','CWRITE','source_external_id','TSYNTHETIC:CWRITE:1791800001.000001','provider_timestamp','1791800001.000001','thread_timestamp',null,'text','Synthetic writer message','provider_payload',jsonb_build_object('ts','1791800001.000001','text','Synthetic writer message'))) records,
 jsonb_build_object('version','slack-capture-visibility/1','connection_id',id,'connection_revision',updated_at,'team_id','TSYNTHETIC','channel_id','CWRITE','is_channel',true,'is_private',false,'is_shared',false,'is_im',false,'is_mpim',false,'is_ext_shared',null,'is_org_shared',null,'is_pending_ext_shared',null,'pending_shared',false) visibility
 from provider_connections where id=pg_temp.sc(90);
grant select,update on vp to service_role;
create function pg_temp.reject_proof() returns trigger language plpgsql as $$begin
 if current_setting('test.reject_proof',true)='true' then raise exception 'synthetic_proof_failure';end if;return new;
end$$;
create trigger synthetic_reject_proof before insert on slack_channel_visibility_receipts for each row execute function pg_temp.reject_proof();
set local request.jwt.claim.role='service_role';set local role service_role;
do $$declare x record;bad jsonb;denied integer:=0;begin
 select * into x from vp;
 assert not has_function_privilege('authenticated','slack_commit_attested_page(uuid,uuid,uuid,uuid,text,integer,jsonb,jsonb,jsonb,jsonb)','execute');
 assert not has_table_privilege('service_role','slack_channel_visibility_receipts','insert');
 foreach bad in array array[x.visibility||'{"is_private":true}',x.visibility||'{"is_im":true}',x.visibility||'{"is_shared":true}',x.visibility-'is_private',x.visibility||jsonb_build_object('connection_revision','2000-01-01Z'),x.visibility||jsonb_build_object('channel_id','CFOREIGN')] loop
  begin perform slack_commit_attested_page(pg_temp.sc(1),pg_temp.sc(102),pg_temp.sc(101),null,'synthetic-visibility-worker',1,x.cp,x.cp||'{"pages":1,"complete":true}',x.records,bad);raise exception 'Bad visibility admitted';
  exception when sqlstate '22023' then denied:=denied+1;end;
 end loop;
 assert denied=6;
 begin perform slack_commit_attested_page(pg_temp.sc(2),pg_temp.sc(102),pg_temp.sc(101),null,'synthetic-visibility-worker',1,x.cp,x.cp||'{"pages":1,"complete":true}',x.records,x.visibility);raise exception 'Foreign tenant admitted';exception when sqlstate 'PT409' then null;end;
 begin perform slack_commit_attested_page(pg_temp.sc(1),pg_temp.sc(102),pg_temp.sc(101),null,'other-worker',1,x.cp,x.cp||'{"pages":1,"complete":true}',x.records,x.visibility);raise exception 'Stale claim admitted';exception when sqlstate 'PT409' then null;end;
 -- Legacy publication cannot acquire proof after the fact without a new replay.
 begin
  perform slack_history_commit_page(pg_temp.sc(1),pg_temp.sc(102),pg_temp.sc(101),'synthetic-visibility-worker',1,x.cp,x.cp||'{"pages":1,"complete":true}',x.records);
  begin perform slack_commit_attested_page(pg_temp.sc(1),pg_temp.sc(102),pg_temp.sc(101),null,'synthetic-visibility-worker',1,x.cp,x.cp||'{"pages":1,"complete":true}',x.records,x.visibility);raise exception 'Legacy page retroactively attested';exception when sqlstate 'PT409' then assert sqlerrm='slack_visibility_requires_replay';end;
  raise exception 'rollback_legacy_probe';
 exception when raise_exception then if sqlerrm<>'rollback_legacy_probe' then raise;end if;end;
 -- A failure AFTER original source/checkpoint publication must roll all of it back.
 perform set_config('test.reject_proof','true',true);
 begin perform slack_commit_attested_page(pg_temp.sc(1),pg_temp.sc(102),pg_temp.sc(101),null,'synthetic-visibility-worker',1,x.cp,x.cp||'{"pages":1,"complete":true}',x.records,x.visibility);raise exception 'Injected proof failure ignored';exception when raise_exception then if sqlerrm<>'synthetic_proof_failure' then raise;end if;end;
 assert not exists(select 1 from slack_messages where tenant_id=pg_temp.sc(1) and channel_id='CWRITE');
 assert (select sync_cursor='{}' from connector_accounts where id=pg_temp.sc(101));
 assert (select not(metadata ? 'slack_page_v1') from platform_jobs where id=pg_temp.sc(102));
 perform set_config('test.reject_proof','false',true);
 assert slack_commit_attested_page(pg_temp.sc(1),pg_temp.sc(102),pg_temp.sc(101),null,'synthetic-visibility-worker',1,x.cp,x.cp||'{"pages":1,"complete":true}',x.records,x.visibility);
 assert slack_commit_attested_page(pg_temp.sc(1),pg_temp.sc(102),pg_temp.sc(101),null,'synthetic-visibility-worker',1,x.cp,x.cp||'{"pages":1,"complete":true}',x.records,x.visibility),'Exact uncertain response replay failed';
 begin perform slack_commit_attested_page(pg_temp.sc(1),pg_temp.sc(102),pg_temp.sc(101),null,'synthetic-visibility-worker',1,x.cp,x.cp||'{"pages":1,"complete":true}',x.records,x.visibility||'{"is_org_shared":false}');raise exception 'Changed receipt admitted';exception when sqlstate 'PT409' then null;end;
end$$;reset role;
do $$begin
 assert (select count(*) from slack_channel_visibility_receipts where job_id=pg_temp.sc(102))=1;
 assert (select count(*) from slack_source_visibility_proofs p join slack_channel_visibility_receipts r on r.id=p.receipt_id join slack_message_versions v on v.id=p.version_id where r.job_id=pg_temp.sc(102) and v.tenant_id=r.tenant_id)=1;
end$$;
-- Actual thread publication uses its independent approval/checkpoint and proofs.
insert into platform_jobs(id,tenant_id,job_type,job_key,status,payload,claimed_by,attempt_count,lease_expires_at)
 values(pg_temp.sc(103),pg_temp.sc(1),'slack.thread_sync','synthetic-thread-proof','running',jsonb_build_object('connector_account_id',pg_temp.sc(101),'thread_import_id',pg_temp.sc(104)),'synthetic-visibility-worker',1,clock_timestamp()+interval '10 minutes');
insert into slack_thread_imports(id,tenant_id,account_id,source_message_id,initial_job_id,approved_by,definition,scope)
 select pg_temp.sc(104),pg_temp.sc(1),pg_temp.sc(101),m.id,pg_temp.sc(103),pg_temp.sc(11),'{}',a.settings->'slack_history'||'{"parentTimestamp":"1791800001.000001"}'
 from connector_accounts a join slack_messages m on m.tenant_id=a.tenant_id and m.channel_id='CWRITE' where a.id=pg_temp.sc(101);
update vp set cp=jsonb_set(cp,'{scopeKey}',to_jsonb(jsonb_build_array(pg_temp.sc(1)::text,'TSYNTHETIC','CWRITE','1791800000.000000','1791800100.000000','synthetic visibility proof','1791800001.000001')::text));
set local role service_role;
do $$declare x record;begin select * into x from vp;
 assert slack_commit_attested_page(pg_temp.sc(1),pg_temp.sc(103),pg_temp.sc(101),pg_temp.sc(104),'synthetic-visibility-worker',1,x.cp,x.cp||'{"pages":1,"complete":true}',x.records,x.visibility);
end$$;reset role;
do $$begin assert (select count(*) from slack_channel_visibility_receipts where job_id in(pg_temp.sc(102),pg_temp.sc(103)))=2;
 assert (select count(*) from slack_messages where tenant_id=pg_temp.sc(1) and channel_id='CWRITE')=1,'Duplicate replay created source';
 assert (select count(*) from slack_message_versions v join slack_messages m on m.id=v.message_id where m.tenant_id=pg_temp.sc(1) and m.channel_id='CWRITE')=1,'Duplicate replay created version';
end$$;
drop trigger synthetic_reject_proof on slack_channel_visibility_receipts;
