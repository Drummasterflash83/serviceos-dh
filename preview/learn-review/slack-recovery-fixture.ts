const tenant='11111111-1111-4111-8111-111111111111',account='88888888-8888-4888-8888-000000000001';
export function slackRecoveryFixture(name:string,args:any) {
 const scenario=new URLSearchParams(location.search).get('recovery')??'normal';
 if(scenario==='error')return{data:null,error:{code:'synthetic'}};
 const key=`serviceos:synthetic:recovery:${scenario}`;
 let fixture=JSON.parse(sessionStorage.getItem(key)??'null');
 if(!fixture){const end=Date.now()-3600000;fixture={requests:{},state:{version:'learn-slack-history/1',tenantId:tenant,accountId:account,name:'Synthetic service desk',teamId:'TFIXTURE',channelId:'CEXAMPLE',approvalId:'88888888-8888-4888-8888-000000000020',approvedAt:new Date(end).toISOString(),previousApprovalId:null,recoveryMode:null,stateVersion:'a'.repeat(64),stateValid:true,active:false,canContinue:!['disabled','complete'].includes(scenario),canRestart:!['disabled','complete'].includes(scenario),window:{start:new Date(end-86400000).toISOString(),end:new Date(end).toISOString(),pageLimit:3,expiresAt:new Date(end+86400000).toISOString()},progress:{pagesThisApproval:3,complete:scenario==='complete',hasCursor:scenario!=='complete'},latestJob:{id:'88888888-8888-4888-8888-000000000030',status:'succeeded',availableAt:null,errorCode:null,stopReason:scenario==='complete'?'window_pages_complete':'page_budget_exhausted'},coverage:'bounded_channel_window'}};sessionStorage.setItem(key,JSON.stringify(fixture));}
 if(args.p_tenant_id!==tenant||args.p_account_id!==account)return{data:null,error:{code:'42501'}};
 if(name==='learn_slack_history_read')return{data:fixture.state,error:null};
 if(scenario==='viewer')return{data:null,error:{code:'42501'}};
 if(fixture.requests[args.p_request_id])return{data:{...fixture.requests[args.p_request_id],reused:true},error:null};
 if(scenario==='stale'||args.p_expected_state_version!==fixture.state.stateVersion)return{data:null,error:{code:'PT409'}};
 const receipt={requestId:args.p_request_id,accountId:account,jobId:crypto.randomUUID(),reused:false};
 fixture.requests[args.p_request_id]=receipt;
 fixture.state={...fixture.state,approvalId:args.p_request_id,previousApprovalId:fixture.state.approvalId,recoveryMode:args.p_mode,stateVersion:'b'.repeat(64),active:true,canContinue:false,canRestart:false,progress:{pagesThisApproval:0,complete:false,hasCursor:args.p_mode==='continue'},window:{...fixture.state.window,pageLimit:args.p_max_pages},latestJob:{id:receipt.jobId,status:'queued',availableAt:new Date().toISOString(),errorCode:null,stopReason:null}};
 sessionStorage.setItem(key,JSON.stringify(fixture));
 if(scenario==='uncertain')return{data:null,error:{code:'synthetic_lost_response'}};
 return{data:receipt,error:null};
}
