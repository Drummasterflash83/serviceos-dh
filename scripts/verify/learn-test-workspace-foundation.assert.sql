do $$declare t text;begin
 foreach t in array array['member_integration_identities','communication_endpoints','endpoint_ownership_assignments','responsibility_handoffs','telephony_inventory','endpoint_identity_reviews','health_types','health_subject_types','health_objects'] loop
 assert (select relrowsecurity from pg_class where oid=to_regclass('public.'||t)), 'Missing RLS';
 assert has_table_privilege('service_role','public.'||t,'SELECT'), 'Server reader missing';
 assert not has_table_privilege('service_role','public.'||t,'INSERT,UPDATE,DELETE'), 'Read repair enabled writes';
 assert not has_table_privilege('authenticated','public.'||t,'SELECT,INSERT,UPDATE,DELETE'), 'Client raw access widened';
 assert not has_table_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,DELETE'), 'Anonymous access widened';
 end loop;
 assert exists(select 1 from pg_constraint where conrelid='public.member_integration_identities'::regclass and conname='mii_member_same_tenant' and contype='f');
 assert exists(select 1 from pg_constraint where conrelid='public.endpoint_ownership_assignments'::regclass and conname='eoa_endpoint_same_tenant' and contype='f');
 assert exists(select 1 from pg_constraint where conrelid='public.endpoint_ownership_assignments'::regclass and conname='eoa_no_overlap_accountable' and contype='x');
 assert exists(select 1 from pg_constraint where conrelid='public.endpoint_identity_reviews'::regclass and conname='eir_endpoint_same_tenant' and contype='f');
end$$;
