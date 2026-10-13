-- Hosted TEST checks contain no user IDs, records, credentials or provider calls.
begin;
set local request.jwt.claim.sub='';
set local request.jwt.claim.role='authenticated';
set local role authenticated;
do $$begin
 begin perform public.learn_quickbooks_customer_finance(null,null);raise exception 'Expected missing-identity denial';
 exception when insufficient_privilege then null;end;
 begin perform public.learn_quickbooks_customer_candidates(null,'production','Verify access');raise exception 'Expected candidate denial';
 exception when insufficient_privilege then null;end;
 begin perform public.learn_quickbooks_customer_link(null,null,null,0,'Verify access');raise exception 'Expected link denial';
 exception when insufficient_privilege then null;end;
 begin perform 1 from public.learn_quickbooks_customer_links;raise exception 'Expected direct-table denial';
 exception when insufficient_privilege then null;end;
end $$;
set local role anon;
do $$begin
 begin perform public.learn_quickbooks_customer_finance(null,null);raise exception 'Expected anonymous denial';
 exception when insufficient_privilege then null;end;
end $$;
set local role service_role;
do $$begin
 begin perform public.learn_quickbooks_customer_finance(null,null);raise exception 'Expected service denial';
 exception when insufficient_privilege then null;end;
end $$;
rollback;
