-- Exact documented derived-field boundaries; retain every original observation.
begin;
create or replace function public.learn_quickbooks_payload_variant(p_entity text,p_before jsonb,p_after jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare a timestamptz;b timestamptz;ignored text[];field text;begin
 if jsonb_typeof(p_before) is distinct from 'object' or jsonb_typeof(p_after) is distinct from 'object' then return false;end if;
 if p_before=p_after then return true;end if;
 if p_entity='Invoice' and jsonb_typeof(p_before->'LinkedTxn')='array' and jsonb_typeof(p_after->'LinkedTxn')='array'
  and(p_before-'LinkedTxn')=(p_after-'LinkedTxn') then
  return(select jsonb_agg(x order by x) from jsonb_array_elements(p_before->'LinkedTxn')x)
   is not distinct from(select jsonb_agg(x order by x) from jsonb_array_elements(p_after->'LinkedTxn')x);
 end if;
 if p_entity='Purchase' and jsonb_typeof(p_before->'EntityRef')='object' and jsonb_typeof(p_after->'EntityRef')='object'
  and(p_before-'EntityRef')=(p_after-'EntityRef')
  and((p_before->'EntityRef')-'name')=((p_after->'EntityRef')-'name')
  and jsonb_typeof(p_before#>'{EntityRef,value}')='string' and nullif(p_before#>>'{EntityRef,value}','') is not null
  and(not(p_before->'EntityRef'?'name') or jsonb_typeof(p_before#>'{EntityRef,name}')='string')
  and(not(p_after->'EntityRef'?'name') or jsonb_typeof(p_after#>'{EntityRef,name}')='string') then return true;end if;
 ignored:=case p_entity when 'Customer' then array['Balance','BalanceWithJobs'] when 'Vendor' then array['Balance'] when 'Account' then array['CurrentBalance','CurrentBalanceWithSubAccounts'] end;
 if ignored is null then return false;end if;
 if(p_before-(ignored||array['MetaData']))<>(p_after-(ignored||array['MetaData']))
  or jsonb_typeof(p_before->'MetaData') is distinct from 'object' or jsonb_typeof(p_after->'MetaData') is distinct from 'object'
  or((p_before->'MetaData')-'LastUpdatedTime')<>((p_after->'MetaData')-'LastUpdatedTime')
  or jsonb_typeof(p_before#>'{MetaData,LastUpdatedTime}') is distinct from 'string' or jsonb_typeof(p_after#>'{MetaData,LastUpdatedTime}') is distinct from 'string' then return false;end if;
 foreach field in array ignored loop
  if coalesce(jsonb_typeof(p_before->field),'missing') not in('number','missing') or coalesce(jsonb_typeof(p_after->field),'missing') not in('number','missing') then return false;end if;
 end loop;
 if(p_before#>>'{MetaData,LastUpdatedTime}')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
  or(p_after#>>'{MetaData,LastUpdatedTime}')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then return false;end if;
 a:=(p_before#>>'{MetaData,LastUpdatedTime}')::timestamptz;b:=(p_after#>>'{MetaData,LastUpdatedTime}')::timestamptz;
 return isfinite(a) and isfinite(b) and a<>b;
exception when invalid_datetime_format or datetime_field_overflow then return false;
end $$;
commit;
