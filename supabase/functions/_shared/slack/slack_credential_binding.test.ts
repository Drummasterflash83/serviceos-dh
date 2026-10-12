import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readSlackCredentialBinding} from './slack_credential_binding.ts';
const secretRef='00000000-0000-4000-8000-000000000006';
test('legacy bot and explicit user select their own credential without fallback',()=>{
 const base={non_secret_config:{team_id:'T123'},configured_fields:['bot_token','user_token'],secret_refs:{bot_token:secretRef,user_token:secretRef}};
 assert.deepEqual(readSlackCredentialBinding(base),{kind:'bot',field:'bot_token',userId:null,secretRef});
 const user={...base,non_secret_config:{...base.non_secret_config,credential_kind:'user',authorized_user_id:'U123'}};
 assert.deepEqual(readSlackCredentialBinding(user),{kind:'user',field:'user_token',userId:'U123',secretRef});
 for(const change of [
  {non_secret_config:{credential_kind:'user'}},
  {non_secret_config:{credential_kind:'user',authorized_user_id:'B123'}},
  {non_secret_config:{credential_kind:'user',authorized_user_id:'U123\n'}},
  {non_secret_config:{credential_kind:'bot',authorized_user_id:'U123'}},
  {non_secret_config:{authorized_user_id:'U123'}},
  {non_secret_config:{credential_kind:null}},
  {non_secret_config:{credential_kind:'unknown'}},
  {configured_fields:['bot_token']},
  {secret_refs:{bot_token:secretRef}},
  {secret_refs:{user_token:'not-a-uuid',bot_token:secretRef}},
 ])assert.equal(readSlackCredentialBinding({...user,...change}),null);
});
