import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{LearnSlackEvidence}from'../../src/components/client-portal/learn/LearnSlackEvidence';
import{scenario}from'./supabase';
import'../../src/styles.css';import'../../src/styles/client-workspace.css';
const id=(n:number)=>`a0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function Preview(){const[tenant,setTenant]=useState(id(1)),[operator,setOperator]=useState(false),[reason,setReason]=useState('Selected synthetic company review');
return <main className="cp-root mx-auto max-w-4xl space-y-4 p-5"><h1>Synthetic Slack evidence review</h1><p>No live credentials, provider calls or company data. This runs the actual evidence and source components.</p>
<div className="flex flex-wrap gap-3"><button className="cp-secondary" onClick={()=>setOperator(!operator)}>Switch client / operator</button><button className="cp-secondary" onClick={()=>setTenant(tenant===id(1)?id(101):id(1))}>Switch synthetic company</button>
<button className="cp-secondary" onClick={()=>{scenario.fail=!scenario.fail;}}>Toggle failed read</button><button className="cp-secondary" onClick={()=>{scenario.denied=!scenario.denied;}}>Toggle revoked access</button><button className="cp-secondary" onClick={()=>{scenario.changed=!scenario.changed;}}>Toggle changed source</button><button className="cp-secondary" onClick={()=>{scenario.delay=!scenario.delay;}}>Toggle delayed response</button></div>
<p>{operator?'Operator':'Client owner'} · {tenant===id(1)?'Synthetic A':'Synthetic B'}</p>{operator&&<label>Reason for access<input value={reason} onChange={e=>setReason(e.target.value)}/></label>}
<LearnSlackEvidence tenantId={tenant} actorId={id(2)} operatorReason={operator?reason:undefined}/></main>;}
createRoot(document.getElementById('root')!).render(<Preview/>);
