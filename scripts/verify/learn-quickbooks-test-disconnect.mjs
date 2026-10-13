/** Additive TEST-only disconnect schema. No connection, credential or action is seeded. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken } from "./learn-test-readiness.mjs";
const project = "saatxzwxvdvqevbnskxy", phase = process.argv[2];
if (!["prepare", "rehearse", "install", "verify"].includes(phase) || process.argv.length !== 3) throw Error("Specify release phase");
const root = new URL("../../", import.meta.url);
const name = "20261102030000_learn_quickbooks_disconnect.sql", release = "quickbooks_disconnect_v1";
const source = readFileSync(new URL("supabase/migrations/" + name, root), "utf8");
const sha = s => createHash("sha256").update(s).digest("hex"), md5 = s => createHash("md5").update(s).digest("hex");
const quote = s => "'" + s.replaceAll("'", "''") + "'";
const bundlePath = new URL("supabase/release/quickbooks-test/003_disconnect.sql", root);
const manifestPath = new URL("supabase/release/quickbooks-test/003_disconnect.manifest.json", root);
const foundation = JSON.parse(readFileSync(new URL("supabase/release/quickbooks-test/001_foundation.manifest.json", root), "utf8"));
const token = savedCliToken();
async function query(sql, write = false) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${write ? "" : "/read-only"}`, {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, ...(write ? { read_only: false } : {}) }), redirect: "error", signal: AbortSignal.timeout(45000),
  });
  if (!r.ok) throw Error("TEST request unconfirmed: HTTP " + r.status);
  const chunks = []; let length = 0;
  for await (const c of r.body) { length += c.byteLength; if (length > 1048576) throw Error("TEST metadata exceeds bound"); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
const functions = text => [...text.matchAll(/create function public\.(learn_quickbooks_[a-z_]+)\([\s\S]*?\$\$([\s\S]*?)\$\$;/g)].map(m => ({ name: m[1], md5: md5(m[2]), securityDefiner: /security definer/.test(m[0].split("$$")[0]) }));
const ownFunctions = functions(source);
if (ownFunctions.length !== 8) throw Error("TEST disconnect function manifest incomplete");
const signatures = ["auth.uid()", "auth.role()", "public.learn_operator_input_access(uuid,uuid,boolean)", "public.learn_quickbooks_actor_access(uuid,uuid)", "public.provider_secret_name(uuid,text,text)", "vault.update_secret(uuid,text,text,text,uuid)"];
async function verifyBodies(expected) {
  const deployed = await query(`select p.proname name,md5(p.prosrc) md5,pg_get_userbyid(p.proowner) owner,p.prosecdef security_definer,p.proconfig configuration from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (${expected.map(f => quote(f.name)).join(",")})`);
  if (deployed.length !== expected.length || expected.some(f => !deployed.some(d => d.name === f.name && d.md5 === f.md5 && d.owner === "postgres" && d.security_definer === f.securityDefiner && JSON.stringify(d.configuration) === JSON.stringify(["search_path=pg_catalog"])))) throw Error("TEST prerequisite/runtime function differs");
}
async function verify() {
  const receipts = await query(`select release_id,source_hashes,installed_at from public.learn_quickbooks_release_receipts where release_id in ('quickbooks_foundation_v1','${release}')`);
  if (JSON.stringify(receipts.find(r => r.release_id === "quickbooks_foundation_v1")?.source_hashes) !== JSON.stringify(foundation.sourceHashes)) throw Error("TEST foundation receipt mismatch");
  const own = receipts.find(r => r.release_id === release);
  if (!own) {
    const absent = await query("select to_regclass('public.learn_quickbooks_disconnections') is null and not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname like 'learn_quickbooks_disconnect_%') as absent");
    if (absent[0]?.absent !== true) throw Error("TEST disconnect objects exist without receipt");
    return { state: "not_installed", project };
  }
  if (JSON.stringify(own.source_hashes) !== JSON.stringify([{ name, sha256: sha(source) }])) throw Error("TEST disconnect receipt mismatch");
  await verifyBodies(ownFunctions);
  const checks = (await query(`select jsonb_build_object(
    'privateTable',(select relrowsecurity and not has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') and not has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') and not has_table_privilege('service_role',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') from pg_class where oid='learn_quickbooks_disconnections'::regclass),
    'triggers',(select count(*)=2 and bool_and(t.tgenabled='O' and t.tgtype=23 and t.tgfoid=to_regprocedure('public.'||t.tgname||'()') and t.tgrelid=to_regclass(case when t.tgname='learn_quickbooks_disconnect_fence' then 'public.learn_quickbooks_connections' else 'public.learn_quickbooks_authorizations' end)) from pg_trigger t where tgname in ('learn_quickbooks_disconnect_fence','learn_quickbooks_disconnect_authorization_fence')),
    'requests',(select count(*) from learn_quickbooks_disconnections),'apps',(select count(*) from learn_quickbooks_apps),'connections',(select count(*) from learn_quickbooks_connections),'sources',(select count(*) from learn_quickbooks_source_versions)) result`))[0]?.result;
  if (!checks?.privateTable || !checks?.triggers) throw Error("TEST disconnect permission/trigger mismatch");
  const grants = await query(`select p.proname name,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') authenticated,has_function_privilege('service_role',p.oid,'execute') service from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in (${ownFunctions.map(f=>quote(f.name)).join(",")})`);
  for (const g of grants) {
    const user = ["learn_quickbooks_disconnect_request","learn_quickbooks_disconnect_status","learn_quickbooks_disconnect_review"].includes(g.name);
    const service = ["learn_quickbooks_disconnect_acquire","learn_quickbooks_disconnect_current","learn_quickbooks_disconnect_finish"].includes(g.name);
    if (g.anon || g.authenticated !== user || g.service !== service) throw Error("TEST disconnect RPC grant mismatch");
  }
  await query(readFileSync(new URL("./learn-quickbooks-disconnect-denials.sql", import.meta.url), "utf8"), true);
  return { state:"installed_metadata_verified", project, installedAt:own.installed_at, sourceSha256:sha(source), matchingFunctions:ownFunctions.length, ...checks, runtimeDenials:"passed" };
}
try {
  let current = await verify();
  if (phase === "prepare") {
    if (current.state !== "not_installed") throw Error("TEST disconnect already installed");
    const prerequisiteFunctions = foundation.sourceHashes.flatMap(f => functions(readFileSync(new URL("supabase/migrations/" + f.name, root), "utf8")));
    await verifyBodies(prerequisiteFunctions);
    const helpers = await query(`select s.signature,md5(p.prosrc) body_hash,pg_get_userbyid(p.proowner) owner from unnest(array[${signatures.map(quote).join(",")}]) s(signature) left join pg_proc p on p.oid=to_regprocedure(s.signature)`);
    if (helpers.some(h => !h.body_hash || !h.owner)) throw Error("TEST helper missing");
    const guards = helpers.map(h => `if not exists(select 1 from pg_proc where oid=to_regprocedure(${quote(h.signature)}) and md5(prosrc)=${quote(h.body_hash)} and pg_get_userbyid(proowner)=${quote(h.owner)}) then raise exception 'QuickBooks disconnect prerequisite changed';end if;`).join("\n") + "\n" +
      prerequisiteFunctions.map(f => `if not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname=${quote(f.name)} and md5(prosrc)=${quote(f.md5)} and pg_get_userbyid(proowner)='postgres') then raise exception 'QuickBooks foundation body changed';end if;`).join("\n");
    const sourceHashes = [{ name, sha256:sha(source) }];
    const bundle = `-- TEST ${project}; no credentials, revocations, source imports or capture changes.\nbegin;\nset local lock_timeout='5s';\nset local statement_timeout='40s';\ndo $guard$ begin\nif current_setting('serviceos.quickbooks_target',true) is distinct from '${project}' then raise exception 'QuickBooks TEST target required';end if;\n${guards}\nif not exists(select 1 from public.learn_quickbooks_release_receipts where release_id='quickbooks_foundation_v1' and source_hashes=${quote(JSON.stringify(foundation.sourceHashes))}::jsonb) then raise exception 'QuickBooks foundation mismatch';end if;\nend $guard$;\n${source.replace(/^begin;$/m, "").replace(/^commit;$/m, "")}\ninsert into public.learn_quickbooks_release_receipts(release_id,source_hashes) values('${release}',${quote(JSON.stringify(sourceHashes))}::jsonb);\nnotify pgrst,'reload schema';\ncommit;\n`;
    const manifest = { project,release,sourceHashes,bundleSha256:sha(bundle),helpers,prerequisiteFunctions,preparedAt:new Date().toISOString(),effects:["Add disconnect ledger, fences and operator/service RPCs.","No credential, user/grant, connection, revocation, source data, module flag or schedule seeded."] };
    writeFileSync(bundlePath,bundle);writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+"\n");
    console.log(JSON.stringify({state:"prepared",project,bundleSha256:sha(bundle),sourceHashes}));
  } else {
    const manifest = JSON.parse(readFileSync(manifestPath,"utf8")), bundle = readFileSync(bundlePath,"utf8");
    if (manifest.project!==project || manifest.release!==release || manifest.bundleSha256!==sha(bundle) || manifest.sourceHashes[0]?.sha256!==sha(source)) throw Error("TEST prepared source changed");
    if (phase === "rehearse") {
      if (current.state !== "not_installed") throw Error("TEST disconnect already installed");
      await query(`set serviceos.quickbooks_target='${project}';\n`+bundle.replace(/commit;\n$/, "rollback;\n"),true);
      if ((await verify()).state !== "not_installed") throw Error("TEST rollback not confirmed");
      current={state:"hosted_rollback_verified",project,bundleSha256:manifest.bundleSha256};
    } else if (phase === "install" && current.state === "not_installed") {
      await query(`set serviceos.quickbooks_target='${project}';\n`+bundle,true);current=await verify();
    }
    mkdirSync(".verification-results",{recursive:true,mode:0o700});
    writeFileSync(`.verification-results/quickbooks-test-disconnect-${Date.now()}.json`,JSON.stringify(current,null,2)+"\n",{mode:0o600,flag:"wx"});
    console.log(JSON.stringify(current));
  }
} catch(e) { console.error(e instanceof Error && e.message.startsWith("TEST") ? e.message : "TEST disconnect release unconfirmed; inspect receipt before retrying.");process.exitCode=1; }
