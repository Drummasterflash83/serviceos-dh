import test from 'node:test';
import assert from 'node:assert/strict';
import {assessmentPeriod,assessmentTimeField} from './learn-assessment-period.ts';
const now=Date.parse('2026-10-09T21:40:51.300Z');
test('a completed same-day interval includes seconds and stays explicitly UTC',()=>{
 assert.deepEqual(assessmentPeriod('2026-10-09T21:35:02','2026-10-09T21:40:51',now),{start:'2026-10-09T21:35:02.000Z',end:'2026-10-09T21:40:51.000Z'});
 assert.equal(assessmentTimeField(now),'2026-10-09T21:40:51');
});
test('UTC inputs do not acquire the machine timezone, including DST boundaries',()=>{
 const prior=process.env.TZ;try{process.env.TZ='Pacific/Honolulu';assert.deepEqual(assessmentPeriod('2026-10-25T01:30','2026-10-25T02:30',Date.parse('2026-10-26T00:00Z')),{start:'2026-10-25T01:30:00.000Z',end:'2026-10-25T02:30:00.000Z'});}finally{if(prior===undefined)delete process.env.TZ;else process.env.TZ=prior;}
});
test('future, reversed, malformed and normalized-invalid calendar inputs are refused',()=>{
 for(const [from,until] of [['2026-10-09T21:40:00','2026-10-09T21:40:52'],['2026-10-09T21:40:00','2026-10-09T21:40:00'],['2026-02-30T00:00','2026-03-01T01:00'],['2026-10-09','2026-10-09T21:40'],['2026-10-09T24:00','2026-10-10T01:00'],['2026-10-09T21:00+01:00','2026-10-09T21:40']])assert.throws(()=>assessmentPeriod(from,until,now));
});
