import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {createRootRoute,createRoute,createRouter,RouterProvider,useSearch} from '@tanstack/react-router';
import {ClientPortal} from './source/components/client-portal/ClientPortal';
import {OperatorShell} from './source/components/app/OperatorShell';
import {LearnReview} from './LearnReview';
import {LearnLaunchPortal} from '../../src/components/client-portal/learn/LearnLaunchPortal';
function ReviewContent(){return new URLSearchParams(location.search).get('launch')==='1'?<><p role="status" className="lr-review-banner">Synthetic TEST wiring preview · no provider traffic</p><LearnLaunchPortal tenantId="11111111-1111-4111-8111-111111111111"/></>:<LearnReview tenantId="11111111-1111-4111-8111-111111111111"/>;}
import './source/styles/client-workspace.css';
import './source/styles/workspace-navigation.css';
import './learn-review.css';
const queryClient=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});
function ReviewRoute(){const search=useSearch({strict:false}) as any;const[section,setSection]=useState<any>('learning');const[message,setMessage]=useState('');if(location.pathname==='/operator-review')return <OperatorShell company="Drummond’s · review" tenantId="11111111-1111-4111-8111-111111111111" section={section} pageTitle="LEARN review" onModule={()=>setMessage('Existing client modules remain unchanged; this local review covers LEARN only.')} onSection={next=>{setSection(next);setMessage(next==='learning'?'':'This local review covers LEARN only. Existing operator tools remain unchanged.');}}>{message&&<p role="status" className="lr-notice">{message}</p>}<div className="cp-root op-embedded"><ReviewContent/></div></OperatorShell>;return <ClientPortal tenantId="11111111-1111-4111-8111-111111111111" section={search.section??'learn'} receptionistPage={search.view??'today'} previewContent={<ReviewContent/>}/>;}
const root=createRootRoute({component:()=> <ReviewRoute/>});
const client=createRoute({getParentRoute:()=>root,path:'/client',validateSearch:(s:any)=>({section:s.section??'learn',view:s.view})});
const operator=createRoute({getParentRoute:()=>root,path:'/operator-review'});
const router=createRouter({routeTree:root.addChildren([client,operator])});
function App(){const[message,setMessage]=useState('');useEffect(()=>{const fn=(e:Event)=>setMessage((e as CustomEvent).detail);window.addEventListener('preview-message',fn);return()=>window.removeEventListener('preview-message',fn);},[]);return <QueryClientProvider client={queryClient}><RouterProvider router={router}/>{message&&<div className="lr-toast" role="status">{message}<button onClick={()=>setMessage('')} aria-label="Dismiss preview message">×</button></div>}</QueryClientProvider>;}
createRoot(document.getElementById('root')!).render(<App/>);
