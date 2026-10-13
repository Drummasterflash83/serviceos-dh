-- TEST-only rollback probe. No users, grants, credentials or tenant data created.
begin;
set local statement_timeout='15s';
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='';
set local role authenticated;
do $$begin
 begin perform public.learn_quickbooks_status('b0000000-0000-4000-8000-000000000001');raise exception 'Missing identity was admitted';exception when insufficient_privilege then null;end;
 begin perform public.learn_quickbooks_import_status('b0000000-0000-4000-8000-000000000001');raise exception 'Missing identity read imports';exception when insufficient_privilege then null;end;
 begin perform public.learn_quickbooks_import_acquire();raise exception 'Client acquired worker credentials';exception when insufficient_privilege then null;end;
 begin perform 1 from public.learn_quickbooks_source_versions;raise exception 'Client read raw accounting table';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local request.jwt.claim.role='anon';set local role anon;
do $$begin
 begin perform public.learn_quickbooks_status('b0000000-0000-4000-8000-000000000001');raise exception 'Anonymous status admitted';exception when insufficient_privilege then null;end;
 begin perform public.learn_quickbooks_import_acquire();raise exception 'Anonymous worker admitted';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local request.jwt.claim.role='service_role';set local role service_role;
do $$declare r jsonb;begin
 r:=public.learn_quickbooks_import_acquire();
 if r is distinct from '{"state":"idle"}'::jsonb then raise exception 'Unexpected TEST work or credential';end if;
end $$;
rollback;
select true as missing_identity_and_role_denials_verified;
