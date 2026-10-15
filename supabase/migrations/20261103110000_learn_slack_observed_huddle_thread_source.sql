-- Slack's conversations.history example includes an exact huddle_thread marker.
-- Retain it as source evidence without treating a huddle as customer conversation,
-- staff performance, a recording, or permission to read any huddle content.
begin;
do $$declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.learn_slack_message_kind(jsonb)'::regprocedure);
 needle:=$old$if m->>'subtype' in ('welcome_party','tabbed_canvas_updated','automatic_ai_huddle_notes_enabled') then return 'source_needs_review';end if;$old$;
 replacement:=$new$if m->>'subtype' in ('welcome_party','tabbed_canvas_updated','automatic_ai_huddle_notes_enabled','huddle_thread') then return 'source_needs_review';end if;$new$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed huddle-thread classifier baseline differs';end if;
 execute replace(d,needle,replacement);
 d:=pg_get_functiondef('public.learn_slack_campaign_read(uuid,uuid)'::regprocedure);
 needle:=$old$sm.provider_payload->>'subtype' in ('welcome_party','tabbed_canvas_updated','automatic_ai_huddle_notes_enabled')$old$;
 replacement:=$new$sm.provider_payload->>'subtype' in ('welcome_party','tabbed_canvas_updated','automatic_ai_huddle_notes_enabled','huddle_thread')$new$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed huddle-thread coverage baseline differs';end if;
 execute replace(d,needle,replacement);
end$$;
commit;
