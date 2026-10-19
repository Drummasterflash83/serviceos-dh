import { verifiedHolidayDates } from './receptionist-launch-consistency.ts';

// Actual server time only. Never use a caller-provided date or unverified override.
export function intakeOfficeClosed(at: Date): boolean {
  if (!Number.isFinite(at.getTime())) throw Error('Office clock unavailable');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit',
    weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23',
  }).formatToParts(at).map(p => [p.type,p.value]));
  if (!['2026','2027'].includes(parts.year)) throw Error('Holiday calendar needs verification');
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const minute = Number(parts.hour)*60+Number(parts.minute);
  return verifiedHolidayDates.includes(date) || !['Mon','Tue','Wed','Thu','Fri'].includes(parts.weekday) || minute < 510 || minute >= 1020;
}
