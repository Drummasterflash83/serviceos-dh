import type { ReadClient } from './handler.ts';
export const TEST_ORIGIN = 'https://saatxzwxvdvqevbnskxy.supabase.co';
export const PRODUCTION_ORIGIN = 'https://tgbnakbxwcqjeimygroz.supabase.co';
export const METADATA_TABLES = ['email_messages','phone_calls','phone_recordings','phone_transcripts',
  'email_accounts','google_workspace_mailboxes','email_sync_runs','phone_sync_runs'] as const;

/** Server-only opt-in. No automatic fallback to original private source tables. */
export function launchReadMode(db: ReadClient, mode: string | undefined, origin: string) {
  if (mode === undefined || mode === '' || mode === 'existing') return { db, ownerAdminOnly: false };
  const scoped = (mode === 'test_metadata_views' && origin === TEST_ORIGIN) ||
    (mode === 'production_metadata_views' && origin === PRODUCTION_ORIGIN);
  if (!scoped) throw Error('Unsupported launch read configuration');
  const mapped: ReadClient = { from(table) {
    if (!(METADATA_TABLES as readonly string[]).includes(table))
      throw Error('Source is outside the metadata view contract');
    return db.from(`learn_launch_${table}`);
  } };
  return { db: mapped, ownerAdminOnly: true };
}
