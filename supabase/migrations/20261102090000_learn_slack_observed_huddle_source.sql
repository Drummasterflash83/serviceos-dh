-- Retain this exact provider-observed subtype without inferring business meaning.
-- No source, account, permission, credential or schedule changes on installation.
begin;
do $$declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.learn_slack_message_kind(jsonb)'::regprocedure);
 needle:=$old$if m->>'subtype' in ('welcome_party','tabbed_canvas_updated') then return 'source_needs_review';end if;$old$;
 replacement:=$new$if m->>'subtype' in ('welcome_party','tabbed_canvas_updated','automatic_ai_huddle_notes_enabled') then return 'source_needs_review';end if;$new$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed huddle-source classifier baseline differs';end if;
 execute replace(d,needle,replacement);
 d:=pg_get_functiondef('public.learn_slack_campaign_read(uuid,uuid)'::regprocedure);
 needle:=$old$sm.provider_payload->>'subtype' in ('welcome_party','tabbed_canvas_updated')$old$;
 replacement:=$new$sm.provider_payload->>'subtype' in ('welcome_party','tabbed_canvas_updated','automatic_ai_huddle_notes_enabled')$new$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed huddle-source coverage baseline differs';end if;
 execute replace(d,needle,replacement);
end$$;
commit;
