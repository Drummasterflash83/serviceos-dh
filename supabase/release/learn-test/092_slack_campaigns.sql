-- TEST 092 only: durable Slack campaigns and controller; no secrets or capture activation.
begin;
set local search_path=public,pg_catalog;set local lock_timeout='3s';set local statement_timeout='30s';
lock table of_test_deploy.migrations in share row exclusive mode;
do $$begin
 if current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'')!~'^[a-f0-9]{64}$'
 or (select md5(coalesce(string_agg(jsonb_build_object('definition',pg_get_functiondef(p.oid),'owner',r.rolname,'acl',p.proacl)::text,'' order by p.proname,pg_get_function_identity_arguments(p.oid)),'')) fingerprint from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname='public' and p.prokind in('f','p')) is distinct from '261ca773281cbf90cb3239c1f076e0b6'
 or (select ((select count(*) from public.platform_jobs where status='running' or (job_type in ('slack.history_sync','slack.thread_sync') and status in ('queued','retrying'))) + (select count(*) from public.slack_recurring_channels where enabled))::int active)<>0 or not (select to_regclass('public.slack_history_campaigns') is null and to_regprocedure('public.learn_slack_campaign_dispatch(uuid,uuid,uuid,text,jsonb,text)') is null and to_regprocedure('public.learn_slack_control_access(uuid,boolean,text)') is not null and not exists(select 1 from of_test_deploy.migrations where migration_name='learn_slack_campaigns_v1') absent) then raise exception 'Slack campaign TEST release precondition changed';end if;
end$$;
create temporary table slack_campaign_preserved on commit drop as select 'auth.identities' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from auth.identities s union all select 'auth.users' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from auth.users s union all select 'public.audit_logs' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.audit_logs s union all select 'public.authority_grants' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.authority_grants s union all select 'public.authority_permissions' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.authority_permissions s union all select 'public.call_directions' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.call_directions s union all select 'public.call_participants' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.call_participants s union all select 'public.call_transcript_normalisations' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.call_transcript_normalisations s union all select 'public.client_delivery_updates' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.client_delivery_updates s union all select 'public.client_notification_outbox' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.client_notification_outbox s union all select 'public.client_portal_access' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.client_portal_access s union all select 'public.client_programme_notes' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.client_programme_notes s union all select 'public.client_programme_revisions' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.client_programme_revisions s union all select 'public.client_programmes' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.client_programmes s union all select 'public.communication_endpoints' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.communication_endpoints s union all select 'public.companies' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.companies s union all select 'public.config_versions' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.config_versions s union all select 'public.connector_accounts' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.connector_accounts s union all select 'public.contact_points' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.contact_points s union all select 'public.contribution_states' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.contribution_states s union all select 'public.controlplane_change_log' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.controlplane_change_log s union all select 'public.corrections' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.corrections s union all select 'public.customer_cards' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.customer_cards s union all select 'public.data_imports' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.data_imports s union all select 'public.decision_destinations' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.decision_destinations s union all select 'public.decision_log' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.decision_log s union all select 'public.decision_owner_kinds' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.decision_owner_kinds s union all select 'public.domain_entity_types' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.domain_entity_types s union all select 'public.domain_object_types' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.domain_object_types s union all select 'public.effective_profiles' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.effective_profiles s union all select 'public.email_accounts' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.email_accounts s union all select 'public.email_ai_insights' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.email_ai_insights s union all select 'public.email_attachments' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.email_attachments s union all select 'public.email_ingestion_checkpoints' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.email_ingestion_checkpoints s union all select 'public.email_ingestion_transitions' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.email_ingestion_transitions s union all select 'public.email_messages' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.email_messages s union all select 'public.email_oauth_tokens' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.email_oauth_tokens s union all select 'public.email_sync_runs' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.email_sync_runs s union all select 'public.email_threads' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.email_threads s union all select 'public.endpoint_identity_reviews' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.endpoint_identity_reviews s union all select 'public.endpoint_ownership_assignments' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.endpoint_ownership_assignments s union all select 'public.feature_flags' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.feature_flags s union all select 'public.google_workspace_connections' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.google_workspace_connections s union all select 'public.google_workspace_mailboxes' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.google_workspace_mailboxes s union all select 'public.graph_edges' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.graph_edges s union all select 'public.graph_events' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.graph_events s union all select 'public.graph_nodes' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.graph_nodes s union all select 'public.health_objects' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.health_objects s union all select 'public.health_subject_types' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.health_subject_types s union all select 'public.health_types' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.health_types s union all select 'public.import_conflicts' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.import_conflicts s union all select 'public.import_entity_links' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.import_entity_links s union all select 'public.import_profiles' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.import_profiles s union all select 'public.import_row_provenance' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.import_row_provenance s union all select 'public.import_row_results' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.import_row_results s union all select 'public.intelligence_ingestions' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.intelligence_ingestions s union all select 'public.intelligence_objects' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.intelligence_objects s union all select 'public.interaction_match_suggestions' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.interaction_match_suggestions s union all select 'public.interactions' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.interactions s union all select 'public.job_number_aliases' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.job_number_aliases s union all select 'public.jobs' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.jobs s union all select 'public.learn_assessment_cancellations' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_assessment_cancellations s union all select 'public.learn_assessments' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_assessments s union all select 'public.learn_business_input_links' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_business_input_links s union all select 'public.learn_business_input_observations' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_business_input_observations s union all select 'public.learn_business_input_pages' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_business_input_pages s union all select 'public.learn_business_input_projection_attempts' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_business_input_projection_attempts s union all select 'public.learn_business_input_projection_batches' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_business_input_projection_batches s union all select 'public.learn_business_input_request_gates' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_business_input_request_gates s union all select 'public.learn_business_input_request_permits' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_business_input_request_permits s union all select 'public.learn_business_input_versions' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_business_input_versions s union all select 'public.learn_capture_control_requests' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_capture_control_requests s union all select 'public.learn_commusoft_connection_requests' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_commusoft_connection_requests s union all select 'public.learn_commusoft_contact_targets' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_commusoft_contact_targets s union all select 'public.learn_commusoft_recurring' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_commusoft_recurring s union all select 'public.learn_commusoft_recurring_requests' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_commusoft_recurring_requests s union all select 'public.learn_commusoft_recurring_steps' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_commusoft_recurring_steps s union all select 'public.learn_commusoft_verification_permits' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_commusoft_verification_permits s union all select 'public.learn_commusoft_verification_requests' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_commusoft_verification_requests s union all select 'public.learn_commusoft_verification_results' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_commusoft_verification_results s union all select 'public.learn_correction_cancellations' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_correction_cancellations s union all select 'public.learn_email_job_attempts' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_email_job_attempts s union all select 'public.learn_email_source_versions' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_email_source_versions s union all select 'public.learn_email_transition_requests' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_email_transition_requests s union all select 'public.learn_email_transition_settlements' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_email_transition_settlements s union all select 'public.learn_identity_delivery_receipts' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_identity_delivery_receipts s union all select 'public.learn_identity_operator_reviews' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_identity_operator_reviews s union all select 'public.learn_interaction_projection_receipts' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_interaction_projection_receipts s union all select 'public.learn_member_history' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_member_history s union all select 'public.learn_microsoft_capture_streams' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_microsoft_capture_streams s union all select 'public.learn_microsoft_discovery_rounds' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_microsoft_discovery_rounds s union all select 'public.learn_microsoft_folder_dispatches' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_microsoft_folder_dispatches s union all select 'public.learn_microsoft_job_completions' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_microsoft_job_completions s union all select 'public.learn_microsoft_job_stops' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_microsoft_job_stops s union all select 'public.learn_microsoft_mailbox_bindings' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_microsoft_mailbox_bindings s union all select 'public.learn_microsoft_projection_receipts' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_microsoft_projection_receipts s union all select 'public.learn_microsoft_source_pages' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_microsoft_source_pages s union all select 'public.learn_observation_receipts' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_observation_receipts s union all select 'public.learn_operator_input_requests' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_operator_input_requests s union all select 'public.learn_performance_corrections' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_performance_corrections s union all select 'public.learn_performance_reviews' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_performance_reviews s union all select 'public.learn_phone_capture_pages' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_phone_capture_pages s union all select 'public.learn_phone_handoff_receipts' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_phone_handoff_receipts s union all select 'public.learn_phone_import_completions' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_phone_import_completions s union all select 'public.learn_phone_operator_reconciliations' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_phone_operator_reconciliations s union all select 'public.learn_phone_playback_audit' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_phone_playback_audit s union all select 'public.learn_phone_processing_attempts' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_phone_processing_attempts s union all select 'public.learn_phone_result_versions' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_phone_result_versions s union all select 'public.learn_phone_schedule_settlements' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_phone_schedule_settlements s union all select 'public.learn_processing_publications' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_processing_publications s union all select 'public.learn_processing_settlements' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_processing_settlements s union all select 'public.learn_projection_operator_reviews' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_projection_operator_reviews s union all select 'public.learn_scorecard_publications' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_scorecard_publications s union all select 'public.learn_slack_connection_requests' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_slack_connection_requests s union all select 'public.learn_slack_context_reviews' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_slack_context_reviews s union all select 'public.learn_team_work_measurement_runs' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_team_work_measurement_runs s union all select 'public.learn_work_calendar_cancellations' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_work_calendar_cancellations s union all select 'public.learn_work_calendar_publications' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_work_calendar_publications s union all select 'public.learn_work_calendar_versions' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_work_calendar_versions s union all select 'public.learn_work_collection_items' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_work_collection_items s union all select 'public.learn_work_collection_runs' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_work_collection_runs s union all select 'public.learn_work_delay_cancellations' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_work_delay_cancellations s union all select 'public.learn_work_delay_events' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_work_delay_events s union all select 'public.learn_work_measurement_runs' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_work_measurement_runs s union all select 'public.learn_working_collection_items' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_working_collection_items s union all select 'public.learn_working_collection_runs' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_working_collection_runs s union all select 'public.measurements' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.measurements s union all select 'public.member_integration_identities' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.member_integration_identities s union all select 'public.metric_definitions' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.metric_definitions s union all select 'public.metric_directions' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.metric_directions s union all select 'public.object_classes' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.object_classes s union all select 'public.object_state_history' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.object_state_history s union all select 'public.objective_constraints' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.objective_constraints s union all select 'public.objective_health' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.objective_health s union all select 'public.objective_health_statuses' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.objective_health_statuses s union all select 'public.objective_link_relations' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.objective_link_relations s union all select 'public.objective_links' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.objective_links s union all select 'public.objective_metrics' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.objective_metrics s union all select 'public.objective_reason_codes' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.objective_reason_codes s union all select 'public.objective_statuses' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.objective_statuses s union all select 'public.objective_types' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.objective_types s union all select 'public.objective_verification_states' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.objective_verification_states s union all select 'public.objectives' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.objectives s union all select 'public.operating_profile_entries' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.operating_profile_entries s union all select 'public.org_unit_members' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.org_unit_members s union all select 'public.org_units' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.org_units s union all select 'public.ownership_assignments' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.ownership_assignments s union all select 'public.people' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.people s union all select 'public.phone_accounts' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.phone_accounts s union all select 'public.phone_ai_insights' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.phone_ai_insights s union all select 'public.phone_calls' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.phone_calls s union all select 'public.phone_endpoints' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.phone_endpoints s union all select 'public.phone_recordings' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.phone_recordings s union all select 'public.phone_sync_runs' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.phone_sync_runs s union all select 'public.phone_transcripts' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.phone_transcripts s union all select 'public.platform_authority_grants' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.platform_authority_grants s union all select 'public.platform_events' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.platform_events s union all select 'public.platform_jobs' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.platform_jobs s union all select 'public.policies' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.policies s union all select 'public.profiles' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.profiles s union all select 'public.provider_connection_events' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.provider_connection_events s union all select 'public.provider_connections' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.provider_connections s union all select 'public.reason_codes' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.reason_codes s union all select 'public.receptionist_access' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.receptionist_access s union all select 'public.receptionist_feedback' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.receptionist_feedback s union all select 'public.receptionist_mailbox_managers' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.receptionist_mailbox_managers s union all select 'public.receptionist_mailboxes' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.receptionist_mailboxes s union all select 'public.receptionist_voicemail_access_log' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.receptionist_voicemail_access_log s union all select 'public.receptionist_voicemail_candidates' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.receptionist_voicemail_candidates s union all select 'public.receptionist_voicemail_dispatch_receipts' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.receptionist_voicemail_dispatch_receipts s union all select 'public.receptionist_voicemail_email_routes' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.receptionist_voicemail_email_routes s union all select 'public.receptionist_voicemail_intakes' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.receptionist_voicemail_intakes s union all select 'public.receptionist_voicemail_job_receipts' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.receptionist_voicemail_job_receipts s union all select 'public.receptionist_voicemail_jobs' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.receptionist_voicemail_jobs s union all select 'public.receptionist_voicemail_scan_receipts' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.receptionist_voicemail_scan_receipts s union all select 'public.receptionist_voicemail_scans' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.receptionist_voicemail_scans s union all select 'public.receptionist_voicemail_sources' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.receptionist_voicemail_sources s union all select 'public.receptionist_voicemails' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.receptionist_voicemails s union all select 'public.receptionist_workspaces' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.receptionist_workspaces s union all select 'public.recommendations' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.recommendations s union all select 'public.responsibility_assignments' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.responsibility_assignments s union all select 'public.responsibility_handoffs' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.responsibility_handoffs s union all select 'public.review_tasks' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.review_tasks s union all select 'public.sites' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.sites s union all select 'public.slack_history_imports' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.slack_history_imports s union all select 'public.slack_message_versions' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.slack_message_versions s union all select 'public.slack_messages' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.slack_messages s union all select 'public.slack_recurring_channels' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.slack_recurring_channels s union all select 'public.slack_recurring_requests' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.slack_recurring_requests s union all select 'public.slack_recurring_thread_members' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.slack_recurring_thread_members s union all select 'public.slack_recurring_thread_windows' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.slack_recurring_thread_windows s union all select 'public.slack_thread_imports' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.slack_thread_imports s union all select 'public.slack_workspace_pacing' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.slack_workspace_pacing s union all select 'public.state_definitions' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.state_definitions s union all select 'public.state_transitions' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.state_transitions s union all select 'public.system_health_checks' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.system_health_checks s union all select 'public.system_health_components' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.system_health_components s union all select 'public.team_members' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.team_members s union all select 'public.telephony_directory' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.telephony_directory s union all select 'public.telephony_inventory' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.telephony_inventory s union all select 'public.tenant_connectors' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.tenant_connectors s union all select 'public.tenant_vocabulary' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.tenant_vocabulary s union all select 'public.tenants' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.tenants s union all select 'public.view_as_context' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.view_as_context s union all select 'storage.buckets' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from storage.buckets s union all select 'storage.buckets_analytics' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from storage.buckets_analytics s union all select 'storage.buckets_vectors' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from storage.buckets_vectors s union all select 'storage.migrations' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from storage.migrations s union all select 'storage.objects' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from storage.objects s union all select 'storage.s3_multipart_uploads' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from storage.s3_multipart_uploads s union all select 'storage.s3_multipart_uploads_parts' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from storage.s3_multipart_uploads_parts s union all select 'storage.vector_indexes' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from storage.vector_indexes s union all select 'vault.secrets' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from vault.secrets s;
-- Fixed historical ranges use the existing paginated channel/reply protocol.
-- The calendar span is not a request budget: each approval still expires in
-- 24 hours and allows at most ten pages of fifteen observations. An unfinished
-- range retains its cursor and requires the existing reviewed recovery action.
-- No credential, scope, job, schedule, source row or permission changes on apply.

