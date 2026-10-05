-- ServiceOS — distinguish Gmail (OAuth) from Google Workspace in health (additive).
--
-- The email_sync component conflated Workspace (service-account) and Heidi's personal
-- Gmail OAuth. A Gmail reconnect condition must NOT make the email tile look healthy.
-- This relabels email_sync → "Google Workspace" and registers a distinct email_gmail
-- component. The worker maps email.gmail_sync → email_gmail (see system_health.ts);
-- takes full effect on the next platform-worker deploy.
--
-- ROLLBACK:
--   delete from system_health_components where component = 'email_gmail';
--   update system_health_components set label = 'Email' where component = 'email_sync';

update system_health_components set label = 'Google Workspace' where component = 'email_sync';

insert into system_health_components (component, label, category, sort_order)
values ('email_gmail', 'Gmail (OAuth)', 'ingestion', 25)
on conflict (component) do update
  set label = excluded.label, category = excluded.category, sort_order = excluded.sort_order;
