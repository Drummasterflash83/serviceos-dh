-- Rollback-only hosted probes, no identity creation, credentials or provider calls.
begin;
set local request.jwt.claim.sub='';
set local request.jwt.claim.role='authenticated';
set local role authenticated;
do $$begin
 begin perform public.learn_quickbooks_disconnect_request(null,null,null,1,'Verify denial');raise exception 'Expected request denial';exception when insufficient_privilege then null;end;
 begin perform public.learn_quickbooks_disconnect_status(null);raise exception 'Expected status denial';exception when insufficient_privilege then null;end;
 begin perform public.learn_quickbooks_disconnect_review(null,null,'Verify missing identity denial');raise exception 'Expected review denial';exception when insufficient_privilege then null;end;
 begin perform public.learn_quickbooks_disconnect_acquire(null);raise exception 'Expected credential denial';exception when insufficient_privilege then null;end;
 begin perform 1 from public.learn_quickbooks_disconnections;raise exception 'Expected table denial';exception when insufficient_privilege then null;end;
end $$;
set local role anon;
do $$begin
 begin perform public.learn_quickbooks_disconnect_status(null);raise exception 'Expected anonymous denial';exception when insufficient_privilege then null;end;
end $$;
set local request.jwt.claim.role='service_role';
set local role service_role;
do $$begin
 begin perform public.learn_quickbooks_disconnect_request(null,null,null,1,'Verify denial');raise exception 'Expected forged action denial';exception when insufficient_privilege then null;end;
 begin perform public.learn_quickbooks_disconnect_acquire(null);raise exception 'Expected absent request denial';exception when insufficient_privilege then null;end;
end $$;
rollback;