do $patch$
declare item record;definition text;
begin
 for item in select * from (values
  ('public.learn_slack_start_import(uuid,uuid,uuid,text,text,timestamptz,timestamptz,integer,text)',
   ' or p_end-p_start>interval ''24 hours''',''),
  ('public.learn_slack_start_thread_import(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,timestamptz,integer,text)',
   ' or p_end-p_start>interval ''24 hours''',''),
  ('public.learn_slack_commit_page_private(uuid,uuid,uuid,jsonb,jsonb,jsonb)',
   '  or (cfg->>''latest'')::numeric-(cfg->>''oldest'')::numeric>86400',''),
  ('public.learn_slack_history_state(uuid,uuid)',
   ' and (cfg->>''latest'')::numeric-(cfg->>''oldest'')::numeric<=86400',''),
  ('public.learn_slack_thread_recovery_state(uuid,uuid)',
   ' and (cfg->>''latest'')::numeric-(cfg->>''oldest'')::numeric<=86400','')
 ) as edits(signature,needle,replacement) loop
  definition:=pg_get_functiondef(item.signature::regprocedure);
  if length(definition)-length(replace(definition,item.needle,''))<>length(item.needle) then
   raise exception 'Reviewed Slack historical range predicate differs: %',item.signature;
  end if;
  definition:=replace(definition,item.needle,item.replacement);
  definition:=replace(definition,'Choose a past window up to 24 hours, a public channel and a reason',
   'Choose a fixed past period, a public channel and a reason');
  execute definition;
 end loop;
end $patch$;

-- Retain channel activity as source/version evidence without publishing it as
-- conversation input. No activation, provider request or existing-row rewrite.

create function public.learn_slack_message_kind(m jsonb) returns text
language plpgsql immutable security invoker set search_path=pg_catalog as $$begin
 if jsonb_typeof(m) is distinct from 'object'
  or (m ? 'type' and m->>'type' is distinct from 'message')
  or (m ? 'hidden' and m->'hidden' is distinct from 'false'::jsonb)
  or (m ? 'subtype' and jsonb_typeof(m->'subtype') is distinct from 'string') then
  raise exception 'slack_history_message_shape_unsupported';end if;
 if not(m ? 'subtype') or m->>'subtype' in
  ('bot_message','thread_broadcast','me_message','file_share','file_comment','file_mention') then return 'conversation';end if;
 if m->>'subtype' in ('channel_archive','channel_unarchive','channel_join','channel_leave',
  'channel_name','channel_purpose','channel_topic','channel_posting_permissions',
  'channel_convert_to_private','channel_convert_to_public','group_archive','group_unarchive',
  'group_join','group_leave','group_name','group_purpose','group_topic','pinned_item','unpinned_item')
  then return 'channel_activity';end if;
 if m->>'subtype'='ekm_access_denied' then raise exception 'slack_history_content_unavailable';end if;
 raise exception 'slack_history_message_subtype_unsupported';
end $$;
revoke all on function public.learn_slack_message_kind(jsonb) from public,anon,authenticated,service_role;

