/** Definition fingerprint and ACL only; no source data or secret values. */
import { savedCliToken } from "./learn-test-readiness.mjs";
const project = "saatxzwxvdvqevbnskxy";
if (process.argv.slice(2).join(" ") !== "--test-read-only")
  throw Error("Explicit TEST read-only mode required");
const query = `select md5(pg_get_functiondef(p.oid)) definition_md5,
 length(pg_get_functiondef(p.oid)) definition_bytes,
 (length(pg_get_functiondef(p.oid))-
  length(replace(pg_get_functiondef(p.oid),
   'next_allowed_at=greatest(clock_timestamp()+interval ''60 seconds'',blocked_until)','')))
  / length('next_allowed_at=greatest(clock_timestamp()+interval ''60 seconds'',blocked_until)')
  exact_cooldown_occurrences,
 p.prosecdef security_definer,
 has_function_privilege('service_role',p.oid,'EXECUTE') service_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute
from pg_proc p where p.oid=
 'public.learn_slack_finish_event_job(uuid,uuid,text,integer,jsonb)'::regprocedure`;
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(30000),
  headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
});
if (!response.ok) throw Error(`TEST definition readback HTTP ${response.status}`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length !== 1 ||
  !/^[a-f0-9]{32}$/.test(rows[0]?.definition_md5 ?? "") ||
  !Number.isSafeInteger(rows[0]?.definition_bytes) ||
  !Number.isSafeInteger(rows[0]?.exact_cooldown_occurrences) ||
  typeof rows[0]?.security_definer !== "boolean" ||
  typeof rows[0]?.service_execute !== "boolean" ||
  typeof rows[0]?.authenticated_execute !== "boolean")
  throw Error("TEST definition readback shape changed");
console.log(JSON.stringify({ project, observedAtUtc: new Date().toISOString(), ...rows[0],
  productionDataWrites: false, sourceProviderRequests: 0 }));
