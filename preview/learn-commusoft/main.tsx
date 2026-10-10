import React from 'react';import {createRoot} from 'react-dom/client';
import {LearnCommusoftCustomers} from '../../src/components/client-portal/learn/LearnCommusoftCustomers';
import '../../src/styles/client-workspace.css';import '../../src/styles/learn-launch.css';
import {tenant} from './fixture';
createRoot(document.getElementById('root')!).render(<React.StrictMode><main className="cp-root op-embedded" style={{maxWidth:1000,margin:'2rem auto',padding:'1rem'}}><h1>LEARN customer review</h1><p role="status">Synthetic UI only · network access disabled · no hosted data changed</p><LearnCommusoftCustomers tenantId={tenant} canEdit={new URLSearchParams(location.search).get('role')!=='viewer'}/></main></React.StrictMode>);