do $$declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.learn_slack_store_records(uuid,jsonb,jsonb,text)'::regprocedure);
 needle:=E'  seen=array_append(seen,r->>''provider_timestamp'');';
 replacement:=$patch$  -- Classify independently in the durable writer, not from worker-supplied labels.
  perform public.learn_slack_message_kind(r->'provider_payload');
  if r->'provider_payload'->>'subtype'='thread_broadcast' and
   (r->>'thread_timestamp' is null or (r->>'thread_timestamp')::numeric >= (r->>'provider_timestamp')::numeric) then
   raise exception 'history_record_invalid';end if;
  -- Refuse a semantic identity change rather than leave an existing conversation
  -- attached to newly classified activity or erase its prior observations.
  if exists(select 1 from public.slack_messages m where m.tenant_id=p_tenant_id
   and m.source_external_id=r->>'source_external_id'
   and public.learn_slack_message_kind(m.provider_payload) <> public.learn_slack_message_kind(r->'provider_payload')) then
   raise exception 'slack_history_message_kind_changed';end if;
  seen=array_append(seen,r->>'provider_timestamp');$patch$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed Slack kind validation differs';end if;
 d:=replace(d,needle,replacement);
 needle:='  -- Reuse the single existing interaction/observation engine.';
 replacement:=$patch$  -- System activity remains in both retained source tables. It is not a customer
  -- conversation, outstanding task or individual-performance observation.
  if public.learn_slack_message_kind(r->'provider_payload')='channel_activity' then continue;end if;
  -- Reuse the single existing interaction/observation engine.$patch$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed Slack activity projection differs';end if;
 d:=replace(d,needle,replacement);
 needle:='''source_version'',version_hash))';
 replacement:=$patch$'source_version',version_hash,'message_kind','conversation',
    'provider_subtype',r->'provider_payload'->>'subtype','file_content','not_downloaded'))$patch$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed Slack content metadata differs';end if;
 execute replace(d,needle,replacement);
end $$;

-- Durable, explicitly authorised public-channel historical campaigns. Applying
-- this migration creates no campaign, job, credential, schedule or provider read.
-- Thread coverage is deliberately unresolved until the thread traversal exists.

create table public.slack_history_campaigns (
 id uuid primary key, tenant_id uuid not null references public.tenants(id),
 connection_id uuid not null references public.provider_connections(id),
 connection_revision timestamptz not null, team_id text not null check(team_id ~ '^T[A-Z0-9]+$'),
 approved_by uuid not null references public.profiles(id), definition jsonb not null,
 starts_at timestamptz not null, ends_at timestamptz not null, expires_at timestamptz not null,
 request_budget integer not null check(request_budget between 9 and 1000000),
 requests_reserved integer not null default 0 check(requests_reserved>=0 and requests_reserved<=request_budget),
 enabled boolean not null default true, revision bigint not null default 1,
 created_at timestamptz not null default clock_timestamp(),
 check(isfinite(starts_at) and isfinite(ends_at) and starts_at>='epoch'::timestamptz and ends_at>starts_at),
 check(isfinite(expires_at)), unique(id,tenant_id)
);
create table public.slack_history_campaign_channels (
 campaign_id uuid not null, tenant_id uuid not null, account_id uuid not null references public.connector_accounts(id),
 channel_id text not null check(channel_id ~ '^C[A-Z0-9]+$'),
 current_import uuid not null references public.slack_history_imports(id),
 state text not null default 'queued', next_check_at timestamptz not null default clock_timestamp(),
 primary key(campaign_id,account_id), unique(campaign_id,channel_id),
 foreign key(campaign_id,tenant_id) references public.slack_history_campaigns(id,tenant_id)
);
create index slack_campaign_channels_due on public.slack_history_campaign_channels(next_check_at,campaign_id,account_id);
create table public.slack_history_campaign_requests (
 id uuid primary key, tenant_id uuid not null references public.tenants(id), actor_id uuid not null references public.profiles(id),
 definition jsonb not null, receipt jsonb not null, created_at timestamptz not null default clock_timestamp()
);
create table public.slack_history_campaign_dispatches (
 campaign_id uuid not null, tenant_id uuid not null,
 job_id uuid not null references public.platform_jobs(id), attempt integer not null check(attempt>0),
 ordinal integer not null check(ordinal between 1 and 9), created_at timestamptz not null default clock_timestamp(),
 primary key(job_id,attempt,ordinal),
 foreign key(campaign_id,tenant_id) references public.slack_history_campaigns(id,tenant_id)
);
do $$declare tab text;begin
 foreach tab in array array['slack_history_campaigns','slack_history_campaign_channels','slack_history_campaign_requests','slack_history_campaign_dispatches'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',tab);
  execute format('create trigger slack_campaign_retain before delete on public.%I for each row execute function public.slack_version_immutable()',tab);
  execute format('create trigger slack_campaign_retain_truncate before truncate on public.%I for each statement execute function public.slack_version_immutable()',tab);
 end loop;
 foreach tab in array array['slack_history_campaign_requests','slack_history_campaign_dispatches'] loop
  execute format('create trigger slack_campaign_immutable before update on public.%I for each row execute function public.slack_version_immutable()',tab);
 end loop;
end$$;
create function public.learn_slack_campaign_immutable() returns trigger language plpgsql set search_path=pg_catalog as $$begin
 if tg_table_name='slack_history_campaigns' then
  if to_jsonb(old)-array['requests_reserved','enabled','revision'] is distinct from to_jsonb(new)-array['requests_reserved','enabled','revision']
   or new.requests_reserved<old.requests_reserved or new.revision<old.revision then raise exception 'Campaign approval is immutable' using errcode='55000';end if;
 else
  if to_jsonb(old)-array['current_import','state','next_check_at'] is distinct from to_jsonb(new)-array['current_import','state','next_check_at'] then
   raise exception 'Campaign channel identity is immutable' using errcode='55000';end if;
 end if;
 return new;
end$$;
revoke all on function public.learn_slack_campaign_immutable() from public,anon,authenticated,service_role;
create trigger slack_campaign_approval_immutable before update on public.slack_history_campaigns for each row execute function public.learn_slack_campaign_immutable();
create trigger slack_campaign_channel_immutable before update on public.slack_history_campaign_channels for each row execute function public.learn_slack_campaign_immutable();

create function public.learn_slack_campaign_authority(p_campaign uuid) returns boolean
language sql volatile security definer set search_path=pg_catalog as $$
 select coalesce(exists(select 1 from public.slack_history_campaigns h
 join public.provider_connections c on c.id=h.connection_id and c.tenant_id=h.tenant_id
 join public.profiles p on p.id=h.approved_by
 where h.id=p_campaign and h.enabled and h.expires_at>clock_timestamp()
 and c.provider='slack' and c.status='configured' and c.revoked_at is null and c.updated_at=h.connection_revision
 and c.non_secret_config->>'team_id'=h.team_id
 and public.learn_slack_credential_field(c.non_secret_config)=any(c.configured_fields)
 and c.secret_refs->>public.learn_slack_credential_field(c.non_secret_config) is not null
 and public.learn_capture_allowed(h.tenant_id,'slack')
 and ((p.tenant_id=h.tenant_id and p.role in ('owner','admin')) or exists(select 1 from public.platform_authority_grants g
 where g.profile_id=p.id and g.permission='platform.controlplane.admin'
 and coalesce(g.effective_from,'-infinity')<=clock_timestamp() and coalesce(g.effective_to,'infinity')>clock_timestamp()))),false);
$$;
revoke all on function public.learn_slack_campaign_authority(uuid) from public,anon,authenticated,service_role;

-- Legacy windows retain their existing checks. A campaign binding must also
-- match its frozen channel, source window, current approval and credential.
create function public.learn_slack_campaign_job_allowed(p_tenant uuid,p_job uuid) returns boolean
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;a public.connector_accounts%rowtype;cfg jsonb;h public.slack_history_campaigns%rowtype;begin
 if auth.role() is distinct from 'service_role' then return false;end if;
 select * into j from public.platform_jobs where id=p_job and tenant_id=p_tenant and job_type in ('slack.history_sync','slack.thread_sync');
 if not found then return false;end if;
 select * into a from public.connector_accounts where id::text=j.payload->>'connector_account_id' and tenant_id=p_tenant;
 if not found then return false;end if;
 cfg:=a.settings->'slack_history';
 if not coalesce(cfg ? 'campaignId',false) then return true;end if;
 -- Campaign thread traversal will supply its own scoped approval/member contract.
 -- Do not borrow a channel campaign to authorise a manual or unrelated reply job.
 if j.job_type<>'slack.history_sync' then return false;end if;
 select * into h from public.slack_history_campaigns where id::text=cfg->>'campaignId' and tenant_id=p_tenant;
 if not found or not public.learn_slack_campaign_authority(h.id) then return false;end if;
 return coalesce(a.status='active' and cfg->'approved'='true'::jsonb and cfg->>'teamId'=h.team_id
 and cfg->>'connectionId'=h.connection_id::text
 and (cfg->>'oldest')::numeric=extract(epoch from h.starts_at) and (cfg->>'latest')::numeric=extract(epoch from h.ends_at)
 and exists(select 1 from public.slack_history_campaign_channels m join public.slack_history_imports i on i.id=m.current_import
 where m.campaign_id=h.id and m.tenant_id=p_tenant and m.account_id=a.id and m.channel_id=cfg->>'channelId'
 and cfg->>'consentReference'='learn-slack-import:'||i.id::text and i.tenant_id=p_tenant and i.account_id=a.id)
 and exists(select 1 from public.tenant_connectors tc where tc.id=a.tenant_connector_id and tc.tenant_id=p_tenant
 and tc.connector_id='slack' and tc.enabled and tc.status='active'),false);
end$$;
revoke all on function public.learn_slack_campaign_job_allowed(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_slack_campaign_job_allowed(uuid,uuid) to service_role;

create function public.learn_slack_campaign_claim_allowed(p_tenant uuid,p_job uuid) returns boolean
language sql volatile security definer set search_path=pg_catalog as $$
 select public.learn_slack_campaign_job_allowed(p_tenant,p_job) and not exists(
  select 1 from public.platform_jobs j join public.connector_accounts a on a.id::text=j.payload->>'connector_account_id' and a.tenant_id=j.tenant_id
  join public.slack_history_campaigns h on h.id::text=a.settings->'slack_history'->>'campaignId' and h.tenant_id=a.tenant_id
  where j.id=p_job and j.tenant_id=p_tenant and h.requests_reserved>=h.request_budget);
$$;
revoke all on function public.learn_slack_campaign_claim_allowed(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_slack_campaign_claim_allowed(uuid,uuid) to service_role;

-- One reservation per actual provider dispatch, including auth/info/retries.
-- A lost acknowledgement can consume budget without a request: never refund or
-- reuse it on uncertainty. Re-acquiring a lease cannot reset its nine-request cap.
create function public.learn_slack_campaign_reserve_request(p_tenant uuid,p_job uuid,p_claimed_by text,p_attempt integer,p_ordinal integer)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;h public.slack_history_campaigns%rowtype;campaign text;begin
 if auth.role() is distinct from 'service_role' then raise exception 'slack_campaign_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' or p_ordinal is null or p_ordinal not between 1 and 9 then
  raise exception 'slack_campaign_request_invalid' using errcode='22023';end if;
 select * into j from public.platform_jobs where id=p_job and tenant_id=p_tenant for update;
 if not found or j.status<>'running' or j.claimed_by is distinct from p_claimed_by or p_claimed_by is null
 or j.attempt_count is distinct from p_attempt or p_attempt is null or j.lease_expires_at is null
 or j.lease_expires_at<=clock_timestamp() or coalesce(j.metadata,'{}') ? 'slack_page_v1'
 or not public.learn_slack_campaign_job_allowed(p_tenant,p_job) then return false;end if;
 select a.settings->'slack_history'->>'campaignId' into campaign from public.connector_accounts a
 where a.id::text=j.payload->>'connector_account_id' and a.tenant_id=p_tenant;
 if campaign is null then return true;end if;
 select * into h from public.slack_history_campaigns where id::text=campaign and tenant_id=p_tenant for update;
 if not found or h.requests_reserved>=h.request_budget or not public.learn_slack_campaign_authority(h.id) then return false;end if;
 if exists(select 1 from public.slack_history_campaign_dispatches where job_id=p_job and attempt=p_attempt and ordinal=p_ordinal) then return false;end if;
 insert into public.slack_history_campaign_dispatches(campaign_id,tenant_id,job_id,attempt,ordinal) values(h.id,p_tenant,p_job,p_attempt,p_ordinal);
 update public.slack_history_campaigns set requests_reserved=requests_reserved+1 where id=h.id;
 return true;
end$$;
revoke all on function public.learn_slack_campaign_reserve_request(uuid,uuid,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.learn_slack_campaign_reserve_request(uuid,uuid,text,integer,integer) to service_role;

create function public.learn_slack_campaign_start(p_tenant uuid,p_request uuid,p_definition jsonb,p_mode text default 'apply') returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare prior public.slack_history_campaign_requests%rowtype;c public.provider_connections%rowtype;channel text;
 starts timestamptz;ends timestamptz;expires timestamptz;budget integer;r jsonb;answer jsonb;begin
 perform public.learn_slack_control_access(p_tenant,true,'start_history');
 if current_setting('transaction_isolation')<>'read committed' or p_request is null or p_mode is null or p_mode not in ('apply','check','cancel')
 or jsonb_typeof(p_definition) is distinct from 'object' or octet_length(p_definition::text)>100000
 or not(p_definition ?& array['connectionId','connectionRevision','channelIds','start','end','expiresAt','requestBudget','reason'])
 or p_definition-array['connectionId','connectionRevision','channelIds','start','end','expiresAt','requestBudget','reason']<>'{}'
 or jsonb_typeof(p_definition->'channelIds') is distinct from 'array'
 or jsonb_array_length(p_definition->'channelIds') not between 1 and 500
 or exists(select 1 from jsonb_array_elements(p_definition->'channelIds') v where jsonb_typeof(v) is distinct from 'string' or (v#>>'{}') !~ '^C[A-Z0-9]{1,99}$')
 or (select count(*)<>count(distinct v) from jsonb_array_elements(p_definition->'channelIds') v)
 or jsonb_typeof(p_definition->'reason') is distinct from 'string' or length(btrim(p_definition->>'reason')) not between 1 and 1000
 or jsonb_typeof(p_definition->'requestBudget') is distinct from 'number' or p_definition->>'requestBudget' !~ '^[0-9]+$' then
  raise exception 'slack_campaign_definition_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-work-registry',0));
 perform pg_advisory_xact_lock(hashtextextended('learn-roster:'||p_tenant::text,0));
 perform pg_advisory_xact_lock(hashtextextended('learn-slack-campaign-request:'||p_request::text,0));
 select * into prior from public.slack_history_campaign_requests where id=p_request;
 if found then
  if prior.tenant_id<>p_tenant or prior.actor_id<>auth.uid() or prior.definition<>p_definition then raise exception 'slack_campaign_request_changed' using errcode='PT409';end if;
  return prior.receipt;
 end if;
 answer:=jsonb_build_object('tenantId',p_tenant,'requestId',p_request,'state',case when p_mode='cancel' then 'cancelled' else 'pending' end);
 if p_mode='check' then return answer;end if;
 if p_mode='cancel' then
  insert into public.slack_history_campaign_requests values(p_request,p_tenant,auth.uid(),p_definition,answer,clock_timestamp());return answer;
 end if;
 starts:=(p_definition->>'start')::timestamptz;ends:=(p_definition->>'end')::timestamptz;expires:=(p_definition->>'expiresAt')::timestamptz;
 budget:=(p_definition->>'requestBudget')::integer;
 if starts is null or ends is null or expires is null or not isfinite(starts) or not isfinite(ends) or not isfinite(expires)
 or starts<'epoch'::timestamptz or ends<=starts or ends>clock_timestamp() or expires<=clock_timestamp()
 or expires>clock_timestamp()+interval '30 days' or budget not between 9 and 1000000 then raise exception 'slack_campaign_bounds_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-slack-setup:'||p_tenant::text,0));
 select * into c from public.provider_connections where id=(p_definition->>'connectionId')::uuid and tenant_id=p_tenant for share;
 if not found or c.updated_at is distinct from (p_definition->>'connectionRevision')::timestamptz or c.provider<>'slack'
 or c.status<>'configured' or c.revoked_at is not null then raise exception 'slack_campaign_connection_changed' using errcode='PT409';end if;
 insert into public.slack_history_campaigns(id,tenant_id,connection_id,connection_revision,team_id,approved_by,definition,starts_at,ends_at,expires_at,request_budget)
 values(p_request,p_tenant,c.id,c.updated_at,c.non_secret_config->>'team_id',auth.uid(),p_definition,starts,ends,expires,budget);
 -- Existing logged setup is called as the real authenticated actor. No service
 -- impersonation, new grant, credential or relaxed setup predicate is involved.
 for channel in select jsonb_array_elements_text(p_definition->'channelIds') order by 1 loop
  if exists(select 1 from public.connector_accounts a where a.tenant_id=p_tenant
   and a.account_key=(c.non_secret_config->>'team_id')||':'||channel
   and (exists(select 1 from public.slack_recurring_channels sub where sub.account_id=a.id and sub.enabled)
    or exists(select 1 from public.platform_jobs j where j.tenant_id=p_tenant and j.payload->>'connector_account_id'=a.id::text
     and j.job_type='slack.thread_sync' and j.status in ('queued','retrying','running')))) then
   raise exception 'slack_campaign_competing_capture' using errcode='55000';end if;
  r:=public.learn_slack_start_import(p_tenant,gen_random_uuid(),c.id,c.updated_at::text,channel,starts,ends,10,p_definition->>'reason');
  insert into public.slack_history_campaign_channels(campaign_id,tenant_id,account_id,channel_id,current_import)
   values(p_request,p_tenant,(r->>'accountId')::uuid,channel,(r->>'requestId')::uuid);
  update public.platform_jobs set payload=payload||jsonb_build_object('campaign_id',p_request,'campaign_revision',1) where id=(r->>'jobId')::uuid and tenant_id=p_tenant;
  update public.connector_accounts set settings=jsonb_set(settings,'{slack_history}',settings->'slack_history'||
   jsonb_build_object('campaignId',p_request,'expiresAt',least(expires,clock_timestamp()+interval '24 hours')))
   where id=(r->>'accountId')::uuid and tenant_id=p_tenant;
 end loop;
 answer:=jsonb_build_object('tenantId',p_tenant,'requestId',p_request,'state','recorded','campaignId',p_request,'revision',1);
 insert into public.slack_history_campaign_requests values(p_request,p_tenant,auth.uid(),p_definition,answer,clock_timestamp());
 return answer;
end$$;
revoke all on function public.learn_slack_campaign_start(uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_slack_campaign_start(uuid,uuid,jsonb,text) to authenticated;

create function public.learn_slack_campaign_control(p_tenant uuid,p_request uuid,p_campaign uuid,p_revision bigint,p_enabled boolean,p_reason text,p_mode text default 'apply') returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare prior public.slack_history_campaign_requests%rowtype;h public.slack_history_campaigns%rowtype;d jsonb;r jsonb;begin
 perform public.learn_slack_control_access(p_tenant,true,'resume_history');
 if current_setting('transaction_isolation')<>'read committed' or p_request is null or p_campaign is null or p_revision is null or p_revision<1
 or p_enabled is null or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 or p_mode is null or p_mode not in ('apply','check','cancel') then
 raise exception 'slack_campaign_control_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-work-registry',0));
 perform pg_advisory_xact_lock(hashtextextended('learn-roster:'||p_tenant::text,0));
 perform public.learn_slack_control_access(p_tenant,true,'resume_history');
 d:=jsonb_build_object('campaignId',p_campaign,'revision',p_revision,'enabled',p_enabled,'reason',btrim(p_reason));
 perform pg_advisory_xact_lock(hashtextextended('learn-slack-campaign-request:'||p_request::text,0));
 select * into prior from public.slack_history_campaign_requests where id=p_request;
 if found then
  if prior.tenant_id<>p_tenant or prior.actor_id<>auth.uid() or prior.definition<>d then raise exception 'slack_campaign_request_changed' using errcode='PT409';end if;
  return prior.receipt;
 end if;
 r:=jsonb_build_object('tenantId',p_tenant,'requestId',p_request,'state',case when p_mode='cancel' then 'cancelled' else 'pending' end);
 if p_mode='check' then return r;end if;
 if p_mode='apply' then
  perform pg_advisory_xact_lock(hashtextextended('learn-slack-setup:'||p_tenant::text,0));
  select * into h from public.slack_history_campaigns where id=p_campaign and tenant_id=p_tenant for update;
  if not found or h.revision<>p_revision then raise exception 'slack_campaign_revision_changed' using errcode='PT409';end if;
  if p_enabled and (h.expires_at<=clock_timestamp() or h.requests_reserved>=h.request_budget) then raise exception 'slack_campaign_approval_exhausted' using errcode='55000';end if;
  update public.slack_history_campaigns set enabled=p_enabled,revision=revision+1 where id=h.id returning * into h;
  if p_enabled and not public.learn_slack_campaign_authority(h.id) then raise exception 'slack_campaign_approval_changed' using errcode='55000';end if;
  update public.slack_history_campaign_channels set next_check_at=clock_timestamp() where campaign_id=h.id;
  r:=r||jsonb_build_object('state','recorded','campaignId',h.id,'revision',h.revision,'enabled',h.enabled);
 end if;
 insert into public.slack_history_campaign_requests values(p_request,p_tenant,auth.uid(),d,r,clock_timestamp());return r;
end$$;
revoke all on function public.learn_slack_campaign_control(uuid,uuid,uuid,bigint,boolean,text,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_slack_campaign_control(uuid,uuid,uuid,bigint,boolean,text,text) to authenticated;

create function public.learn_slack_campaign_attribution_allowed(p_table text,r jsonb) returns boolean
language sql volatile security definer set search_path=pg_catalog as $$
 select coalesce(auth.role()='service_role' and p_table='slack_history_imports' and exists(
 select 1 from public.slack_history_campaigns h
 join public.slack_history_campaign_channels m on m.campaign_id=h.id and m.tenant_id=h.tenant_id
 join public.connector_accounts a on a.id=m.account_id and a.tenant_id=h.tenant_id
 join public.platform_jobs j on j.id=(r->>'job_id')::uuid and j.tenant_id=h.tenant_id
 where h.id::text=r->'definition'->>'campaignId' and h.tenant_id::text=r->>'tenant_id'
 and public.learn_slack_campaign_authority(h.id) and h.approved_by::text=r->>'approved_by'
 and a.id::text=r->>'account_id' and r->'definition'->>'resumesImportId'=m.current_import::text
 and r->'definition'->>'connectionId'=h.connection_id::text
 and (r->'definition'->>'connectionRevision')::timestamptz=h.connection_revision
 and (r->'definition'->>'start')::timestamptz=h.starts_at and (r->'definition'->>'end')::timestamptz=h.ends_at
 and r->'definition'->>'channelId'=m.channel_id and r->'definition'->'maxPages'='10'::jsonb
 and a.settings->'slack_history'->>'consentReference'='learn-slack-import:'||(r->>'id')
 and a.settings->'slack_history'->>'campaignId'=h.id::text
 and j.job_type='slack.history_sync' and j.status='queued' and j.created_by=h.approved_by
 and j.payload->>'connector_account_id'=a.id::text and j.payload->>'history_import_id'=r->>'id'),false);
$$;
revoke all on function public.learn_slack_campaign_attribution_allowed(text,jsonb) from public,anon,authenticated,service_role;

do $$declare d text;needle text;begin
 d:=pg_get_functiondef('public.learn_slack_reference_guard()'::regprocedure);
 needle:='   if auth.role() is distinct from ''authenticated'' or auth.uid() is null';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed campaign attribution guard differs';end if;
 execute replace(d,needle,'   if tg_op=''INSERT'' and public.learn_slack_campaign_attribution_allowed(tg_table_name,j) then continue;end if;'||chr(10)||needle);
end$$;

create function public.learn_slack_schedule_campaigns(p_batch integer default 10) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare m public.slack_history_campaign_channels%rowtype;h public.slack_history_campaigns%rowtype;a public.connector_accounts%rowtype;
 state jsonb;cfg jsonb;cp jsonb;scope jsonb;checkpoint jsonb;request_id uuid;job_id uuid;reason text;status text;
 checked integer:=0;queued integer:=0;held integer:=0;begin
 if auth.role() is distinct from 'service_role' then raise exception 'slack_campaign_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' or p_batch is null or p_batch not between 1 and 50 then raise exception 'slack_campaign_batch_invalid' using errcode='22023';end if;
 for m in select c.* from public.slack_history_campaign_channels c join public.slack_history_campaigns header on header.id=c.campaign_id
 where header.enabled and c.next_check_at<=clock_timestamp() and c.state<>'history_captured_threads_pending'
 order by c.next_check_at,c.campaign_id,c.account_id limit p_batch loop
  -- Same order as manual setup/control. Never wait with locks from other tenants.
  if not pg_try_advisory_xact_lock(hashtextextended('learn-slack-setup:'||m.tenant_id::text,0)) then continue;end if;
  select * into h from public.slack_history_campaigns where id=m.campaign_id and enabled for update;
  if not found then continue;end if;
  select * into m from public.slack_history_campaign_channels where campaign_id=m.campaign_id and account_id=m.account_id and next_check_at<=clock_timestamp() for update;
  if not found then continue;end if;
  checked:=checked+1;status:='ready';
  if h.requests_reserved>=h.request_budget then status:='request_budget_exhausted';
  elsif h.expires_at<=clock_timestamp() then status:='approval_expired';
  elsif not public.learn_slack_campaign_authority(h.id) then status:='authority_or_capture_unavailable';end if;
  select * into a from public.connector_accounts where id=m.account_id and tenant_id=m.tenant_id for update;
  if not found then status:='account_unavailable';end if;
  cfg:=a.settings->'slack_history';cp:=a.sync_cursor;
  if status='ready' and (cfg->>'campaignId' is distinct from h.id::text or cfg->>'consentReference' is distinct from 'learn-slack-import:'||m.current_import::text
   or cfg->>'channelId' is distinct from m.channel_id or cfg->>'connectionId' is distinct from h.connection_id::text) then status:='scope_changed';end if;
  if status='ready' then
   state:=public.learn_slack_history_state(m.tenant_id,m.account_id);
   if state->'stateValid' is distinct from 'true'::jsonb or state->'connectionReady' is distinct from 'true'::jsonb then status:='stored_state_unavailable';
   elsif state->'active'='true'::jsonb then status:='window_active';
   elsif cp->'complete'='true'::jsonb then
    if exists(select 1 from public.platform_jobs j where j.tenant_id=m.tenant_id and j.job_type='slack.history_sync' and j.status='succeeded'
     and j.payload->>'connector_account_id'=m.account_id::text and j.metadata->'slack_page_v1'->'next'=cp
     and j.metadata->'slack_page_v1'->>'account_id'=m.account_id::text) then status:='history_captured_threads_pending';
    else status:='completion_unverified';end if;
   elsif not (coalesce(((cp->>'pages')::integer>=(cfg->>'maxPages')::integer and exists(
     select 1 from public.platform_jobs published where published.tenant_id=m.tenant_id and published.job_type='slack.history_sync'
     and published.status='succeeded' and published.payload->>'connector_account_id'=m.account_id::text
     and published.metadata->'slack_page_v1'->'next'=cp
     and published.metadata->'slack_page_v1'->>'account_id'=m.account_id::text)),false)
    or exists(select 1 from public.platform_jobs interrupted where interrupted.id::text=state->'latestJob'->>'id'
     and interrupted.tenant_id=m.tenant_id and interrupted.status in ('failed','dead_letter')
     and interrupted.payload->>'campaign_id'=h.id::text and (interrupted.payload->>'campaign_revision')::bigint<h.revision
     and interrupted.error_code in ('slack_history_campaign_request_unavailable','slack_history_campaign_request_unconfirmed',
       'slack_history_binding_unavailable','slack_history_authority_unavailable'))
    or coalesce(((cfg->>'expiresAt')::timestamptz<=clock_timestamp() and state->'latestJob'->>'status' in ('failed','dead_letter')
     and state->'latestJob'->>'errorCode' in ('slack_history_binding_unavailable','slack_history_authority_unavailable')),false)) then status:='needs_review';
   elsif cp<>'{}'::jsonb and cp->>'cursor' is null and cp->'pages'<>'0'::jsonb then status:='cursor_unavailable';
   else
    request_id:=gen_random_uuid();job_id:=gen_random_uuid();reason:='Continue the recorded historical campaign from its saved cursor';
    scope:=cfg||jsonb_build_object('approved',true,'maxPages',10,'expiresAt',least(h.expires_at,clock_timestamp()+interval '24 hours'),
     'consentReference','learn-slack-import:'||request_id::text);
    checkpoint:=jsonb_build_object('scopeKey',array_to_json(array[m.tenant_id::text,h.team_id,m.channel_id,scope->>'oldest',scope->>'latest',scope->>'consentReference'])::text,
     'cursor',cp->>'cursor','pages',0,'complete',false);
    update public.connector_accounts set settings=settings||jsonb_build_object('slack_history',scope),sync_cursor=checkpoint where id=a.id;
    insert into public.platform_jobs(id,tenant_id,connector_id,job_type,job_key,status,max_attempts,available_at,payload,created_by)
     values(job_id,m.tenant_id,'slack','slack.history_sync','slack.history:'||a.id::text,'queued',5,clock_timestamp(),
      jsonb_build_object('connector_account_id',a.id,'history_import_id',request_id,'campaign_id',h.id,'campaign_revision',h.revision),h.approved_by);
    insert into public.slack_history_imports(id,tenant_id,account_id,job_id,approved_by,definition,previous_state)
     values(request_id,m.tenant_id,a.id,job_id,h.approved_by,jsonb_build_object('campaignId',h.id,'connectionId',h.connection_id,
      'connectionRevision',h.connection_revision,'channelId',m.channel_id,'start',h.starts_at,'end',h.ends_at,'maxPages',10,
      'reason',reason,'resumesImportId',m.current_import),jsonb_build_object('settings',cfg,'checkpoint',cp));
    update public.slack_history_campaign_channels set current_import=request_id where campaign_id=h.id and account_id=a.id;
    queued:=queued+1;status:='window_queued';
   end if;
  end if;
  if status not in ('window_active','window_queued','history_captured_threads_pending') then held:=held+1;end if;
  update public.slack_history_campaign_channels set state=status,next_check_at=clock_timestamp()+interval '60 seconds' where campaign_id=h.id and account_id=m.account_id;
 end loop;
 return jsonb_build_object('checked',checked,'queued',queued,'held',held);
end$$;
revoke all on function public.learn_slack_schedule_campaigns(integer) from public,anon,authenticated,service_role;
grant execute on function public.learn_slack_schedule_campaigns(integer) to service_role;

create function public.learn_slack_campaign_read(p_tenant uuid,p_campaign uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare h public.slack_history_campaigns%rowtype;rows jsonb;begin
 perform public.learn_slack_control_access(p_tenant,false,'history');
 select * into h from public.slack_history_campaigns where id=p_campaign and tenant_id=p_tenant;
 if not found then raise exception 'slack_campaign_unavailable' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('accountId',m.account_id,'channelId',m.channel_id,'approvalId',m.current_import,
 'state',m.state,'pagesThisApproval',a.sync_cursor->'pages','channelPagesComplete',coalesce(a.sync_cursor->'complete','false'::jsonb)) order by m.channel_id),'[]'::jsonb)
 into rows from public.slack_history_campaign_channels m join public.connector_accounts a on a.id=m.account_id and a.tenant_id=m.tenant_id where m.campaign_id=h.id;
 return jsonb_build_object('version','learn-slack-campaign/1','tenantId',p_tenant,'campaignId',h.id,'revision',h.revision,
 'enabled',h.enabled,'start',h.starts_at,'end',h.ends_at,'expiresAt',h.expires_at,'requestBudget',h.request_budget,
 'requestsReserved',h.requests_reserved,'requestAccounting','conservative_dispatch_reservations',
 'threadsComplete',false,'complete',false,'channels',rows);
end$$;
revoke all on function public.learn_slack_campaign_read(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_slack_campaign_read(uuid,uuid) to authenticated;

-- Stop competing manual windows from replacing a durable campaign's scope.
-- Pause and credential revocation remain available; they never discard history.
do $$declare d text;needle text;name text;sig regprocedure;begin
 d:=pg_get_functiondef('public.learn_slack_start_import(uuid,uuid,uuid,text,text,timestamptz,timestamptz,integer,text)'::regprocedure);
 needle:='  if a.status<>''active'' or exists';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed campaign setup fence differs';end if;
 execute replace(d,needle,'  if a.settings->''slack_history'' ? ''campaignId'' then raise exception ''slack_campaign_scope_owned'' using errcode=''55000'';end if;'||chr(10)||needle);
 foreach name in array array['learn_slack_resume_history','learn_slack_start_thread_import'] loop
  select oid::regprocedure into strict sig from pg_proc where pronamespace='public'::regnamespace and proname=name;
  d:=pg_get_functiondef(sig);
  needle:=case when name='learn_slack_resume_history' then ' perform pg_advisory_xact_lock(hashtextextended(''learn-slack-setup:'''
   else ' select * into a from public.connector_accounts' end;
  if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed campaign manual recovery fence differs';end if;
  execute replace(d,needle,' if exists(select 1 from public.connector_accounts where id=p_account_id and tenant_id=p_tenant_id and settings->''slack_history'' ? ''campaignId'') then raise exception ''slack_campaign_scope_owned'' using errcode=''55000'';end if;'||chr(10)||needle);
 end loop;
 d:=pg_get_functiondef('public.learn_slack_resume_thread(uuid,uuid,uuid,text,text,integer,text)'::regprocedure);
 needle:=' state:=public.learn_slack_thread_recovery_state(p_tenant_id,p_import_id);key:=state->>''jobKey'';';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed campaign thread recovery fence differs';end if;
 execute replace(d,needle,' if exists(select 1 from public.connector_accounts where id=t.account_id and tenant_id=p_tenant_id and settings->''slack_history'' ? ''campaignId'') then raise exception ''slack_campaign_scope_owned'' using errcode=''55000'';end if;'||chr(10)||needle);
 d:=pg_get_functiondef('public.learn_slack_recurring_control(uuid,uuid,uuid,bigint,boolean,text,text,uuid)'::regprocedure);
 needle:=' if p_enabled then';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed campaign recurring fence differs';end if;
 execute replace(d,needle,' if p_enabled and a.settings->''slack_history'' ? ''campaignId'' then raise exception ''slack_campaign_scope_owned'' using errcode=''55000'';end if;'||chr(10)||needle);
 -- Claim filtering avoids consuming attempts while paused/revoked. A retained
 -- committed receipt may always settle without another provider dispatch.
 d:=pg_get_functiondef('public.learn_slack_claim_jobs(uuid,integer)'::regprocedure);
 needle:='and public.learn_capture_job_allowed(q.tenant_id,q.job_type,q.metadata)';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed campaign claim scan differs';end if;
 d:=replace(d,needle,needle||chr(10)||'  and (coalesce(q.metadata,''{}'') ? ''slack_page_v1'' or public.learn_slack_campaign_claim_allowed(q.tenant_id,q.id))');
 needle:='if not public.learn_capture_job_allowed(j.tenant_id,j.job_type,j.metadata) then continue;end if;';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed campaign locked claim differs';end if;
 execute replace(d,needle,needle||chr(10)||'  if not(coalesce(j.metadata,''{}'') ? ''slack_page_v1'') and not public.learn_slack_campaign_claim_allowed(j.tenant_id,j.id) then continue;end if;');
 foreach name in array array['learn_slack_read_credential','learn_slack_read_thread_credential'] loop
  select oid::regprocedure into strict sig from pg_proc where pronamespace='public'::regnamespace and proname=name;
  d:=pg_get_functiondef(sig);needle:=' select decrypted_secret into secret';
  if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed campaign credential fence differs';end if;
  execute replace(d,needle,' if not public.learn_slack_campaign_job_allowed(p_tenant_id,p_job_id) then return null;end if;'||chr(10)||needle);
 end loop;
 foreach name in array array['learn_slack_commit_page_private','slack_thread_commit_page'] loop
  select oid::regprocedure into strict sig from pg_proc where pronamespace='public'::regnamespace and proname=name;
  d:=pg_get_functiondef(sig);needle:=' perform public.learn_slack_store_records(';
  if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed campaign publication fence differs';end if;
  execute replace(d,needle,' if not public.learn_slack_campaign_job_allowed(p_tenant_id,p_job_id) then raise exception ''slack_history_authority_unavailable'' using errcode=''42501'';end if;'||chr(10)||needle);
 end loop;
