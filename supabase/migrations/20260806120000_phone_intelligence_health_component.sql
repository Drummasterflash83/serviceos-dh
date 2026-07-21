-- ServiceOS — register the Phone Intelligence health component (additive, idempotent).
--
-- Phone Intelligence health is DISTINCT from phone ingestion ("Calls"): a PI failure
-- must never make ingestion look healthy. The platform-worker/phone-analyse-transcript
-- emit component='phone_intelligence' via serviceos_record_health_check; this row gives
-- the Command Centre a label/category so the sensor surfaces truthfully.
--
-- ROLLBACK:  delete from system_health_components where component = 'phone_intelligence';

insert into system_health_components (component, label, category, sort_order)
values ('phone_intelligence', 'Phone Intelligence', 'intelligence', 65)
on conflict (component) do update
  set label = excluded.label, category = excluded.category, sort_order = excluded.sort_order;
