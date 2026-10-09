import {SlackHistoryTransportError} from './slack_history_errors.ts';
import {assertSlackHistoryScope} from './slack_history.ts';
export type HistoryRequestIdentity={tenantId:string;accountId:string;teamId:string;channelId:string;oldest:string;latest:string;consentReference:string;expiresAt:string;maxPages:number;parentTimestamp?:string};
export type HistoryRequestBinding={teamId:string;channelId:string;isPrivate:false;isShared:false;isMember:true;authorised:()=>Promise<boolean>;request:(method:string,body:Record<string,unknown>)=>Promise<any>};
export type BindHistoryRequest=(identity:HistoryRequestIdentity)=>Promise<HistoryRequestBinding|null>;

export type HistoryArguments={channel:string;oldest:string;latest:string;limit:15;cursor?:string;ts?:string};
export type ChannelAttestation={tenantId:string;accountId:string;teamId:string;channelId:string;isPrivate:boolean;isShared:boolean;isMember:boolean};
/** Implemented only by the credential-owning server. Credentials never cross
 * this port. Acquisition must resolve the account and approved consent from
 * authoritative storage, rather than accept a queued/browser claim as authority. */
export interface HistoryServerLease {
 identity:Readonly<HistoryRequestIdentity>;
 authorised:()=>Promise<boolean>;
 inspectChannel:()=>Promise<ChannelAttestation>;
 // Transport rechecks its credential/consent lease at execution and does not
 // retry denied requests inline. Database publication also rechecks authority.
 history:(args:HistoryArguments)=>Promise<unknown>;
}
export interface HistoryServerPorts {
 acquire:(identity:Readonly<HistoryRequestIdentity>)=>Promise<HistoryServerLease|null>;
}
const fields=['tenantId','accountId','teamId','channelId','oldest','latest','consentReference','expiresAt','maxPages','parentTimestamp'] as const;
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
/** Source-only adapter. No fetch, token lookup, env access or runtime registration.
 * A missing server implementation fails closed. Only bounded public-channel
 * history can reach the injected credential-owning transport. */
export function createHistoryRequestAdapter(ports?:HistoryServerPorts,clock:()=>number=Date.now):BindHistoryRequest {
 return async supplied=>{
  try {
   const identity=Object.freeze({...supplied});
   assertSlackHistoryScope({...identity,channelIds:[identity.channelId]},identity.tenantId,identity.channelId,null);
   if(!ports||!uuid(identity.accountId)||typeof identity.consentReference!=='string'||!identity.consentReference.trim()||identity.consentReference.length>2000||Number(identity.latest)-Number(identity.oldest)>86400||!Number.isSafeInteger(identity.maxPages)||identity.maxPages<1||identity.maxPages>10||typeof identity.expiresAt!=='string'||!Number.isFinite(Date.parse(identity.expiresAt)))return null;
   const unexpired=()=>{const now=clock();return Number.isFinite(now)&&Date.parse(identity.expiresAt)>now;};
   if(!unexpired()||identity.parentTimestamp!==undefined&&(!/^\d{1,12}\.\d{1,6}$/.test(identity.parentTimestamp)||Number(identity.parentTimestamp)>Number(identity.latest)))return null;
   const lease=await ports.acquire(identity);
   if(!lease)return null;
   const authorised=async()=>{try{
    if(!unexpired()||!fields.every(k=>lease.identity[k]===identity[k])||!await lease.authorised())return false;
    const channel=await lease.inspectChannel();
    return fields.slice(0,4).every(k=>channel[k as keyof ChannelAttestation]===identity[k])&&channel.isPrivate===false&&channel.isShared===false&&channel.isMember===true&&unexpired()&&await lease.authorised()&&fields.every(k=>lease.identity[k]===identity[k]);
   }catch(error){if(error instanceof SlackHistoryTransportError)throw error;return false;}};
   if(!await authorised())return null;
   let requests=0;
   return {teamId:identity.teamId,channelId:identity.channelId,isPrivate:false,isShared:false,isMember:true,authorised,
    request:async(method,body)=>{
     const allowed=['channel','oldest','latest','limit','cursor',...(identity.parentTimestamp?['ts']:[])];
     if(method!==(identity.parentTimestamp?'conversations.replies':'conversations.history')||body?.ts!==identity.parentTimestamp||!body||Object.keys(body).some(k=>!allowed.includes(k))||body.channel!==identity.channelId||body.oldest!==identity.oldest||body.latest!==identity.latest||body.limit!==15||body.cursor!==undefined&&(typeof body.cursor!=='string'||body.cursor.length===0||body.cursor.length>1024))throw Error('history_request_scope_unavailable');
     // Copy validated input before any await; callers cannot mutate the request.
     const args:HistoryArguments={channel:identity.channelId,oldest:identity.oldest,latest:identity.latest,limit:15,...(identity.parentTimestamp?{ts:identity.parentTimestamp}:{}),...(body.cursor===undefined?{}:{cursor:body.cursor as string})};
     if(!await authorised())throw Error('history_request_authority_unavailable');
     if(requests>=identity.maxPages)throw Error('history_request_budget_exhausted');
     requests++; // Reserve synchronously, including failed calls; no retry loop.
     const page=await lease.history(args);
     if(!await authorised())throw Error('history_request_authority_changed');
     return page;
    }};
  }catch(error){if(error instanceof SlackHistoryTransportError)throw error;return null;}
 };
}
