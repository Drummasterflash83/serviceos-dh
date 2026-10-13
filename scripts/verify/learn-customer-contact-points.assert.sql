-- Run after learn-customer-business-context.assert.sql in the same isolated transaction.
reset role;
update public.profiles set role='owner' where id=pg_temp.bcid(10);
insert into public.people(id,tenant_id,display_name,company_id) values(pg_temp.bcid(53),pg_temp.bcid(2),'Foreign contact',pg_temp.bcid(22));
insert into public.contact_points(id,tenant_id,person_id,channel,value,normalized_value,label,is_primary,verification_state,source,source_record_ref,metadata)
 select pg_temp.bcid(500+n),pg_temp.bcid(1),pg_temp.bcid(50),'email',case when n=1 then repeat('x',4001) else 'point'||n||'@example.invalid' end,
 'point'||n||'@example.invalid',case when n=1 then repeat('l',201) else 'Office' end,n=1,case when n=2 then 'invalid' else 'unverified' end,
 case when n=1 then repeat('s',101) else 'import' end,'NEVER_RETURN','{"secret":"NEVER_RETURN"}' from generate_series(1,26)n;
-- A shared value on another person must not expand the selected person's page.
insert into public.contact_points(id,tenant_id,person_id,channel,value,normalized_value) values
 (pg_temp.bcid(600),pg_temp.bcid(1),pg_temp.bcid(51),'email','point2@example.invalid','point2@example.invalid'),
 (pg_temp.bcid(601),pg_temp.bcid(2),pg_temp.bcid(53),'email','foreign@example.invalid','foreign@example.invalid');
