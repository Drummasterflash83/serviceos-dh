-- Keep the reviewed customer summary byte-for-byte equivalent while letting
-- PostgreSQL inline the pure text extraction used by the broad source reader.
-- The review/write contract continues to use its original helper unchanged.
begin;
create function public.learn_imported_customer_text(p_value jsonb,p_path text[])
returns text language sql immutable as $$
 select case when pg_catalog.jsonb_typeof(p_value#>p_path)='string'
  then nullif(pg_catalog.left(pg_catalog.btrim(p_value#>>p_path),1000),'') end;
$$;
create function public.learn_imported_customer_summary(p_value jsonb)
returns jsonb language sql immutable as $$
 select pg_catalog.jsonb_build_object(
  'person_name',nullif(pg_catalog.concat_ws(' ',
    public.learn_imported_customer_text(p_value,array['contact','firstName']),
    public.learn_imported_customer_text(p_value,array['contact','lastName'])),''),
  'company_name',public.learn_imported_customer_text(p_value,array['companyName']),
  'email',public.learn_imported_customer_text(p_value,array['contact','email']),
  'phone',coalesce(public.learn_imported_customer_text(p_value,array['contact','telephone']),
    public.learn_imported_customer_text(p_value,array['contact','mobile'])),
  'address',nullif(pg_catalog.concat_ws(', ',
    public.learn_imported_customer_text(p_value,array['addressLine1']),
    public.learn_imported_customer_text(p_value,array['addressLine2']),
    public.learn_imported_customer_text(p_value,array['addressLine3']),
    public.learn_imported_customer_text(p_value,array['town']),
    public.learn_imported_customer_text(p_value,array['province'])),''),
  'postcode',public.learn_imported_customer_text(p_value,array['postcode']),
  'source_type',public.learn_imported_customer_text(p_value,array['type']),
  'customer_type',case when pg_catalog.jsonb_typeof(p_value->'customerType') in ('number','string')
    then pg_catalog.left(p_value->>'customerType',100) end);
$$;
revoke all on function public.learn_imported_customer_text(jsonb,text[]),
 public.learn_imported_customer_summary(jsonb) from public,anon,authenticated,service_role;
do $$declare definition text;needle text:='public.learn_business_customer_summary';begin
 definition:=pg_catalog.pg_get_functiondef('public.learn_imported_customer_sources(uuid,text)'::regprocedure);
 if (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,needle,'')))
    <>3*pg_catalog.length(needle) then raise exception 'imported_customer_summary_contract_changed';end if;
 execute pg_catalog.replace(definition,needle,'public.learn_imported_customer_summary');
end $$;
commit;
