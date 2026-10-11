/** Managed Postgres 17 gives postgres ADMIN, without INHERIT/SET, on the existing
 * card reader. Borrow inheritance only inside the migration transaction; the
 * original supabase_admin membership, all ACLs and function owners must survive.
 * A failure aborts the transaction, including these temporary memberships.
 */
export const draftMigrationAccessSnapshot = `select jsonb_build_object(
 'memberships',(select coalesce(jsonb_agg(to_jsonb(m) order by m.roleid,m.member,m.grantor),'[]') from pg_auth_members m where m.roleid='learn_card_communication_reader'::regrole or m.member='learn_card_communication_reader'::regrole),
 'functions',(select jsonb_agg(jsonb_build_object('oid',p.oid,'owner',p.proowner,'acl',p.proacl) order by p.oid) from pg_proc p where p.oid in ('public.learn_card_communications_read(uuid,uuid,uuid,uuid,uuid[])'::regprocedure,'public.learn_project_interaction(uuid,uuid,text,uuid,text,text)'::regprocedure,'public.learn_identity_deliver_internal(uuid,uuid,uuid,text,text,uuid)'::regprocedure,'public.learn_identity_deliver(uuid,uuid,uuid,text,text)'::regprocedure,'public.learn_identity_pending(uuid,integer)'::regprocedure,'public.learn_projection_pending(uuid,text,integer)'::regprocedure,'public.learn_identity_review_state(uuid,uuid,uuid)'::regprocedure,'public.learn_identity_review_count(uuid)'::regprocedure,'public.learn_projection_review_count(uuid,text)'::regprocedure,'public.learn_email_source_fields(public.email_messages)'::regprocedure,'public.learn_email_store_page(jsonb,jsonb,jsonb,text,integer)'::regprocedure)),
 'schema',(select to_jsonb(n.nspacl) from pg_namespace n where n.nspname='public')) as snapshot`;
export const draftMigrationAccessBegin = `
do $$begin
 if current_user<>'postgres' or current_setting('server_version_num')::integer<160000 then raise exception 'Exact managed migration session required';end if;
 if not exists(select 1 from pg_auth_members where roleid='learn_card_communication_reader'::regrole and member='postgres'::regrole and grantor='supabase_admin'::regrole and admin_option and not inherit_option and not set_option)
 or exists(select 1 from pg_auth_members where roleid='learn_card_communication_reader'::regrole and grantor='postgres'::regrole) then raise exception 'Unexpected card reader memberships';end if;
end$$;
create temporary table draft_migration_authority on commit drop as ${draftMigrationAccessSnapshot};
-- Set FALSE first, then enable inheritance on this transaction's new grant only.
grant learn_card_communication_reader to postgres with set false granted by postgres;
grant learn_card_communication_reader to postgres with inherit true granted by postgres;
`;
export const draftMigrationAccessEnd = `
revoke learn_card_communication_reader from postgres granted by postgres;
do $$begin
 if (select snapshot from draft_migration_authority) is distinct from (${draftMigrationAccessSnapshot}) then raise exception 'Draft migration changed existing authority';end if;
end$$;
`;
