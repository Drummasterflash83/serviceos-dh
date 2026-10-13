-- Retain the exact observed undocumented subtype for review. This does not
-- classify canvas updates as conversations or performance evidence. No source,
-- approval, credential, schedule or access change is made by installation.
begin;
do $$declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.learn_slack_message_kind(jsonb)'::regprocedure);
 needle:=$old$if m->>'subtype'='welcome_party' then return 'source_needs_review';end if;$old$;
 replacement:=$new$if m->>'subtype' in ('welcome_party','tabbed_canvas_updated') then return 'source_needs_review';end if;$new$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed observed-source classifier differs';end if;
 execute replace(d,needle,replacement);
 -- Keep the authorised coverage reader honest about newly retained held sources.
 d:=pg_get_functiondef('public.learn_slack_campaign_read(uuid,uuid)'::regprocedure);
 needle:=$old$sm.provider_payload->>'subtype'='welcome_party'$old$;
 replacement:=$new$sm.provider_payload->>'subtype' in ('welcome_party','tabbed_canvas_updated')$new$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed source-review counter differs';end if;
 execute replace(d,needle,replacement);
end$$;
commit;