end$$;

-- Observed-thread traversal within a recorded historical campaign. No campaign,
-- job, credential, schedule or provider request is created by installation.

create table public.slack_history_campaign_thread_scans (
 campaign_id uuid not null, account_id uuid not null, tenant_id uuid not null,
 after_parent numeric, discovery_complete boolean not null default false,
 primary key(campaign_id,account_id),
 foreign key(campaign_id,account_id) references public.slack_history_campaign_channels(campaign_id,account_id),
 foreign key(campaign_id,tenant_id) references public.slack_history_campaigns(id,tenant_id)
);
create table public.slack_history_campaign_threads (
 campaign_id uuid not null, account_id uuid not null, tenant_id uuid not null,
 parent_timestamp numeric not null check(parent_timestamp>=0),
 source_message_id uuid not null references public.slack_messages(id), source_version text not null check(source_version ~ '^[a-f0-9]{64}$'),
 current_import uuid references public.slack_thread_imports(id), state text not null default 'observed',
 primary key(campaign_id,account_id,parent_timestamp),
 foreign key(campaign_id,account_id) references public.slack_history_campaign_thread_scans(campaign_id,account_id),
 foreign key(campaign_id,tenant_id) references public.slack_history_campaigns(id,tenant_id)
);
do $$declare tab text;begin
 foreach tab in array array['slack_history_campaign_thread_scans','slack_history_campaign_threads'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',tab);
  execute format('create trigger slack_campaign_thread_retain before delete on public.%I for each row execute function public.slack_version_immutable()',tab);
  execute format('create trigger slack_campaign_thread_retain_truncate before truncate on public.%I for each statement execute function public.slack_version_immutable()',tab);
 end loop;
end$$;
create function public.learn_slack_campaign_thread_immutable() returns trigger language plpgsql set search_path=pg_catalog as $$begin
 if tg_table_name='slack_history_campaign_thread_scans' then
  if to_jsonb(old)-array['after_parent','discovery_complete'] is distinct from to_jsonb(new)-array['after_parent','discovery_complete']
   or (old.discovery_complete and not new.discovery_complete)
   or (old.after_parent is not null and (new.after_parent is null or new.after_parent<old.after_parent)) then
   raise exception 'Campaign thread discovery cannot regress' using errcode='55000';end if;
 else
  if to_jsonb(old)-array['current_import','state'] is distinct from to_jsonb(new)-array['current_import','state'] then
   raise exception 'Observed campaign thread identity is immutable' using errcode='55000';end if;
 end if;
 return new;
end$$;
revoke all on function public.learn_slack_campaign_thread_immutable() from public,anon,authenticated,service_role;
create trigger slack_campaign_thread_scan_immutable before update on public.slack_history_campaign_thread_scans for each row execute function public.learn_slack_campaign_thread_immutable();
create trigger slack_campaign_thread_member_immutable before update on public.slack_history_campaign_threads for each row execute function public.learn_slack_campaign_thread_immutable();

-- Coverage depends on matching durable publication, independent of whether a
-- completed approval is now paused/expired. It covers only the fixed window and
-- observed roots; deleted/unavailable provider history is never inferred.
create function public.learn_slack_campaign_channel_progress(p_campaign uuid,p_account uuid) returns jsonb
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare h public.slack_history_campaigns%rowtype;m public.slack_history_campaign_channels%rowtype;a public.connector_accounts%rowtype;
 cfg jsonb;history_done boolean;discovered boolean;observed bigint;completed bigint;begin
 select * into m from public.slack_history_campaign_channels where campaign_id=p_campaign and account_id=p_account;
 if not found then return null;end if;
 select * into h from public.slack_history_campaigns where id=m.campaign_id and tenant_id=m.tenant_id;
 select * into a from public.connector_accounts where id=m.account_id and tenant_id=m.tenant_id;
 cfg:=a.settings->'slack_history';
 history_done:=coalesce(cfg->>'campaignId'=h.id::text and cfg->>'teamId'=h.team_id and cfg->>'channelId'=m.channel_id
 and cfg->>'consentReference'='learn-slack-import:'||m.current_import::text
 and (cfg->>'oldest')::numeric=extract(epoch from h.starts_at) and (cfg->>'latest')::numeric=extract(epoch from h.ends_at)
 and a.sync_cursor->'complete'='true'::jsonb and exists(select 1 from public.platform_jobs j where j.tenant_id=m.tenant_id
 and j.job_type='slack.history_sync' and j.status='succeeded' and j.payload->>'connector_account_id'=a.id::text
 and j.metadata->'slack_page_v1'->'next'=a.sync_cursor and j.metadata->'slack_page_v1'->>'account_id'=a.id::text),false);
 select coalesce(s.discovery_complete,false) into discovered from public.slack_history_campaign_thread_scans s where s.campaign_id=p_campaign and s.account_id=p_account;
 select count(*),count(*) filter(where t.tenant_id=m.tenant_id and t.account_id=m.account_id
 and t.scope->>'campaignId'=h.id::text and (t.scope->>'parentTimestamp')::numeric=member.parent_timestamp
 and (t.scope->>'oldest')::numeric=extract(epoch from h.starts_at) and (t.scope->>'latest')::numeric=extract(epoch from h.ends_at)
 and t.checkpoint->'complete'='true'::jsonb and exists(select 1 from public.platform_jobs j where j.tenant_id=m.tenant_id
 and j.job_type='slack.thread_sync' and j.status='succeeded' and j.payload->>'thread_import_id'=t.id::text
 and j.payload->>'connector_account_id'=m.account_id::text and j.metadata->'slack_page_v1'->>'thread_import_id'=t.id::text
 and j.metadata->'slack_page_v1'->'next'=t.checkpoint)) into observed,completed
 from public.slack_history_campaign_threads member left join public.slack_thread_imports t on t.id=member.current_import
 where member.campaign_id=p_campaign and member.account_id=p_account;
 return jsonb_build_object('channelPagesComplete',history_done,'discoveryComplete',coalesce(discovered,false),'observedThreads',observed,
 'completedThreads',completed,'threadsComplete',coalesce(discovered,false) and observed=completed,
 'complete',history_done and coalesce(discovered,false) and observed=completed,'coverage','fixed_window_observed_threads');
end$$;
revoke all on function public.learn_slack_campaign_channel_progress(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.learn_slack_campaign_job_allowed(p_tenant uuid,p_job uuid) returns boolean
language plpgsql volatile security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;a public.connector_accounts%rowtype;cfg jsonb;h public.slack_history_campaigns%rowtype;t public.slack_thread_imports%rowtype;begin
 if auth.role() is distinct from 'service_role' then return false;end if;
 select * into j from public.platform_jobs where id=p_job and tenant_id=p_tenant and job_type in ('slack.history_sync','slack.thread_sync');
 if not found then return false;end if;
 select * into a from public.connector_accounts where id::text=j.payload->>'connector_account_id' and tenant_id=p_tenant;
 if not found then return false;end if;
 cfg:=a.settings->'slack_history';
 if not coalesce(cfg ? 'campaignId',false) then return true;end if;
 select * into h from public.slack_history_campaigns where id::text=cfg->>'campaignId' and tenant_id=p_tenant;
 if not found or not public.learn_slack_campaign_authority(h.id) then return false;end if;
 if not coalesce(a.status='active' and cfg->'approved'='true'::jsonb and cfg->>'teamId'=h.team_id
 and cfg->>'connectionId'=h.connection_id::text
 and (cfg->>'oldest')::numeric=extract(epoch from h.starts_at) and (cfg->>'latest')::numeric=extract(epoch from h.ends_at)
 and exists(select 1 from public.slack_history_campaign_channels m join public.slack_history_imports i on i.id=m.current_import
 where m.campaign_id=h.id and m.tenant_id=p_tenant and m.account_id=a.id and m.channel_id=cfg->>'channelId'
 and cfg->>'consentReference'='learn-slack-import:'||i.id::text and i.tenant_id=p_tenant and i.account_id=a.id)
 and exists(select 1 from public.tenant_connectors tc where tc.id=a.tenant_connector_id and tc.tenant_id=p_tenant
 and tc.connector_id='slack' and tc.enabled and tc.status='active'),false) then return false;end if;
 if j.job_type='slack.history_sync' then return true;end if;
 select * into t from public.slack_thread_imports where id::text=j.payload->>'thread_import_id' and tenant_id=p_tenant and account_id=a.id;
 if not found then return false;end if;
 return coalesce(t.scope->>'campaignId'=h.id::text and t.scope->'approved'='true'::jsonb
 and t.scope->>'connectionId'=h.connection_id::text and t.scope->>'teamId'=h.team_id and t.scope->>'channelId'=cfg->>'channelId'
 and (t.definition->>'connectionRevision')::timestamptz=h.connection_revision
 and (t.scope->>'oldest')::numeric=extract(epoch from h.starts_at) and (t.scope->>'latest')::numeric=extract(epoch from h.ends_at)
 and exists(select 1 from public.slack_history_campaign_threads member where member.campaign_id=h.id and member.tenant_id=p_tenant
 and member.account_id=a.id and member.current_import=t.id and member.parent_timestamp=(t.scope->>'parentTimestamp')::numeric
 and member.source_message_id=t.source_message_id and member.source_version=t.definition->>'sourceVersion'),false);
end$$;

create function public.learn_slack_campaign_thread_attribution_allowed(r jsonb) returns boolean
language sql volatile security definer set search_path=pg_catalog as $$
 select coalesce(auth.role()='service_role' and exists(select 1 from public.slack_history_campaigns h
 join public.slack_history_campaign_channels c on c.campaign_id=h.id and c.tenant_id=h.tenant_id
 join public.connector_accounts a on a.id=c.account_id and a.tenant_id=h.tenant_id
 join public.slack_history_campaign_threads member on member.campaign_id=h.id and member.account_id=a.id and member.tenant_id=h.tenant_id
 join public.slack_messages m on m.id=member.source_message_id and m.tenant_id=h.tenant_id and m.team_id=h.team_id and m.channel_id=c.channel_id
 join public.slack_message_versions v on v.message_id=m.id and v.tenant_id=h.tenant_id and v.source_version=member.source_version
 join public.platform_jobs j on j.id=(r->>'initial_job_id')::uuid and j.tenant_id=h.tenant_id
 where h.id::text=r->'definition'->>'campaignId' and h.tenant_id::text=r->>'tenant_id' and public.learn_slack_campaign_authority(h.id)
 and h.approved_by::text=r->>'approved_by' and a.id::text=r->>'account_id' and a.status='active'
 and a.settings->'slack_history'->>'campaignId'=h.id::text and a.settings->'slack_history'->'approved'='true'::jsonb
 and a.settings->'slack_history'->>'consentReference'='learn-slack-import:'||c.current_import::text
 and r->'definition'->>'resumesImportId' is not distinct from member.current_import::text
 and r->>'source_message_id'=member.source_message_id::text and r->'definition'->>'sourceVersion'=member.source_version
 and r->'definition'->>'sourceMessageId'=member.source_message_id::text and r->'definition'->>'accountId'=a.id::text
 and (r->'definition'->>'connectionRevision')::timestamptz=h.connection_revision
 and (r->'definition'->>'start')::timestamptz=h.starts_at and (r->'definition'->>'end')::timestamptz=h.ends_at
 and r->'definition'->'maxPages'='10'::jsonb and r->'scope'->'maxPages'='10'::jsonb
 and r->'scope'->>'campaignId'=h.id::text and r->'scope'->>'connectionId'=h.connection_id::text
 and r->'scope'->>'teamId'=h.team_id and r->'scope'->>'channelId'=c.channel_id and r->'scope'->'approved'='true'::jsonb
 and r->'scope'->>'consentReference'='learn-slack-thread:'||(r->>'id')
 and (r->'scope'->>'oldest')::numeric=extract(epoch from h.starts_at) and (r->'scope'->>'latest')::numeric=extract(epoch from h.ends_at)
 and (r->'scope'->>'expiresAt')::timestamptz<=h.expires_at and (r->'scope'->>'expiresAt')::timestamptz>clock_timestamp()
 and (r->'scope'->>'parentTimestamp')::numeric=member.parent_timestamp
 and member.parent_timestamp=case when v.provider_payload->>'thread_ts' is not null
  and (v.provider_payload->>'thread_ts')::numeric<(v.provider_payload->>'ts')::numeric then (v.provider_payload->>'thread_ts')::numeric
  when coalesce(v.provider_payload->>'reply_count','') ~ '^[0-9]+$' and (v.provider_payload->>'reply_count')::numeric>0 then (v.provider_payload->>'ts')::numeric end
 and j.job_type='slack.thread_sync' and j.status='queued' and j.created_by=h.approved_by
 and j.payload->>'connector_account_id'=a.id::text and j.payload->>'thread_import_id'=r->>'id'),false);
$$;
revoke all on function public.learn_slack_campaign_thread_attribution_allowed(jsonb) from public,anon,authenticated,service_role;
do $$declare d text;needle text;begin
 d:=pg_get_functiondef('public.learn_slack_reference_guard()'::regprocedure);
 needle:='   if auth.role() is distinct from ''authenticated'' or auth.uid() is null';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed campaign thread attribution guard differs';end if;
 execute replace(d,needle,'   if tg_op=''INSERT'' and tg_table_name=''slack_thread_imports'' and public.learn_slack_campaign_thread_attribution_allowed(j) then continue;end if;'||chr(10)||needle);
end$$;

create function public.learn_slack_campaign_thread_import_complete(p_import uuid) returns boolean
language sql volatile security definer set search_path=pg_catalog as $$
 select coalesce(exists(select 1 from public.slack_thread_imports t where t.id=p_import and t.checkpoint->'complete'='true'::jsonb
 and exists(select 1 from public.platform_jobs j where j.tenant_id=t.tenant_id and j.job_type='slack.thread_sync' and j.status='succeeded'
 and j.payload->>'thread_import_id'=t.id::text and j.payload->>'connector_account_id'=t.account_id::text
 and j.metadata->'slack_page_v1'->>'thread_import_id'=t.id::text and j.metadata->'slack_page_v1'->'next'=t.checkpoint)),false);
$$;
revoke all on function public.learn_slack_campaign_thread_import_complete(uuid) from public,anon,authenticated,service_role;

-- Runs under the campaign scheduler's tenant/header/channel/account lock order.
-- At most twenty observed parents are recorded and one reply job is queued per
-- channel/pass. All work uses the existing paced, fenced one-page Slack worker.
create function public.learn_slack_campaign_threads_step(p_campaign uuid,p_account uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare h public.slack_history_campaigns%rowtype;c public.slack_history_campaign_channels%rowtype;a public.connector_accounts%rowtype;
 scan public.slack_history_campaign_thread_scans%rowtype;member public.slack_history_campaign_threads%rowtype;
 t public.slack_thread_imports%rowtype;last_job public.platform_jobs%rowtype;root record;progress jsonb;cfg jsonb;scope jsonb;cp jsonb;d jsonb;
 n integer:=0;request_id uuid;job_id uuid;key text;can_renew boolean;begin
 if auth.role() is distinct from 'service_role' or current_setting('transaction_isolation')<>'read committed' then
  raise exception 'slack_campaign_forbidden' using errcode='42501';end if;
 select * into h from public.slack_history_campaigns where id=p_campaign;
 if not found then return jsonb_build_object('state','campaign_unavailable','queued',false);end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-slack-setup:'||h.tenant_id::text,0));
 select * into h from public.slack_history_campaigns where id=p_campaign for update;
 select * into c from public.slack_history_campaign_channels where campaign_id=h.id and account_id=p_account and tenant_id=h.tenant_id for update;
 if not found then return jsonb_build_object('state','channel_unavailable','queued',false);end if;
 select * into a from public.connector_accounts where id=c.account_id and tenant_id=h.tenant_id for update;
 progress:=public.learn_slack_campaign_channel_progress(h.id,a.id);
 if progress->'complete'='true'::jsonb then return jsonb_build_object('state','campaign_window_complete','queued',false);end if;
 if progress->'channelPagesComplete' is distinct from 'true'::jsonb then return jsonb_build_object('state','channel_completion_unverified','queued',false);end if;
 if not public.learn_slack_campaign_authority(h.id) then return jsonb_build_object('state','authority_or_capture_unavailable','queued',false);end if;
 if h.requests_reserved>=h.request_budget then return jsonb_build_object('state','request_budget_exhausted','queued',false);end if;
 cfg:=a.settings->'slack_history';
 if a.status<>'active' or cfg->'approved' is distinct from 'true'::jsonb or not exists(select 1 from public.tenant_connectors tc
 where tc.id=a.tenant_connector_id and tc.tenant_id=h.tenant_id and tc.connector_id='slack' and tc.enabled and tc.status='active') then
 return jsonb_build_object('state','account_or_connector_unavailable','queued',false);end if;
 insert into public.slack_history_campaign_thread_scans(campaign_id,account_id,tenant_id) values(h.id,a.id,h.tenant_id) on conflict do nothing;
 select * into scan from public.slack_history_campaign_thread_scans where campaign_id=h.id and account_id=a.id for update;
 if not scan.discovery_complete then
  -- Unusable parent evidence is a coverage gap, not an empty thread list.
  if exists(select 1 from public.slack_messages sm where sm.tenant_id=h.tenant_id and sm.team_id=h.team_id and sm.channel_id=c.channel_id
   and sm.provider_timestamp::numeric between extract(epoch from h.starts_at) and extract(epoch from h.ends_at)
   and ((sm.provider_payload ? 'reply_count' and case when jsonb_typeof(sm.provider_payload->'reply_count')='number'
    and sm.provider_payload->>'reply_count' ~ '^[0-9]+$' then (sm.provider_payload->>'reply_count')::numeric>9007199254740991 else true end)
    or sm.thread_timestamp::numeric>sm.provider_timestamp::numeric)) then
   return jsonb_build_object('state','thread_evidence_invalid','queued',false);end if;
  for root in with observed as (
   select sm.id,sm.source_version,sm.provider_timestamp,
    case when sm.thread_timestamp is not null and sm.thread_timestamp::numeric<sm.provider_timestamp::numeric then sm.thread_timestamp::numeric
     when coalesce(sm.provider_payload->>'reply_count','') ~ '^[0-9]+$' and (sm.provider_payload->>'reply_count')::numeric>0 then sm.provider_timestamp::numeric end as parent
   from public.slack_messages sm where sm.tenant_id=h.tenant_id and sm.team_id=h.team_id and sm.channel_id=c.channel_id
   and sm.provider_timestamp::numeric between extract(epoch from h.starts_at) and extract(epoch from h.ends_at)
   and public.learn_slack_message_kind(sm.provider_payload)='conversation'
  ), parents as (select distinct on(parent) * from observed where parent is not null and (scan.after_parent is null or parent>scan.after_parent)
    order by parent,(provider_timestamp::numeric=parent) desc,id)
  select * from parents order by parent limit 20 loop
   insert into public.slack_history_campaign_threads(campaign_id,account_id,tenant_id,parent_timestamp,source_message_id,source_version)
    values(h.id,a.id,h.tenant_id,root.parent,root.id,root.source_version);
   n:=n+1;scan.after_parent:=root.parent;
  end loop;
  update public.slack_history_campaign_thread_scans set after_parent=scan.after_parent,discovery_complete=n<20 where campaign_id=h.id and account_id=a.id;
 end if;
 update public.slack_history_campaign_threads mt set state='captured' where mt.campaign_id=h.id and mt.account_id=a.id
 and mt.state<>'captured' and public.learn_slack_campaign_thread_import_complete(mt.current_import);
 -- Stable parent ordering and one unfinished thread per channel keep the queue
 -- bounded, without confusing queueing/discovery with captured replies.
 select * into member from public.slack_history_campaign_threads mt where mt.campaign_id=h.id and mt.account_id=a.id
 and not public.learn_slack_campaign_thread_import_complete(mt.current_import) order by mt.parent_timestamp limit 1 for update;
 if not found then
  progress:=public.learn_slack_campaign_channel_progress(h.id,a.id);
  return jsonb_build_object('state',case when progress->'complete'='true'::jsonb then 'campaign_window_complete' else 'discovering_threads' end,'queued',false);
 end if;
 cp:='{}';
 if member.current_import is not null then
  select * into t from public.slack_thread_imports where id=member.current_import and tenant_id=h.tenant_id and account_id=a.id for update;
  if not found or t.scope->>'campaignId' is distinct from h.id::text or t.scope->>'parentTimestamp' is distinct from member.parent_timestamp::text then
   return jsonb_build_object('state','thread_scope_changed','queued',false);end if;
  if exists(select 1 from public.platform_jobs pending where pending.tenant_id=h.tenant_id and pending.job_type='slack.thread_sync'
   and pending.payload->>'thread_import_id'=t.id::text and pending.status in ('queued','retrying','running')) then
   return jsonb_build_object('state','thread_active','queued',false);end if;
  cp:=t.checkpoint;
  select * into last_job from public.platform_jobs recent where recent.tenant_id=h.tenant_id and recent.job_type='slack.thread_sync'
   and recent.payload->>'thread_import_id'=t.id::text order by recent.created_at desc,recent.id desc limit 1;
  can_renew:=coalesce((cp->>'pages')::integer>=(t.scope->>'maxPages')::integer and exists(select 1 from public.platform_jobs published
   where published.tenant_id=h.tenant_id and published.job_type='slack.thread_sync' and published.status='succeeded'
   and published.payload->>'thread_import_id'=t.id::text and published.metadata->'slack_page_v1'->>'thread_import_id'=t.id::text
   and published.metadata->'slack_page_v1'->'next'=cp),false)
   or coalesce(last_job.status in ('failed','dead_letter') and last_job.payload->>'campaign_id'=h.id::text
    and (last_job.payload->>'campaign_revision')::bigint<h.revision and last_job.error_code in
    ('slack_history_campaign_request_unavailable','slack_history_campaign_request_unconfirmed','slack_history_binding_unavailable','slack_history_authority_unavailable'),false)
   or coalesce((t.scope->>'expiresAt')::timestamptz<=clock_timestamp() and last_job.status in ('failed','dead_letter')
    and last_job.error_code in ('slack_history_binding_unavailable','slack_history_authority_unavailable'),false);
  if not can_renew or cp->'complete'='true'::jsonb or (cp<>'{}'::jsonb and cp->>'cursor' is null and cp->'pages'<>'0'::jsonb) then
   return jsonb_build_object('state','thread_needs_review','queued',false);end if;
 end if;
 request_id:=gen_random_uuid();job_id:=gen_random_uuid();
 scope:=cfg||jsonb_build_object('approved',true,'parentTimestamp',member.parent_timestamp::text,'maxPages',10,
  'expiresAt',least(h.expires_at,clock_timestamp()+interval '24 hours'),'consentReference','learn-slack-thread:'||request_id::text);
 -- Parenthesised fields keep the queue key identical to the existing thread worker.
 key:='slack.thread:'||a.id::text||':'||member.parent_timestamp::text||':'||(scope->>'oldest')||':'||(scope->>'latest');
 d:=jsonb_build_object('campaignId',h.id,'campaignRevision',h.revision,'accountId',a.id,'sourceMessageId',member.source_message_id,
  'sourceVersion',member.source_version,'connectionRevision',h.connection_revision,'start',h.starts_at,'end',h.ends_at,'maxPages',10,
  'reason','Capture observed replies within the recorded historical campaign','resumesImportId',member.current_import,
  'previousState',case when member.current_import is null then null else jsonb_build_object('scope',t.scope,'checkpoint',cp) end);
 cp:=jsonb_build_object('scopeKey',array_to_json(array[h.tenant_id::text,h.team_id,c.channel_id,scope->>'oldest',scope->>'latest',scope->>'consentReference',scope->>'parentTimestamp'])::text,
  'cursor',cp->>'cursor','pages',0,'complete',false);
 insert into public.platform_jobs(id,tenant_id,connector_id,job_type,job_key,status,max_attempts,available_at,payload,created_by)
  values(job_id,h.tenant_id,'slack','slack.thread_sync',key,'queued',5,clock_timestamp(),
   jsonb_build_object('connector_account_id',a.id,'thread_import_id',request_id,'campaign_id',h.id,'campaign_revision',h.revision),h.approved_by);
 insert into public.slack_thread_imports(id,tenant_id,account_id,source_message_id,initial_job_id,approved_by,definition,scope,checkpoint)
  values(request_id,h.tenant_id,a.id,member.source_message_id,job_id,h.approved_by,d,scope,cp);
 update public.slack_history_campaign_threads set current_import=request_id,state='queued' where campaign_id=h.id and account_id=a.id and parent_timestamp=member.parent_timestamp;
 return jsonb_build_object('state','thread_queued','queued',true);
end$$;
revoke all on function public.learn_slack_campaign_threads_step(uuid,uuid) from public,anon,authenticated,service_role;

-- Carry reply traversal through the existing infrastructure-authenticated scheduler.
do $$declare d text;needle text;begin
 d:=pg_get_functiondef('public.learn_slack_schedule_campaigns(integer)'::regprocedure);
 needle:='c.state<>''history_captured_threads_pending''';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed campaign thread scheduling filter differs';end if;
 d:=replace(d,needle,'c.state<>''campaign_window_complete''');
 needle:='  if status not in (''window_active'',''window_queued'',''history_captured_threads_pending'') then held:=held+1;end if;';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed campaign thread scheduling settlement differs';end if;
 execute replace(d,needle,$patch$  if status='history_captured_threads_pending' then
   state:=public.learn_slack_campaign_threads_step(h.id,a.id);
   if state->'queued'='true'::jsonb then queued:=queued+1;end if;
   status:=state->>'state';
  end if;
  if status not in ('window_active','window_queued','thread_active','thread_queued','discovering_threads','campaign_window_complete') then held:=held+1;end if;$patch$);
end$$;

create or replace function public.learn_slack_campaign_read(p_tenant uuid,p_campaign uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare h public.slack_history_campaigns%rowtype;rows jsonb;threads_done boolean;all_done boolean;begin
 perform public.learn_slack_control_access(p_tenant,false,'history');
 select * into h from public.slack_history_campaigns where id=p_campaign and tenant_id=p_tenant;
 if not found then raise exception 'slack_campaign_unavailable' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('accountId',m.account_id,'channelId',m.channel_id,'approvalId',m.current_import,
 'state',case when progress->'complete'='true'::jsonb then 'campaign_window_complete' else m.state end,
 'pagesThisApproval',a.sync_cursor->'pages')||progress order by m.channel_id),'[]'::jsonb)
 into rows from public.slack_history_campaign_channels m join public.connector_accounts a on a.id=m.account_id and a.tenant_id=m.tenant_id
 cross join lateral public.learn_slack_campaign_channel_progress(m.campaign_id,m.account_id) progress where m.campaign_id=h.id;
 select coalesce(bool_and((value->>'threadsComplete')::boolean),false),coalesce(bool_and((value->>'complete')::boolean),false)
 into threads_done,all_done from jsonb_array_elements(rows);
 return jsonb_build_object('version','learn-slack-campaign/1','tenantId',p_tenant,'campaignId',h.id,'revision',h.revision,
 'enabled',h.enabled,'start',h.starts_at,'end',h.ends_at,'expiresAt',h.expires_at,'requestBudget',h.request_budget,
 'requestsReserved',h.requests_reserved,'requestAccounting','conservative_dispatch_reservations',
 'threadsComplete',threads_done,'complete',all_done,'coverage','fixed_window_observed_threads','channels',rows);
end$$;

-- Explicit terminal stop / completed-history handoff. Installation creates no
-- subscription, campaign, job, credential, schedule or provider request.

create table public.slack_history_campaign_closures (
 campaign_id uuid primary key,tenant_id uuid not null,request_id uuid not null unique,
 actor_id uuid not null references public.profiles(id),
 outcome text not null check(outcome in ('stopped','ongoing')),
 snapshot jsonb not null,created_at timestamptz not null default clock_timestamp(),
 foreign key(campaign_id,tenant_id) references public.slack_history_campaigns(id,tenant_id),
 foreign key(request_id) references public.slack_history_campaign_requests(id) deferrable initially deferred
);
alter table public.slack_history_campaign_closures enable row level security;
revoke all on public.slack_history_campaign_closures from public,anon,authenticated,service_role;
create trigger slack_campaign_closure_immutable before update or delete on public.slack_history_campaign_closures
 for each row execute function public.slack_version_immutable();
create trigger slack_campaign_closure_retain before truncate on public.slack_history_campaign_closures
 for each statement execute function public.slack_version_immutable();

-- Original jobs never become legacy jobs merely because a later workflow removes
-- the account's campaign binding. Keep this before the legacy fast path.
do $$declare d text;needle text;begin
 d:=pg_get_functiondef('public.learn_slack_campaign_job_allowed(uuid,uuid)'::regprocedure);
 needle:=' if not coalesce(cfg ? ''campaignId'',false) then return true;end if;';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed campaign job binding differs';end if;
 execute replace(d,needle,$patch$ if j.payload ? 'campaign_id' and (cfg->>'campaignId' is distinct from j.payload->>'campaign_id'
  or exists(select 1 from public.slack_history_campaign_closures x where x.campaign_id::text=j.payload->>'campaign_id' and x.tenant_id=p_tenant)) then return false;end if;
 if j.job_type='slack.thread_sync' and exists(select 1 from public.slack_thread_imports old_thread
  where old_thread.id::text=j.payload->>'thread_import_id' and old_thread.tenant_id=p_tenant and old_thread.scope ? 'campaignId'
  and (cfg->>'campaignId' is distinct from old_thread.scope->>'campaignId'
   or exists(select 1 from public.slack_history_campaign_closures x where x.campaign_id::text=old_thread.scope->>'campaignId' and x.tenant_id=p_tenant))) then return false;end if;
$patch$||needle);
 d:=pg_get_functiondef('public.learn_slack_campaign_control(uuid,uuid,uuid,bigint,boolean,text,text)'::regprocedure);
 needle:='  if p_enabled and (h.expires_at<=clock_timestamp() or h.requests_reserved>=h.request_budget) then';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed campaign terminal control differs';end if;
 execute replace(d,needle,'  if exists(select 1 from public.slack_history_campaign_closures where campaign_id=h.id) then raise exception ''slack_campaign_closed'' using errcode=''55000'';end if;'||chr(10)||needle);
 -- A retained terminal snapshot continues to prove the old window even after the
 -- recurring account has advanced to another scope/checkpoint.
 d:=pg_get_functiondef('public.learn_slack_campaign_channel_progress(uuid,uuid)'::regprocedure);
 needle:=' select * into m from public.slack_history_campaign_channels where campaign_id=p_campaign and account_id=p_account;';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed campaign terminal progress differs';end if;
 execute replace(d,needle,$patch$ if exists(select 1 from public.slack_history_campaign_closures where campaign_id=p_campaign) then
  return (select entry from public.slack_history_campaign_closures x cross join lateral jsonb_array_elements(x.snapshot->'channels') entry
   where x.campaign_id=p_campaign and entry->>'accountId'=p_account::text);
 end if;
$patch$||needle);
 d:=pg_get_functiondef('public.learn_slack_campaign_read(uuid,uuid)'::regprocedure);
 needle:=' select coalesce(jsonb_agg(jsonb_build_object(''accountId'',m.account_id';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed campaign terminal reader differs';end if;
 execute replace(d,needle,$patch$ if exists(select 1 from public.slack_history_campaign_closures where campaign_id=h.id) then
  return (select x.snapshot||jsonb_build_object('enabled',false,'revision',h.revision,'lifecycle',x.outcome,'closedAt',x.created_at)
   from public.slack_history_campaign_closures x where x.campaign_id=h.id and x.tenant_id=p_tenant);
 end if;
$patch$||needle);
end$$;

create function public.learn_slack_campaign_close(p_tenant uuid,p_request uuid,p_campaign uuid,p_revision bigint,p_action text,p_reason text,p_mode text default 'apply') returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare prior public.slack_history_campaign_requests%rowtype;h public.slack_history_campaigns%rowtype;
 m public.slack_history_campaign_channels%rowtype;a public.connector_accounts%rowtype;c public.provider_connections%rowtype;
 d jsonb;r jsonb;snapshot jsonb;channels jsonb:='[]';subscription jsonb;recurring_revision bigint;begin
 perform public.learn_slack_control_access(p_tenant,true,'resume_history');
 if current_setting('transaction_isolation')<>'read committed' or p_request is null or p_campaign is null or p_revision is null or p_revision<1
 or p_action is null or p_action not in ('stop','handoff') or length(btrim(coalesce(p_reason,''))) not between 1 and 1000
 or p_mode is null or p_mode not in ('apply','check','cancel') then raise exception 'slack_campaign_close_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-work-registry',0));
 perform pg_advisory_xact_lock(hashtextextended('learn-roster:'||p_tenant::text,0));
 perform public.learn_slack_control_access(p_tenant,true,'resume_history');
 d:=jsonb_build_object('kind','close_campaign','campaignId',p_campaign,'revision',p_revision,'action',p_action,'reason',btrim(p_reason));
 perform pg_advisory_xact_lock(hashtextextended('learn-slack-campaign-request:'||p_request::text,0));
 select * into prior from public.slack_history_campaign_requests where id=p_request;
 if found then
  if prior.tenant_id<>p_tenant or prior.actor_id<>auth.uid() or prior.definition<>d then raise exception 'slack_campaign_request_changed' using errcode='PT409';end if;
  return prior.receipt;
 end if;
 r:=jsonb_build_object('tenantId',p_tenant,'requestId',p_request,'state',case when p_mode='cancel' then 'cancelled' else 'pending' end);
 if p_mode='check' then return r;end if;
 if p_mode='apply' then
  perform pg_advisory_xact_lock(hashtextextended('learn-slack-setup:'||p_tenant::text,0));
  select * into h from public.slack_history_campaigns where id=p_campaign and tenant_id=p_tenant for update;
  if not found or h.revision<>p_revision then raise exception 'slack_campaign_revision_changed' using errcode='PT409';end if;
  if exists(select 1 from public.slack_history_campaign_closures where campaign_id=h.id) then raise exception 'slack_campaign_closed' using errcode='55000';end if;
  snapshot:=public.learn_slack_campaign_read(p_tenant,h.id);
  if p_action='handoff' then
   if snapshot->'complete' is distinct from 'true'::jsonb or snapshot->'threadsComplete' is distinct from 'true'::jsonb then
    raise exception 'slack_campaign_finish_history' using errcode='55000';end if;
   -- Handoff is a fresh ongoing approval by the actual caller, not an extension
   -- of the old campaign's request budget or original actor's authority.
   if not public.learn_capture_allowed(p_tenant,'slack') then raise exception 'slack_campaign_capture_disabled' using errcode='55000';end if;
   select * into c from public.provider_connections where id=h.connection_id and tenant_id=p_tenant for share;
   if not found or c.updated_at is distinct from h.connection_revision or c.status is distinct from 'configured' or c.revoked_at is not null then
    raise exception 'slack_campaign_connection_changed' using errcode='55000';end if;
   if exists(select 1 from public.platform_jobs j join public.slack_history_campaign_channels member on member.account_id::text=j.payload->>'connector_account_id'
    and member.tenant_id=j.tenant_id where member.campaign_id=h.id and j.job_type in ('slack.history_sync','slack.thread_sync')
    and j.status in ('queued','retrying','running')) then raise exception 'slack_campaign_work_active' using errcode='55000';end if;
  end if;
  update public.slack_history_campaigns set enabled=false,revision=revision+1 where id=h.id returning * into h;
  insert into public.slack_history_campaign_closures(campaign_id,tenant_id,request_id,actor_id,outcome,snapshot)
   values(h.id,p_tenant,p_request,auth.uid(),case when p_action='handoff' then 'ongoing' else 'stopped' end,snapshot);
  if p_action='handoff' then
   for m in select * from public.slack_history_campaign_channels where campaign_id=h.id order by account_id loop
    -- Existing subscription controls own their validation/audit/identity checks.
    -- They run in this same transaction, so any failure rolls back the whole handoff.
    select revision into recurring_revision from public.slack_recurring_channels where account_id=m.account_id for update;
    recurring_revision:=coalesce(recurring_revision,0);
    select * into a from public.connector_accounts where id=m.account_id and tenant_id=p_tenant for update;
    if not found or a.settings->'slack_history'->>'campaignId' is distinct from h.id::text
     or a.settings->'slack_history'->>'consentReference' is distinct from 'learn-slack-import:'||m.current_import::text then
     raise exception 'slack_campaign_scope_changed' using errcode='55000';end if;
    update public.connector_accounts set settings=jsonb_set(settings,'{slack_history}',(settings->'slack_history')-'campaignId') where id=a.id;
    subscription:=public.learn_slack_recurring_control(p_tenant,gen_random_uuid(),a.id,recurring_revision,true,btrim(p_reason));
    subscription:=public.learn_slack_recurring_threads_control(p_tenant,gen_random_uuid(),a.id,(subscription->>'revision')::bigint,true,btrim(p_reason));
    channels:=channels||jsonb_build_array(jsonb_build_object('accountId',a.id,'revision',subscription->'revision','start',h.ends_at,'includeThreads',true));
   end loop;
  end if;
  -- Stopping leaves saved bindings/checkpoints intact. In-flight requests may
  -- finish transport, but their publication is fenced; no new dispatch is allowed.
  r:=r||jsonb_build_object('state','recorded','campaignId',h.id,'revision',h.revision,'lifecycle',case when p_action='handoff' then 'ongoing' else 'stopped' end,
    'subscriptions',channels,'historicalCoverage',snapshot->'coverage','historicalComplete',snapshot->'complete');
 end if;
 insert into public.slack_history_campaign_requests values(p_request,p_tenant,auth.uid(),d,r,clock_timestamp());
 return r;
