/** Explicit isolated TEST option. Undefined preserves existing consent; unknown
 * configuration fails closed. This never revokes or changes granted tokens. */
export function gmailConsent(mode:unknown){
 if(mode!==undefined&&mode!==null&&mode!==''&&mode!=='learn_readonly')throw Error('gmail_scope_mode_invalid');
 const readonly=mode==='learn_readonly';
 return {mode:readonly?'learn_readonly':'existing',scopes:['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/userinfo.email',...(readonly?[]:['https://www.googleapis.com/auth/gmail.send'])],includeGrantedScopes:readonly?'false':'true'};
}
