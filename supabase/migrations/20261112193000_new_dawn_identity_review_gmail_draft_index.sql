-- Install outside an explicit transaction. Concurrent build keeps Email intake writable.
-- The predicate matches the exact Gmail-draft exclusion in
-- public.learn_identity_review_count(uuid); no private message content is indexed.
create index concurrently learn_email_gmail_draft_review_idx
 on public.email_messages (tenant_id, id)
 where provider='gmail'
  and (raw_payload->'label_ids') @> '["DRAFT"]'::jsonb;
