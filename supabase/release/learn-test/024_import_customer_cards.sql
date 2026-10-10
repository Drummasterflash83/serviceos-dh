-- Project approved imported customer identities into the existing card store.
-- No backfill at migration time. Existing cards are never updated by this code.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table of_test_deploy.migrations in share row exclusive mode;
do $$ begin
 if current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy' or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Explicit TEST target and checksum required';end if;
 if (select count(*) from of_test_deploy.migrations)<>24 or not exists(select 1 from of_test_deploy.migrations where migration_name='learn_import_actor_authority_v1' and source_sha256='8e30b2e65b43de7b39b873b3ee515dd9a44da98a5964d5ae704a66ec8ef2de86' and project_ref='saatxzwxvdvqevbnskxy') then raise exception 'Exact import authority release prerequisite required';end if;
 if encode(sha256(convert_to(pg_get_functiondef('public.import_row_preamble(uuid,uuid,uuid,integer,jsonb,jsonb,text)'::regprocedure),'UTF8')),'hex') is distinct from 'd046392d146879dd1d898fd5fec7ea544ae8f11744eecc3a1273937ae0869a13' then raise exception 'Import authority function differs';end if;
end $$;
set local search_path=public,pg_temp;

-- Person cards may carry their company; they remain distinct from the company's
-- own card. Refuse duplicate pre-existing identities rather than merging history.
create unique index learn_customer_card_person_uk
 on customer_cards(tenant_id,person_id) where person_id is not null;
create unique index learn_customer_card_company_uk
 on customer_cards(tenant_id,company_id) where person_id is null and company_id is not null;

create function learn_import_customer_card(p_tenant uuid,p_link uuid)
returns uuid language plpgsql set search_path=public,pg_temp as $$
declare l import_entity_links%rowtype;card uuid;label text;
begin
 if current_setting('transaction_isolation')<>'read committed' then
  raise exception 'Card projection requires a fresh snapshot' using errcode='22023';
 end if;
 if p_tenant is null or p_link is null then
  raise exception 'Company and source link required' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-work-registry',0));
 perform pg_advisory_xact_lock(hashtextextended('learn-roster:'||p_tenant::text,0));
 -- Existing approved identity projection only: this does not approve/import a
 -- file, infer a contact match, or create a person/company from supplied values.
 select * into l from import_entity_links where id=p_link and tenant_id=p_tenant;
 if not found or l.entity_kind<>'customer' or l.entity_table not in ('people','companies') then
  raise exception 'Imported customer link unavailable in company' using errcode='22023';
 end if;
 if not exists(select 1 from tenants where id=p_tenant and status='active') then
  raise exception 'Company access unavailable' using errcode='42501';
 end if;
 if l.entity_table='people' then
  select display_name into label from people where id=l.entity_id and tenant_id=p_tenant;
  if not found then raise exception 'Customer identity unavailable in company' using errcode='23503';end if;
  insert into customer_cards(tenant_id,person_id,title,metadata)
   values(p_tenant,l.entity_id,coalesce(nullif(btrim(label),''),'Imported customer'),
    jsonb_build_object('learn_import_identity',jsonb_build_object('link_id',l.id,'import_id',l.import_id,'source_system',l.source_system)))
   on conflict(tenant_id,person_id) where person_id is not null do nothing
   returning id into card;
  if card is null then select id into card from customer_cards where tenant_id=p_tenant and person_id=l.entity_id;end if;
 else
  select name into label from companies where id=l.entity_id and tenant_id=p_tenant;
  if not found then raise exception 'Customer identity unavailable in company' using errcode='23503';end if;
  insert into customer_cards(tenant_id,company_id,title,metadata)
   values(p_tenant,l.entity_id,coalesce(nullif(btrim(label),''),'Imported customer'),
    jsonb_build_object('learn_import_identity',jsonb_build_object('link_id',l.id,'import_id',l.import_id,'source_system',l.source_system)))
   on conflict(tenant_id,company_id) where person_id is null and company_id is not null do nothing
   returning id into card;
  if card is null then select id into card from customer_cards where tenant_id=p_tenant and company_id=l.entity_id and person_id is null;end if;
 end if;
 if card is null then raise exception 'Card changed during projection; retry' using errcode='40001';end if;
 return card;
end $$;

create function learn_import_customer_card_after_link()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if new.entity_kind='customer' then perform learn_import_customer_card(new.tenant_id,new.id);end if;
 return new;
end $$;
create trigger learn_import_customer_card_after_link
 after insert on import_entity_links for each row
 execute function learn_import_customer_card_after_link();

-- Bounded explicit repair for already imported identities. Private service
-- operation; installation does not run it or modify any retained source row.
create function learn_import_customer_cards_reconcile(p_tenant uuid,p_after uuid default null,p_limit integer default 100)
returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare l record;last_id uuid;seen integer:=0;more boolean;
begin
 if p_tenant is null or p_limit is null or p_limit<1 or p_limit>200 then
  raise exception 'Company and page size 1..200 required' using errcode='22023';
 end if;
 if not exists(select 1 from tenants where id=p_tenant and status='active') then
  raise exception 'Company access unavailable' using errcode='42501';
 end if;
 for l in select id from import_entity_links where tenant_id=p_tenant and entity_kind='customer'
  and (p_after is null or id>p_after) order by id limit p_limit loop
  perform learn_import_customer_card(p_tenant,l.id);last_id:=l.id;seen:=seen+1;
 end loop;
 select exists(select 1 from import_entity_links where tenant_id=p_tenant and entity_kind='customer' and id>last_id) into more;
 return jsonb_build_object('version','learn-import-cards/1','tenant_id',p_tenant,'processed',seen,'next_cursor',case when more then last_id end);
end $$;
revoke all on function learn_import_customer_card(uuid,uuid),learn_import_customer_card_after_link(),learn_import_customer_cards_reconcile(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function learn_import_customer_card(uuid,uuid),learn_import_customer_card_after_link(),learn_import_customer_cards_reconcile(uuid,uuid,integer) to service_role;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref,applied_at) values(current_setting('serviceos.release_source_sha256'),'learn_import_customer_cards_v1','saatxzwxvdvqevbnskxy',clock_timestamp());
commit;
