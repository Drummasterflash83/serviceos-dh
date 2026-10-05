-- ServiceOS — Gmail Workspace historical backfill: per-mailbox backfill state.
--
-- Tracks a resumable, paginated historical import per email_account (DWD
-- mailboxes). The backfill runs one Gmail list page at a time and stores the
-- nextPageToken so it can continue across many runs without duplicating or
-- deleting anything. Kept separate from the 5-minute recent sync.
--
-- Non-destructive: additive columns only (add column if not exists).

alter table email_accounts
  add column if not exists backfill_status        text not null default 'idle'; -- idle | running | completed | error

alter table email_accounts
  add column if not exists backfill_started_at    timestamptz;

alter table email_accounts
  add column if not exists backfill_completed_at  timestamptz;

alter table email_accounts
  add column if not exists backfill_page_token    text;

alter table email_accounts
  add column if not exists backfill_total_fetched integer not null default 0;

alter table email_accounts
  add column if not exists backfill_error         text;
