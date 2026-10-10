import React from 'react';import {createRoot} from 'react-dom/client';
import {LearnFileImports} from '../../src/components/client-portal/learn/LearnFileImports';
import '../../src/styles/client-workspace.css';import '../../src/styles/learn-launch.css';
import {tenant} from './fixture';
createRoot(document.getElementById('root')!).render(<React.StrictMode><main className="cp-root op-embedded" style={{maxWidth:1000,margin:'2rem auto',padding:'1rem'}}><h1>LEARN file imports</h1><p role="status">Synthetic UI review only · network access disabled · no hosted records changed</p><LearnFileImports tenantId={tenant} canEdit={new URLSearchParams(location.search).get('role')!=='ops'}/></main></React.StrictMode>);
