import { DRUMMONDS_FY27_PAIR } from './new-dawn-fy27-report-pair.ts';

export type DailyQuickBooksStatus = {
  enabled: boolean;
  revision: number;
  periodStart: string | null;
  latestDay: string | null;
  latestState: 'claimed' | 'prepared' | 'complete' | 'held' | null;
  latestCode: string | null;
  readAt: string;
};

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const day = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`));

export function readDailyQuickBooksStatus(value: unknown, actor: string,
  now = Date.now()): DailyQuickBooksStatus {
  if (!object(value) || value.version !== 'new-dawn-daily-quickbooks-status/1' ||
    value.tenant_id !== DRUMMONDS_FY27_PAIR.tenantId || value.actor_id !== actor ||
    value.connection_id !== DRUMMONDS_FY27_PAIR.connectionId || !uuid(value.audit_id) ||
    typeof value.read_at !== 'string' || !Number.isFinite(Date.parse(value.read_at)) ||
    Math.abs(now - Date.parse(value.read_at)) > 120_000 ||
    typeof value.enabled !== 'boolean' || !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0 ||
    !(value.period_start === null || value.period_start === DRUMMONDS_FY27_PAIR.periodStart) ||
    !(value.latest_day === null || day(value.latest_day)) ||
    !(value.latest_state === null || ['claimed', 'prepared', 'complete', 'held'].includes(String(value.latest_state))) ||
    !(value.latest_code === null || typeof value.latest_code === 'string' &&
      /^[a-z_]{1,80}$/.test(value.latest_code)) ||
    (value.enabled && (value.revision === 0 || value.period_start !== DRUMMONDS_FY27_PAIR.periodStart)) ||
    (value.latest_day === null) !== (value.latest_state === null))
    throw Error('Daily QuickBooks capture status unavailable');
  return { enabled: value.enabled as boolean, revision: value.revision as number,
    periodStart: value.period_start as string | null,
    latestDay: value.latest_day as string | null,
    latestState: value.latest_state as DailyQuickBooksStatus['latestState'],
    latestCode: value.latest_code as string | null, readAt: value.read_at as string };
}
