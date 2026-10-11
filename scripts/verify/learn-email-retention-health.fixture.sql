-- Disposable database only. The actual source schema is tested separately against TEST.
create table email_messages(id uuid primary key,tenant_id uuid,provider text,raw_payload jsonb);
create table learn_email_source_versions(id uuid primary key,tenant_id uuid,source_row jsonb);
insert into email_messages values
 (fixture_id(1101),fixture_id(100),'gmail',jsonb_build_object('provider_account_id',fixture_id(301),'provider_availability','available','provider_observed_history_id','200','body','PRIVATE_MESSAGE')),
 (fixture_id(1102),fixture_id(100),'gmail',jsonb_build_object('provider_account_id',fixture_id(301),'provider_availability','unavailable','provider_observed_history_id','201')),
 (fixture_id(1103),fixture_id(100),'gmail','{}'),
 (fixture_id(1104),fixture_id(100),'gmail',jsonb_build_object('provider_account_id',fixture_id(302),'provider_availability','available','provider_observed_history_id','200')),
 (fixture_id(1105),fixture_id(100),'gmail',jsonb_build_object('provider_account_id',fixture_id(301),'provider_availability','available','provider_observed_history_id','18446744073709551616')),
 (fixture_id(1106),fixture_id(100),'gmail',jsonb_build_object('provider_account_id',fixture_id(301),'provider_availability','available','provider_observed_history_id',200)),
 (fixture_id(1107),fixture_id(101),'gmail',jsonb_build_object('provider_account_id',fixture_id(302),'provider_availability','unavailable','provider_observed_history_id','200'));
insert into learn_email_source_versions values
 (fixture_id(1111),fixture_id(100),'{"body":"PRIVATE_OLD_MESSAGE"}'),
 (fixture_id(1112),fixture_id(101),'{"body":"PRIVATE_FOREIGN_MESSAGE"}');
