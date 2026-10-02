import test from "node:test";
import assert from "node:assert/strict";
import { clearLaunchModel } from "./receptionist-launch-clear-contract.ts";
import { approvedOrdinaryDestination } from "./receptionist-launch-destinations.ts";
const candidate = { id:"dcfc2e66-a438-43ab-b863-467f5a5089df", firstMessage:"openfolk_holidays", model:{provider:"openai",model:"gpt-4.1",toolIds:["handoff"],tools:[{type:"transferCall",destinations:Array.from({length:10},(_,n)=>({type:"number",number:`+44179437810${n}`,description:`Approved destination ${n}`,message:"",transferPlan:{mode:"blind-transfer"}}))}]}};
test("one deterministic status/contract preserves model and exact approved route values",()=>{const m=clearLaunchModel(candidate);assert.equal(m.messages.length,1);assert.equal(m.temperature,0);assert.deepEqual(m.tools,[{...candidate.model.tools[0],destinations:candidate.model.tools[0].destinations.map(approvedOrdinaryDestination)}]);assert.equal(m.toolIds,candidate.model.toolIds);assert.equal(m.model,candidate.model.model);const s=m.messages[0].content;for(const key of ["CURRENT OFFICE STATUS","08:30","17:00","2026-12-25","2027-12-28","0800111999","Carbon-monoxide","Julie Monday09:00","Larne","GFSL","01794378105","01794378096","Route-Emergency-to-Rob-or-Tony","NEVER read it again","personal109/105"])assert.ok(s.includes(key),key);assert.ok(s.length<17000);});
test("refuses live or unexpectedly changed transfer configuration",()=>{assert.throws(()=>clearLaunchModel({...candidate,id:"live"}));assert.throws(()=>clearLaunchModel({...candidate,firstMessage:""}));assert.throws(()=>clearLaunchModel({...candidate,model:{...candidate.model,tools:[]}}));});
test("emergency intake uses direct missing-field questions and does not invent privacy or booking assurances",()=>{
  const before=structuredClone(candidate);
  const content=clearLaunchModel(candidate).messages[0].content;
  for(const rule of [
    'Never invent privacy or retention assurances',
    'Explain the immediate purpose of a question only',
    'Never say "I can arrange emergency help"',
    'For missing name ask only "What\'s your name?"',
    'So the engineer knows who\'s calling.',
    'For missing callback ask only "What\'s your callback number?"',
    'For missing location ask only "What\'s the address and postcode?"',
    'if they explicitly correct home to business, accept the correction',
    'the next action is the handoff, not another intake turn',
  ]) assert.ok(content.includes(rule),rule);
  assert.deepEqual(candidate,before,"source candidate must not be mutated");
});
