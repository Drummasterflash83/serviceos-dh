/** Managed Postgres 17 gives postgres ADMIN, without INHERIT/SET, on the existing
 * protocol owner. Borrow inheritance only inside the migration transaction; the
 * original supabase_admin membership, all ACLs and function owners must survive.
 * A failure aborts the transaction, including these temporary memberships.
 */
export const emailMigrationAccessSnapshot = `select jsonb_build_object(
 'memberships',(select coalesce(jsonb_agg(to_jsonb(m) order by m.roleid,m.member,m.grantor),'[]') from pg_auth_members m where m.roleid='email_ingestion_protocol_owner'::regrole or m.member='email_ingestion_protocol_owner'::regrole),
 'functions',(select jsonb_agg(jsonb_build_object('oid',p.oid,'owner',p.proowner,'acl',p.proacl) order by p.oid) from pg_proc p where p.oid in ('public.email_ingestion_transition_v2(uuid,uuid,text,uuid,uuid,text,uuid,bigint,uuid,jsonb)'::regprocedure,'public.email_ingestion_payload_v2(text,text,jsonb)'::regprocedure)),
 'schema',(select to_jsonb(n.nspacl) from pg_namespace n where n.nspname='public')) as snapshot`;
export const emailMigrationAccessBegin = `
do $$begin
 if current_user<>'postgres' or current_setting('server_version_num')::integer<160000 then raise exception 'Exact managed migration session required';end if;
 if not exists(select 1 from pg_auth_members where roleid='email_ingestion_protocol_owner'::regrole and member='postgres'::regrole and grantor='supabase_admin'::regrole and admin_option and not inherit_option and not set_option)
 or exists(select 1 from pg_auth_members where roleid='email_ingestion_protocol_owner'::regrole and grantor='postgres'::regrole) then raise exception 'Unexpected protocol owner memberships';end if;
end$$;
create temporary table email_migration_authority on commit drop as ${emailMigrationAccessSnapshot};
-- Set FALSE first, then enable inheritance on this transaction's new grant only.
grant email_ingestion_protocol_owner to postgres with set false granted by postgres;
grant email_ingestion_protocol_owner to postgres with inherit true granted by postgres;
`;
export const emailMigrationAccessEnd = `
revoke email_ingestion_protocol_owner from postgres granted by postgres;
do $$begin
 if (select snapshot from email_migration_authority) is distinct from (${emailMigrationAccessSnapshot}) then raise exception 'Email migration changed authority';end if;
end$$;
`;
