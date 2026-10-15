import test from 'node:test';
import assert from 'node:assert/strict';
import {cardBrief} from './learn-card-brief.ts';
import type {LearnCardDetail} from './learn-cards.ts';
const detail = (findings: any[] = [], evidence: any[] = []): LearnCardDetail => ({
 card: { id: 'fixture', kind: 'customer', title: 'Synthetic customer', subtitle: null, recordState: 'saved', jobStatus: null, updatedAt: null },
 findings, evidence, gaps: [], moreFindings: false, moreEvidence: false,
 observedAt: '2026-10-13T10:00:00Z', validUntil: '2026-10-13T10:01:00Z',
});
test('empty evidence does not invent an owner, next action or completed work',()=>{
 const value=cardBrief(detail());assert.equal(value.next,null);assert.equal(value.latest,null);assert.equal(value.closed.length,0);
});
test('closed work is separated and overdue outstanding evidence comes first',()=>{
 const value=cardBrief(detail([
  {id:'1',type:'Action',status:'completed',overdue:true,owner:'A'},
  {id:'2',type:'Action',status:'open',overdue:false,deadline:null},
  {id:'3',type:'Action',status:'waiting',overdue:true,deadline:'2026-10-01',owner:null},
 ],[{id:'old',occurredAt:'2026-09-01'},{id:'new',occurredAt:'2026-10-01'}]));
 assert.equal(value.next?.id,'3');assert.equal(value.next?.owner,null);assert.equal(value.closed.length,1);assert.equal(value.outstanding.length,2);assert.equal(value.latest?.id,'new');
});
test('bounded or incomplete evidence remains explicitly limited',()=>{
 const value=cardBrief({...detail(),moreFindings:true});assert.equal(value.limited,true);
});

test('observations, cancelled and draft actions never become work completed or outstanding',()=>{
 const value=cardBrief(detail([{id:'1',type:'Observation',status:'monitoring'},{id:'2',type:'Action',status:'cancelled'},{id:'3',type:'Action',status:'draft'}]));
 assert.equal(value.outstanding.length,0);assert.equal(value.closed.length,0);assert.equal(value.next,null);
});
