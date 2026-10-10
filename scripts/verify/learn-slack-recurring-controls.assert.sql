-- Status is readable to this company; writes remain owner/admin or OpenFolk-admin.
set test.actor='00000000-0000-4000-8000-000000000012';set test.role='authenticated';set role authenticated;
do $$declare r jsonb;begin
 r:=learn_slack_recurring_read('00000000-0000-4000-8000-000000000010');
 if r->>'version'<>'learn-slack-recurring/1' or r->>'canWrite'<>'false' or jsonb_array_length(r->'channels')<>1 then raise exception 'Viewer status invalid';end if;
 if r::text ~ 'secret_refs|provider_payload|consentReference|bot_token' then raise exception 'Private fields returned';end if;
end $$;
reset role;
insert into tenants(id) values('00000000-0000-4000-8000-000000000070');
insert into profiles values('00000000-0000-4000-8000-000000000071','00000000-0000-4000-8000-000000000070','owner');
set test.actor='00000000-0000-4000-8000-000000000071';set role authenticated;
do $$declare denied boolean:=false;begin
 begin perform learn_slack_recurring_read('00000000-0000-4000-8000-000000000010');exception when insufficient_privilege then denied:=true;end;
 if not denied or (select count(*) from slack_recurring_channels)<>0 then raise exception 'Foreign owner read channel status';end if;
end $$;
reset role;
insert into platform_authority_grants values('00000000-0000-4000-8000-000000000071','platform.controlplane.admin',now()-interval '1 minute',now()+interval '10 minutes');
set role authenticated;
do $$declare r jsonb;account uuid:=(select account_id from verify.fixture);begin
 r:=learn_slack_recurring_read('00000000-0000-4000-8000-000000000010');
 if r->>'canWrite'<>'true' then raise exception 'Active OpenFolk admin unavailable';end if;
 r:=learn_slack_recurring_control('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000072',account,3,false,'Review pause','check');
 if r->>'state'<>'pending' then raise exception 'Receipt check applied a request';end if;
 r:=learn_slack_recurring_control('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000072',account,3,false,'Review pause','cancel');
 if r->>'state'<>'cancelled' then raise exception 'Cancellation not retained';end if;
 r:=learn_slack_recurring_control('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000072',account,3,false,'Review pause','apply');
 if r->>'state'<>'cancelled' or not (select enabled from slack_recurring_channels limit 1) then raise exception 'Delayed request bypassed cancellation';end if;
end $$;
reset role;
insert into view_as_context values('00000000-0000-4000-8000-000000000071',null,now()+interval '10 minutes');
set role authenticated;
do $$begin if learn_slack_recurring_read('00000000-0000-4000-8000-000000000010')->>'canWrite'<>'false' then raise exception 'View-As reported writable';end if;end $$;
reset role;
update view_as_context set ended_at=now();
update platform_authority_grants set effective_to=now()-interval '1 second';
set role authenticated;
do $$declare denied boolean:=false;begin
 begin perform learn_slack_recurring_read('00000000-0000-4000-8000-000000000010');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Expired grant retained access';end if;
end $$;
reset role;
select 'PASS: normalized status, tenant isolation, active operator grant, preview/expiry and cancellation fence';
