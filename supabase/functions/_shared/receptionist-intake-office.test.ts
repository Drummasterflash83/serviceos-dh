import test from 'node:test';
import assert from 'node:assert/strict';
import { intakeOfficeClosed } from './receptionist-intake-office.ts';

for (const [time,closed] of [
  ['2026-10-02T07:29:00Z',true],['2026-10-02T07:30:00Z',false],
  ['2026-10-02T15:59:00Z',false],['2026-10-02T16:00:00Z',true],
  ['2026-10-03T10:00:00Z',true],['2026-12-25T10:00:00Z',true],
  ['2026-12-29T08:29:00Z',true],['2026-12-29T08:30:00Z',false],
] as const) test(`trusted London office clock ${time}`,()=>assert.equal(intakeOfficeClosed(new Date(time)),closed));
test('unknown calendar and invalid clock fail closed',()=>{
  assert.throws(()=>intakeOfficeClosed(new Date('2028-01-04T10:00Z')));
  assert.throws(()=>intakeOfficeClosed(new Date('invalid')));
});