set local role authenticated;
do $$declare a jsonb;b jsonb;begin
 a:=public.learn_customer_contact_points(pg_temp.bcid(1),pg_temp.bcid(30),pg_temp.bcid(50));
 assert (a->>'total')::int=26 and jsonb_array_length(a->'rows')=25 and a->>'next_after'=pg_temp.bcid(525)::text;
 assert a->'audit_id'='null'::jsonb and a->'operator_mode'='false'::jsonb and a->>'person_id'=pg_temp.bcid(50)::text;
 assert a::text not like '%NEVER_RETURN%' and a::text not like '%foreign@example.invalid%';
 assert length(a#>>'{rows,0,value}')=4000 and length(a#>>'{rows,0,label}')=200 and length(a#>>'{rows,0,source}')=100;
 assert a#>'{rows,0,truncated_fields}'='["value","label","source"]'::jsonb;
 assert a#>'{rows,0,is_primary}'='true'::jsonb and a#>>'{rows,1,verification_state}'='invalid';
 b:=public.learn_customer_contact_points(pg_temp.bcid(1),pg_temp.bcid(30),pg_temp.bcid(50),(a->>'next_after')::uuid);
 assert jsonb_array_length(b->'rows')=1 and b#>>'{rows,0,id}'=pg_temp.bcid(526)::text and b->'next_after'='null'::jsonb and (b->>'total')::int=26;
 a:=public.learn_customer_contact_points(pg_temp.bcid(1),pg_temp.bcid(32),pg_temp.bcid(52));assert (a->>'total')::int=0;
 begin perform public.learn_customer_contact_points(pg_temp.bcid(1),pg_temp.bcid(30),pg_temp.bcid(51));raise exception 'Unrelated person admitted';exception when insufficient_privilege then null;end;
 begin perform public.learn_customer_contact_points(pg_temp.bcid(1),pg_temp.bcid(30),pg_temp.bcid(53));raise exception 'Foreign person admitted';exception when insufficient_privilege then null;end;
 begin perform public.learn_customer_contact_points(pg_temp.bcid(1),pg_temp.bcid(31),pg_temp.bcid(50));raise exception 'Foreign card admitted';exception when insufficient_privilege then null;end;
 begin perform public.learn_customer_contact_points(pg_temp.bcid(2),pg_temp.bcid(31),pg_temp.bcid(53));raise exception 'Foreign tenant admitted';exception when insufficient_privilege then null;end;
 begin perform public.learn_customer_contact_points(pg_temp.bcid(1),pg_temp.bcid(30),null);raise exception 'Null person admitted';exception when insufficient_privilege then null;end;
end$$;
reset role;
update public.graph_edges set status='inactive' where tenant_id=pg_temp.bcid(1) and edge_type='contact_for';set local role authenticated;
do $$begin begin perform public.learn_customer_contact_points(pg_temp.bcid(1),pg_temp.bcid(30),pg_temp.bcid(50));raise exception 'Inactive edge admitted';exception when insufficient_privilege then null;end;end$$;
reset role;update public.graph_edges set status='active' where tenant_id=pg_temp.bcid(1) and edge_type='contact_for';
update public.graph_nodes set status='inactive' where id=pg_temp.bcid(60);set local role authenticated;
do $$begin begin perform public.learn_customer_contact_points(pg_temp.bcid(1),pg_temp.bcid(30),pg_temp.bcid(50));raise exception 'Inactive person node admitted';exception when insufficient_privilege then null;end;end$$;
reset role;update public.graph_nodes set status='active' where id=pg_temp.bcid(60);
update public.people set company_id=pg_temp.bcid(20) where id=pg_temp.bcid(51);set local role authenticated;
do $$begin assert (public.learn_customer_contact_points(pg_temp.bcid(1),pg_temp.bcid(30),pg_temp.bcid(51))->>'total')::int=1;end$$;
reset role;update public.profiles set role='viewer' where id=pg_temp.bcid(10);set local role authenticated;
do $$begin begin perform public.learn_customer_contact_points(pg_temp.bcid(1),pg_temp.bcid(30),pg_temp.bcid(50));raise exception 'Viewer admitted';exception when insufficient_privilege then null;end;end$$;
reset role;update public.platform_authority_grants set effective_to=clock_timestamp()+interval '5 minutes' where profile_id=pg_temp.bcid(10);set local role authenticated;
do $$declare a jsonb;begin
 a:=public.learn_customer_contact_points(pg_temp.bcid(2),pg_temp.bcid(31),pg_temp.bcid(53),null,'Review selected client contact');
 assert a->>'actor_id'=pg_temp.bcid(10)::text and a->>'audit_id' is not null and a->'operator_mode'='true'::jsonb and (a->>'total')::int=1;
 begin perform public.learn_customer_contact_points(pg_temp.bcid(2),pg_temp.bcid(31),pg_temp.bcid(53),null,'');raise exception 'Blank reason admitted';exception when invalid_parameter_value then null;end;
end$$;
reset role;
do $$begin assert (select count(*)=1 from public.controlplane_change_log where actor=pg_temp.bcid(10)::text and source='learn-customer-contact-points');end$$;
insert into public.view_as_context(tenant_id,actor_user_id,subject_kind,subject_ref,reason) values(pg_temp.bcid(2),pg_temp.bcid(10),'role','viewer','rollback contact fixture');set local role authenticated;
do $$begin begin perform public.learn_customer_contact_points(pg_temp.bcid(2),pg_temp.bcid(31),pg_temp.bcid(53),null,'View as denied');raise exception 'View-as admitted';exception when insufficient_privilege then null;end;end$$;
reset role;update public.view_as_context set ended_at=clock_timestamp() where actor_user_id=pg_temp.bcid(10);
create trigger synthetic_contact_audit_failure before insert on public.controlplane_change_log for each row execute function pg_temp.reject_context_audit();set local role authenticated;
do $$begin begin perform public.learn_customer_contact_points(pg_temp.bcid(2),pg_temp.bcid(31),pg_temp.bcid(53),null,'Audit failure');raise exception 'Audit failure released data' using errcode='XX000';exception when raise_exception then if sqlerrm<>'synthetic_context_audit_failure' then raise;end if;end;end$$;
reset role;drop trigger synthetic_contact_audit_failure on public.controlplane_change_log;
update public.platform_authority_grants set effective_to=clock_timestamp()-interval '1 second' where profile_id=pg_temp.bcid(10);set local role authenticated;
do $$begin begin perform public.learn_customer_contact_points(pg_temp.bcid(2),pg_temp.bcid(31),pg_temp.bcid(53),null,'Revoked denied');raise exception 'Revoked admitted';exception when insufficient_privilege then null;end;end$$;
reset role;set local role anon;
do $$begin begin perform public.learn_customer_contact_points(null,null,null);raise exception 'Anon admitted';exception when insufficient_privilege then null;end;end$$;
reset role;set local role service_role;
do $$begin begin perform public.learn_customer_contact_points(null,null,null);raise exception 'Service role admitted';exception when insufficient_privilege then null;end;end$$;
reset role;
