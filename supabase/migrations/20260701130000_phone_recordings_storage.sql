-- ServiceOS — Phone Input Phase-3: private storage bucket for recording audio.
--
-- Creates the `phone-recordings` Supabase Storage bucket as PRIVATE (public =
-- false). Recording WAV audio downloaded from Simwood is written here by the
-- simwood-download-recording Edge Function using the service-role key (which
-- bypasses storage RLS). No public URLs are created; future playback will use
-- short-lived signed URLs.
--
-- Idempotent. If your environment restricts direct inserts into storage.buckets,
-- create the bucket manually instead (see README "Phase Phone-3") and this
-- statement becomes a no-op.
--
-- NOTE: no changes are made to phone_recordings — the existing `storage_path`
-- column already records where each recording's audio lives.

insert into storage.buckets (id, name, public)
values ('phone-recordings', 'phone-recordings', false)
on conflict (id) do nothing;
