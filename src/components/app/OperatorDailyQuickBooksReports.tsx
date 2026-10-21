import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase';
import type { QuickBooksConnection } from '@/lib/learn-quickbooks';
import { DRUMMONDS_FY27_PAIR } from '@/lib/new-dawn-fy27-report-pair';
import { readDailyQuickBooksStatus, type DailyQuickBooksStatus } from '@/lib/new-dawn-daily-quickbooks';

const approval = 'Chris New Dawn goal 21 Oct 2026: standing daily read-only FY27 P&L and A/R';

/** One bounded OpenFolk action. The policy alone never starts a provider read. */
export function OperatorDailyQuickBooksReports({ tenantId, actorId, connections }: {
  tenantId: string; actorId: string; connections: QuickBooksConnection[];
}) {
  const [status, setStatus] = useState<DailyQuickBooksStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const connection = connections.find(item =>
    item.id === DRUMMONDS_FY27_PAIR.connectionId &&
    item.environment === 'production' && item.realmId === DRUMMONDS_FY27_PAIR.realmId &&
    item.confirmedAt && ['active', 'paused'].includes(item.status));
  const load = useCallback(async () => {
    setError('');
    try {
      const response = await getSupabaseClient().rpc('learn_quickbooks_daily_report_status',
        { p_tenant: tenantId });
      if (response.error) throw Error('Status unavailable');
      setStatus(readDailyQuickBooksStatus(response.data, actorId));
    } catch {
      setStatus(null);
      setError('Daily report status could not be verified. No policy action is available.');
    }
  }, [tenantId, actorId]);
  useEffect(() => { if (tenantId === DRUMMONDS_FY27_PAIR.tenantId) void load(); }, [tenantId, load]);
  if (tenantId !== DRUMMONDS_FY27_PAIR.tenantId) return null;

  async function change(enabled: boolean) {
    if (!status || !connection || busy || status.enabled === enabled) return;
    setBusy(true); setError('');
    try {
      const response = await getSupabaseClient().rpc('learn_quickbooks_daily_report_control', {
        p_tenant: tenantId, p_connection: DRUMMONDS_FY27_PAIR.connectionId,
        p_revision: status.revision, p_enabled: enabled,
        p_period_start: DRUMMONDS_FY27_PAIR.periodStart,
        p_approval_reference: approval,
        p_reason: enabled
          ? 'Enable approved daily read-only FY27 accrual P&L and aged receivables for Drummonds'
          : 'Pause new daily QuickBooks report capture for Drummonds',
      });
      const result = response.data as Record<string, unknown> | null;
      if (response.error || !result || result.enabled !== enabled ||
        result.revision !== status.revision + 1) throw Error('Outcome unconfirmed');
      await load();
    } catch {
      setStatus(null);
      setError('The policy outcome is unconfirmed. Refresh its audited status before another action.');
    } finally { setBusy(false); }
  }

  return <section className="rounded-xl border p-4 space-y-3" aria-label="Daily QuickBooks report capture">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="font-semibold">Daily QuickBooks source reports</h2>
        <p className="text-sm">Drummonds only · FY27 accrual P&amp;L through the last completed UK day and matching aged receivables. Source reads only; no accounting edits, chases or publication.</p></div>
      <button className="cp-secondary" type="button" onClick={() => void load()} disabled={busy}>Refresh daily status</button>
    </div>
    {!connection && <p role="status">The exact confirmed production company is unavailable. Daily capture cannot be changed.</p>}
    {error && <p role="alert">{error}</p>}
    {status && <>
      <p><strong>{status.enabled ? 'Policy enabled' : 'Policy paused'}</strong> · checked {new Date(status.readAt).toLocaleString('en-GB')}.</p>
      <p className="text-sm">{status.latestDay
        ? `Latest ${status.latestDay}: ${status.latestState === 'complete' ? 'both reports verified' :
          status.latestState === 'held' ? `held for review${status.latestCode ? ` (${status.latestCode})` : ''}` :
            'capture in progress'}.`
        : 'No scheduled daily report pair has been verified yet.'}</p>
      <button className="cp-secondary" type="button" disabled={busy || !connection}
        onClick={() => void change(!status.enabled)}>
        {busy ? 'Checking policy…' : status.enabled ? 'Pause new daily reads' : 'Enable approved daily reads'}
      </button>
      <p className="text-xs text-muted-foreground">Changing this policy is audited. Enabling it permits the scoped runner; a dated complete pair is the proof that a scheduled read actually worked.</p>
    </>}
  </section>;
}
