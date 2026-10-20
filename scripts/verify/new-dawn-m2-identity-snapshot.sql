-- Read-only, transaction-consistent, private JSONL source for the offline
-- staged-identity manifest generator. Invoke with psql -XAtq -v tenant_id=...
-- -v connection_id=... and redirect stdout to a mode-0600 ignored file.
-- Do not paste its raw output into a PR, log, chat or terminal transcript.
begin isolation level repeatable read read only;
set local statement_timeout='120s';

select jsonb_build_object('kind','scope','tenant_id',:'tenant_id'::uuid,
 'connection_id',:'connection_id'::uuid);

select jsonb_build_object('kind','source_version','collection',v.collection,
 'external_id',v.external_id,'version_id',v.id,
 'source',jsonb_build_object('id',v.payload->'id',
  'type',v.payload->'type','customerType',v.payload->'customerType',
  'companyName',v.payload->'companyName',
  'firstName',v.payload->'contact'->'firstName',
  'lastName',v.payload->'contact'->'lastName',
  'addressLine1',v.payload->'addressLine1',
  'postcode',v.payload->'postcode',
  'parentPropertyID',v.payload->'parentPropertyID',
  'propertyID',v.payload->'propertyID'))
from public.learn_business_input_versions v
where v.tenant_id=:'tenant_id'::uuid and v.connection_id=:'connection_id'::uuid
 and v.provider='commusoft' and v.collection in ('properties','jobs');

select jsonb_build_object('kind','source_observation',
 'collection',v.collection,'external_id',v.external_id,
 'version_id',v.id,'committed_at',p.committed_at)
from public.learn_business_input_observations o
join public.learn_business_input_versions v on v.id=o.version_id
join public.learn_business_input_pages p on p.id=o.page_id
 and p.tenant_id=v.tenant_id and p.connection_id=v.connection_id
 and p.provider=v.provider and p.collection=v.collection
where v.tenant_id=:'tenant_id'::uuid and v.connection_id=:'connection_id'::uuid
 and v.provider='commusoft' and v.collection in ('properties','jobs');

select jsonb_build_object('kind','person','name',p.display_name,
 'postcode',p.postcode) from public.people p
where p.tenant_id=:'tenant_id'::uuid;
select jsonb_build_object('kind','company','name',c.name,
 'postcode',c.postcode) from public.companies c
where c.tenant_id=:'tenant_id'::uuid;
select jsonb_build_object('kind','site','source_system',s.source_system,
 'external_id',s.external_id,'postcode',s.postcode)
from public.sites s where s.tenant_id=:'tenant_id'::uuid;
select jsonb_build_object('kind','job','source_system',j.source_system,
 'external_id',j.external_id)
from public.jobs j where j.tenant_id=:'tenant_id'::uuid;
select jsonb_build_object('kind','link','collection',l.collection,
 'external_id',l.external_id,'entity_kind',l.entity_kind,
 'current',cl.id is not null)
from public.learn_business_input_links l
left join public.learn_business_input_current_links cl on cl.id=l.id
where l.tenant_id=:'tenant_id'::uuid and l.connection_id=:'connection_id'::uuid
 and l.provider='commusoft';
select jsonb_build_object('kind','legacy_link','entity_kind',l.entity_kind,
 'external_id',l.external_id)
from public.import_entity_links l
where l.tenant_id=:'tenant_id'::uuid and l.source_system='commusoft';
select jsonb_build_object('kind','end','tenant_id',:'tenant_id'::uuid,
 'connection_id',:'connection_id'::uuid);
commit;