end$$;
revoke all on function public.learn_slack_campaign_close(uuid,uuid,uuid,bigint,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_slack_campaign_close(uuid,uuid,uuid,bigint,text,text,text) to authenticated;

-- Logged, paginated controller read and actor-bound request dispatch. No capture.

create function public.learn_slack_campaign_list(p_tenant uuid,p_after uuid default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare rows jsonb;last_id uuid;more boolean;begin
 perform public.learn_slack_control_access(p_tenant,false,'history');
 select coalesce(jsonb_agg(jsonb_build_object('campaignId',h.id,'start',h.starts_at,'end',h.ends_at,'enabled',h.enabled,
  'lifecycle',coalesce(x.outcome,'open'),'channelCount',(select count(*) from public.slack_history_campaign_channels m where m.campaign_id=h.id)) order by h.id),'[]')
 into rows from (select * from public.slack_history_campaigns where tenant_id=p_tenant and (p_after is null or id>p_after) order by id limit 20) h
 left join public.slack_history_campaign_closures x on x.campaign_id=h.id and x.tenant_id=h.tenant_id;
 last_id:=(rows->-1->>'campaignId')::uuid;
 select exists(select 1 from public.slack_history_campaigns where tenant_id=p_tenant and id>last_id) into more;
 return jsonb_build_object('version','learn-slack-campaign-list/1','tenantId',p_tenant,'canWrite',public.learn_slack_recurring_access(p_tenant,true),
 'campaigns',rows,'next',case when more then last_id else null end);
end$$;
revoke all on function public.learn_slack_campaign_list(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_slack_campaign_list(uuid,uuid) to authenticated;
create function public.learn_slack_campaign_dispatch(p_tenant uuid,p_actor uuid,p_request uuid,p_operation text,p_input jsonb,p_mode text default 'apply') returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null or p_actor is distinct from auth.uid() then
  raise exception 'slack_campaign_actor_changed' using errcode='42501';end if;
 if jsonb_typeof(p_input) is distinct from 'object' or p_mode is null or p_mode not in ('apply','check','cancel') then
  raise exception 'slack_campaign_request_invalid' using errcode='22023';end if;
 if p_operation='start' then return public.learn_slack_campaign_start(p_tenant,p_request,p_input,p_mode);
 elsif p_operation='control' and p_input ?& array['campaignId','revision','enabled','reason']
  and p_input-array['campaignId','revision','enabled','reason']='{}' and jsonb_typeof(p_input->'enabled')='boolean'
  and jsonb_typeof(p_input->'revision')='number' and p_input->>'revision' ~ '^[0-9]+$' and jsonb_typeof(p_input->'reason')='string' then
  return public.learn_slack_campaign_control(p_tenant,p_request,(p_input->>'campaignId')::uuid,(p_input->>'revision')::bigint,(p_input->>'enabled')::boolean,p_input->>'reason',p_mode);
 elsif p_operation='close' and p_input ?& array['campaignId','revision','action','reason']
  and p_input-array['campaignId','revision','action','reason']='{}' and jsonb_typeof(p_input->'revision')='number'
  and p_input->>'revision' ~ '^[0-9]+$' and jsonb_typeof(p_input->'reason')='string' then
  return public.learn_slack_campaign_close(p_tenant,p_request,(p_input->>'campaignId')::uuid,(p_input->>'revision')::bigint,p_input->>'action',p_input->>'reason',p_mode);
 end if;
 raise exception 'slack_campaign_request_invalid' using errcode='22023';
end$$;
revoke all on function public.learn_slack_campaign_dispatch(uuid,uuid,uuid,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_slack_campaign_dispatch(uuid,uuid,uuid,text,jsonb,text) to authenticated;

do $$begin
 if to_regprocedure('public.learn_slack_campaign_dispatch(uuid,uuid,uuid,text,jsonb,text)') is null
 or not has_function_privilege('authenticated','public.learn_slack_campaign_dispatch(uuid,uuid,uuid,text,jsonb,text)','execute')
 or has_function_privilege('anon','public.learn_slack_campaign_dispatch(uuid,uuid,uuid,text,jsonb,text)','execute')
 or has_function_privilege('service_role','public.learn_slack_campaign_dispatch(uuid,uuid,uuid,text,jsonb,text)','execute')
 or not has_function_privilege('service_role','public.learn_slack_campaign_reserve_request(uuid,uuid,text,integer,integer)','execute')
 or has_function_privilege('authenticated','public.learn_slack_campaign_reserve_request(uuid,uuid,text,integer,integer)','execute')
 or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname in ('slack_history_campaigns','slack_history_campaign_channels','slack_history_campaign_requests','slack_history_campaign_dispatches','slack_history_campaign_thread_scans','slack_history_campaign_threads','slack_history_campaign_closures')
 and (not c.relrowsecurity or has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE')))
 or exists(select 1 from public.slack_history_campaigns) or exists(select 1 from public.slack_history_campaign_channels)
 or exists(select 1 from public.slack_history_campaign_requests) or exists(select 1 from public.slack_history_campaign_dispatches)
 or exists(select 1 from public.slack_history_campaign_thread_scans) or exists(select 1 from public.slack_history_campaign_threads)
 or exists(select 1 from public.slack_history_campaign_closures)
 then raise exception 'Slack campaign boundary failed';end if;
 if (select jsonb_agg(to_jsonb(x) order by name) from slack_campaign_preserved x) is distinct from
 (select jsonb_agg(to_jsonb(x) order by name) from (select 'auth.identities' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from auth.identities s union all select 'auth.users' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from auth.users s union all select 'public.audit_logs' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.audit_logs s union all select 'public.authority_grants' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.authority_grants s union all select 'public.authority_permissions' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.authority_permissions s union all select 'public.call_directions' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.call_directions s union all select 'public.call_participants' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.call_participants s union all select 'public.call_transcript_normalisations' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.call_transcript_normalisations s union all select 'public.client_delivery_updates' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.client_delivery_updates s union all select 'public.client_notification_outbox' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.client_notification_outbox s union all select 'public.client_portal_access' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.client_portal_access s union all select 'public.client_programme_notes' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.client_programme_notes s union all select 'public.client_programme_revisions' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.client_programme_revisions s union all select 'public.client_programmes' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.client_programmes s union all select 'public.communication_endpoints' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.communication_endpoints s union all select 'public.companies' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.companies s union all select 'public.config_versions' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.config_versions s union all select 'public.connector_accounts' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.connector_accounts s union all select 'public.contact_points' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.contact_points s union all select 'public.contribution_states' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.contribution_states s union all select 'public.controlplane_change_log' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.controlplane_change_log s union all select 'public.corrections' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.corrections s union all select 'public.customer_cards' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.customer_cards s union all select 'public.data_imports' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.data_imports s union all select 'public.decision_destinations' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.decision_destinations s union all select 'public.decision_log' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.decision_log s union all select 'public.decision_owner_kinds' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.decision_owner_kinds s union all select 'public.domain_entity_types' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.domain_entity_types s union all select 'public.domain_object_types' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.domain_object_types s union all select 'public.effective_profiles' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.effective_profiles s union all select 'public.email_accounts' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.email_accounts s union all select 'public.email_ai_insights' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.email_ai_insights s union all select 'public.email_attachments' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.email_attachments s union all select 'public.email_ingestion_checkpoints' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.email_ingestion_checkpoints s union all select 'public.email_ingestion_transitions' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.email_ingestion_transitions s union all select 'public.email_messages' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.email_messages s union all select 'public.email_oauth_tokens' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.email_oauth_tokens s union all select 'public.email_sync_runs' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.email_sync_runs s union all select 'public.email_threads' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.email_threads s union all select 'public.endpoint_identity_reviews' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.endpoint_identity_reviews s union all select 'public.endpoint_ownership_assignments' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.endpoint_ownership_assignments s union all select 'public.feature_flags' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.feature_flags s union all select 'public.google_workspace_connections' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.google_workspace_connections s union all select 'public.google_workspace_mailboxes' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.google_workspace_mailboxes s union all select 'public.graph_edges' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.graph_edges s union all select 'public.graph_events' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.graph_events s union all select 'public.graph_nodes' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.graph_nodes s union all select 'public.health_objects' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.health_objects s union all select 'public.health_subject_types' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.health_subject_types s union all select 'public.health_types' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.health_types s union all select 'public.import_conflicts' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.import_conflicts s union all select 'public.import_entity_links' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.import_entity_links s union all select 'public.import_profiles' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.import_profiles s union all select 'public.import_row_provenance' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.import_row_provenance s union all select 'public.import_row_results' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.import_row_results s union all select 'public.intelligence_ingestions' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.intelligence_ingestions s union all select 'public.intelligence_objects' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.intelligence_objects s union all select 'public.interaction_match_suggestions' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.interaction_match_suggestions s union all select 'public.interactions' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.interactions s union all select 'public.job_number_aliases' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.job_number_aliases s union all select 'public.jobs' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.jobs s union all select 'public.learn_assessment_cancellations' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_assessment_cancellations s union all select 'public.learn_assessments' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_assessments s union all select 'public.learn_business_input_links' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_business_input_links s union all select 'public.learn_business_input_observations' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_business_input_observations s union all select 'public.learn_business_input_pages' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_business_input_pages s union all select 'public.learn_business_input_projection_attempts' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_business_input_projection_attempts s union all select 'public.learn_business_input_projection_batches' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_business_input_projection_batches s union all select 'public.learn_business_input_request_gates' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_business_input_request_gates s union all select 'public.learn_business_input_request_permits' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_business_input_request_permits s union all select 'public.learn_business_input_versions' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_business_input_versions s union all select 'public.learn_capture_control_requests' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_capture_control_requests s union all select 'public.learn_commusoft_connection_requests' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_commusoft_connection_requests s union all select 'public.learn_commusoft_contact_targets' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_commusoft_contact_targets s union all select 'public.learn_commusoft_recurring' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_commusoft_recurring s union all select 'public.learn_commusoft_recurring_requests' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_commusoft_recurring_requests s union all select 'public.learn_commusoft_recurring_steps' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_commusoft_recurring_steps s union all select 'public.learn_commusoft_verification_permits' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_commusoft_verification_permits s union all select 'public.learn_commusoft_verification_requests' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_commusoft_verification_requests s union all select 'public.learn_commusoft_verification_results' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_commusoft_verification_results s union all select 'public.learn_correction_cancellations' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_correction_cancellations s union all select 'public.learn_email_job_attempts' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_email_job_attempts s union all select 'public.learn_email_source_versions' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_email_source_versions s union all select 'public.learn_email_transition_requests' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_email_transition_requests s union all select 'public.learn_email_transition_settlements' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_email_transition_settlements s union all select 'public.learn_identity_delivery_receipts' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_identity_delivery_receipts s union all select 'public.learn_identity_operator_reviews' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_identity_operator_reviews s union all select 'public.learn_interaction_projection_receipts' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_interaction_projection_receipts s union all select 'public.learn_member_history' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_member_history s union all select 'public.learn_microsoft_capture_streams' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_microsoft_capture_streams s union all select 'public.learn_microsoft_discovery_rounds' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_microsoft_discovery_rounds s union all select 'public.learn_microsoft_folder_dispatches' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_microsoft_folder_dispatches s union all select 'public.learn_microsoft_job_completions' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_microsoft_job_completions s union all select 'public.learn_microsoft_job_stops' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_microsoft_job_stops s union all select 'public.learn_microsoft_mailbox_bindings' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_microsoft_mailbox_bindings s union all select 'public.learn_microsoft_projection_receipts' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_microsoft_projection_receipts s union all select 'public.learn_microsoft_source_pages' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_microsoft_source_pages s union all select 'public.learn_observation_receipts' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_observation_receipts s union all select 'public.learn_operator_input_requests' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_operator_input_requests s union all select 'public.learn_performance_corrections' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_performance_corrections s union all select 'public.learn_performance_reviews' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_performance_reviews s union all select 'public.learn_phone_capture_pages' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_phone_capture_pages s union all select 'public.learn_phone_handoff_receipts' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_phone_handoff_receipts s union all select 'public.learn_phone_import_completions' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_phone_import_completions s union all select 'public.learn_phone_operator_reconciliations' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_phone_operator_reconciliations s union all select 'public.learn_phone_playback_audit' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_phone_playback_audit s union all select 'public.learn_phone_processing_attempts' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_phone_processing_attempts s union all select 'public.learn_phone_result_versions' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_phone_result_versions s union all select 'public.learn_phone_schedule_settlements' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_phone_schedule_settlements s union all select 'public.learn_processing_publications' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_processing_publications s union all select 'public.learn_processing_settlements' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_processing_settlements s union all select 'public.learn_projection_operator_reviews' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_projection_operator_reviews s union all select 'public.learn_scorecard_publications' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_scorecard_publications s union all select 'public.learn_slack_connection_requests' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_slack_connection_requests s union all select 'public.learn_slack_context_reviews' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_slack_context_reviews s union all select 'public.learn_team_work_measurement_runs' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_team_work_measurement_runs s union all select 'public.learn_work_calendar_cancellations' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_work_calendar_cancellations s union all select 'public.learn_work_calendar_publications' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_work_calendar_publications s union all select 'public.learn_work_calendar_versions' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_work_calendar_versions s union all select 'public.learn_work_collection_items' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_work_collection_items s union all select 'public.learn_work_collection_runs' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_work_collection_runs s union all select 'public.learn_work_delay_cancellations' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_work_delay_cancellations s union all select 'public.learn_work_delay_events' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_work_delay_events s union all select 'public.learn_work_measurement_runs' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_work_measurement_runs s union all select 'public.learn_working_collection_items' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_working_collection_items s union all select 'public.learn_working_collection_runs' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.learn_working_collection_runs s union all select 'public.measurements' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.measurements s union all select 'public.member_integration_identities' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.member_integration_identities s union all select 'public.metric_definitions' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.metric_definitions s union all select 'public.metric_directions' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.metric_directions s union all select 'public.object_classes' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.object_classes s union all select 'public.object_state_history' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.object_state_history s union all select 'public.objective_constraints' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.objective_constraints s union all select 'public.objective_health' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.objective_health s union all select 'public.objective_health_statuses' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.objective_health_statuses s union all select 'public.objective_link_relations' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.objective_link_relations s union all select 'public.objective_links' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.objective_links s union all select 'public.objective_metrics' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.objective_metrics s union all select 'public.objective_reason_codes' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.objective_reason_codes s union all select 'public.objective_statuses' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.objective_statuses s union all select 'public.objective_types' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.objective_types s union all select 'public.objective_verification_states' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.objective_verification_states s union all select 'public.objectives' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.objectives s union all select 'public.operating_profile_entries' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.operating_profile_entries s union all select 'public.org_unit_members' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.org_unit_members s union all select 'public.org_units' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.org_units s union all select 'public.ownership_assignments' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.ownership_assignments s union all select 'public.people' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.people s union all select 'public.phone_accounts' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.phone_accounts s union all select 'public.phone_ai_insights' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.phone_ai_insights s union all select 'public.phone_calls' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.phone_calls s union all select 'public.phone_endpoints' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.phone_endpoints s union all select 'public.phone_recordings' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.phone_recordings s union all select 'public.phone_sync_runs' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.phone_sync_runs s union all select 'public.phone_transcripts' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.phone_transcripts s union all select 'public.platform_authority_grants' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.platform_authority_grants s union all select 'public.platform_events' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.platform_events s union all select 'public.platform_jobs' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.platform_jobs s union all select 'public.policies' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.policies s union all select 'public.profiles' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.profiles s union all select 'public.provider_connection_events' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.provider_connection_events s union all select 'public.provider_connections' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.provider_connections s union all select 'public.reason_codes' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.reason_codes s union all select 'public.receptionist_access' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.receptionist_access s union all select 'public.receptionist_feedback' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.receptionist_feedback s union all select 'public.receptionist_mailbox_managers' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.receptionist_mailbox_managers s union all select 'public.receptionist_mailboxes' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.receptionist_mailboxes s union all select 'public.receptionist_voicemail_access_log' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.receptionist_voicemail_access_log s union all select 'public.receptionist_voicemail_candidates' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.receptionist_voicemail_candidates s union all select 'public.receptionist_voicemail_dispatch_receipts' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.receptionist_voicemail_dispatch_receipts s union all select 'public.receptionist_voicemail_email_routes' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.receptionist_voicemail_email_routes s union all select 'public.receptionist_voicemail_intakes' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.receptionist_voicemail_intakes s union all select 'public.receptionist_voicemail_job_receipts' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.receptionist_voicemail_job_receipts s union all select 'public.receptionist_voicemail_jobs' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.receptionist_voicemail_jobs s union all select 'public.receptionist_voicemail_scan_receipts' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.receptionist_voicemail_scan_receipts s union all select 'public.receptionist_voicemail_scans' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.receptionist_voicemail_scans s union all select 'public.receptionist_voicemail_sources' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.receptionist_voicemail_sources s union all select 'public.receptionist_voicemails' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.receptionist_voicemails s union all select 'public.receptionist_workspaces' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.receptionist_workspaces s union all select 'public.recommendations' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.recommendations s union all select 'public.responsibility_assignments' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.responsibility_assignments s union all select 'public.responsibility_handoffs' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.responsibility_handoffs s union all select 'public.review_tasks' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.review_tasks s union all select 'public.sites' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.sites s union all select 'public.slack_history_imports' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.slack_history_imports s union all select 'public.slack_message_versions' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.slack_message_versions s union all select 'public.slack_messages' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.slack_messages s union all select 'public.slack_recurring_channels' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.slack_recurring_channels s union all select 'public.slack_recurring_requests' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.slack_recurring_requests s union all select 'public.slack_recurring_thread_members' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.slack_recurring_thread_members s union all select 'public.slack_recurring_thread_windows' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.slack_recurring_thread_windows s union all select 'public.slack_thread_imports' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.slack_thread_imports s union all select 'public.slack_workspace_pacing' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.slack_workspace_pacing s union all select 'public.state_definitions' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.state_definitions s union all select 'public.state_transitions' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.state_transitions s union all select 'public.system_health_checks' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.system_health_checks s union all select 'public.system_health_components' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.system_health_components s union all select 'public.team_members' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.team_members s union all select 'public.telephony_directory' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.telephony_directory s union all select 'public.telephony_inventory' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.telephony_inventory s union all select 'public.tenant_connectors' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.tenant_connectors s union all select 'public.tenant_vocabulary' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.tenant_vocabulary s union all select 'public.tenants' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.tenants s union all select 'public.view_as_context' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from public.view_as_context s union all select 'storage.buckets' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from storage.buckets s union all select 'storage.buckets_analytics' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from storage.buckets_analytics s union all select 'storage.buckets_vectors' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from storage.buckets_vectors s union all select 'storage.migrations' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from storage.migrations s union all select 'storage.objects' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from storage.objects s union all select 'storage.s3_multipart_uploads' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from storage.s3_multipart_uploads s union all select 'storage.s3_multipart_uploads_parts' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from storage.s3_multipart_uploads_parts s union all select 'storage.vector_indexes' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from storage.vector_indexes s union all select 'vault.secrets' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from vault.secrets s)x) then raise exception 'Retained data changed';end if;
end$$;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref)
 values(current_setting('serviceos.release_source_sha256'),'learn_slack_campaigns_v1','saatxzwxvdvqevbnskxy');
notify pgrst,'reload schema';
select 'slack_campaigns_installed' marker,(select md5(coalesce(string_agg(jsonb_build_object('definition',pg_get_functiondef(p.oid),'owner',r.rolname,'acl',p.proacl)::text,'' order by p.proname,pg_get_function_identity_arguments(p.oid)),'')) fingerprint from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname='public' and p.prokind in('f','p')) fingerprint;
commit;
