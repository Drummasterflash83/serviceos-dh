import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {requireTenantUser} from '../_shared/authz.ts';
import {readLaunchStatus} from './handler.ts';
import {launchReadMode} from './read-mode.ts';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
const reply=(body:unknown,status:number)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers});if(req.method!=='POST')return reply({error:{code:'method_not_allowed'}},405);
 if(['x-internal-tenant-id','x-openfolk-machine-key','x-openfolk-actor'].some(h=>req.headers.has(h)))return reply({error:{code:'user_required'}},403);
 try{
  const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!anon||!key)return reply({error:{code:'config_error'}},503);
  const raw=await req.text();if(raw.length>256)return reply({error:{code:'invalid_request'}},400);
  const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const db=createClient(url,anon,{global:{headers:{Authorization:req.headers.get('Authorization')??''}},auth:{persistSession:false,autoRefreshToken:false}});
  const read=launchReadMode(db,Deno.env.get('LEARN_STATUS_READ_MODE'),url);
  const result=await readLaunchStatus(JSON.parse(raw),read.db,async()=>{const a=await requireTenantUser(req,admin);return a.ok?{userId:a.ctx.userId,tenantId:a.ctx.tenantId,role:a.ctx.role}:null;},Date.now,read.ownerAdminOnly);
  return reply(result.body,result.status);
 }catch{return reply({error:{code:'unavailable'}},503);}
});
