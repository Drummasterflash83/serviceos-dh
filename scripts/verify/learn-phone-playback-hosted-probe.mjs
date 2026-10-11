import {readFileSync} from "node:fs";
/** Banned synthetic identities exist only inside the rolled-back probe. */
export function phonePlaybackHostedProbe(){
  let probe = readFileSync("scripts/verify/learn-phone-playback.assert.sql", "utf8");
  probe = probe.replace(
    "insert into tenants(id,name) values('fae019ce-aaaa-4000-8000-000000000001','Playback fixture A'),('fae019ce-aaaa-4000-8000-000000000002','Playback fixture B');",
    `insert into tenants(id,slug,display_name) values('fae019ce-aaaa-4000-8000-000000000001','playback-rollback-a','Playback fixture A'),('fae019ce-aaaa-4000-8000-000000000002','playback-rollback-b','Playback fixture B');
 insert into auth.users(id,email,banned_until) values('fae019ce-aaaa-4000-8000-000000000010','playback-rollback-owner@example.invalid','infinity'),('fae019ce-aaaa-4000-8000-000000000011','playback-rollback-viewer@example.invalid','infinity');`,
  );
  probe = probe.replace(
    "'fae019ce-aaaa-4000-8000-000000000001','viewer');",
    "'fae019ce-aaaa-4000-8000-000000000001','viewer') on conflict(id) do update set tenant_id=excluded.tenant_id,role=excluded.role;",
  );
  probe = probe.replace(/^select 'PASS:[^\n]*';$/m, "");
return probe;
}
