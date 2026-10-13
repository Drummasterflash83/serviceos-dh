/** TEST-only additive finance release; no credentials, provider calls or data seeds. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken } from "./learn-test-readiness.mjs";
const project = "saatxzwxvdvqevbnskxy", phase = process.argv[2];
if (!["prepare", "rehearse", "install", "verify"].includes(phase) || process.argv.length !== 3) throw Error("Specify release phase");
const root = new URL("../../", import.meta.url);
const name = "20261102020000_learn_quickbooks_customer_finance.sql";
const source = readFileSync(new URL("supabase/migrations/" + name, root), "utf8");
const hash = s => createHash("sha256").update(s).digest("hex");
const quote = s => "'" + s.replaceAll("'", "''") + "'";
const release = "quickbooks_customer_finance_v1";
const bundlePath = new URL("supabase/release/quickbooks-test/002_customer_finance.sql", root);
const manifestPath = new URL("supabase/release/quickbooks-test/002_customer_finance.manifest.json", root);
const foundation = JSON.parse(readFileSync(new URL("supabase/release/quickbooks-test/001_foundation.manifest.json", root), "utf8"));
const token = savedCliToken();
async function query(sql, write = false) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${write ? "" : "/read-only"}`, {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, ...(write ? { read_only: false } : {}) }), redirect: "error", signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw Error("TEST request unconfirmed: HTTP " + response.status);
  const chunks = []; let length = 0;
  for await (const chunk of response.body) { length += chunk.byteLength; if (length > 1048576) throw Error("TEST response exceeds bound"); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
const signatures = ["auth.uid()", "auth.role()", "public.learn_operator_input_access(uuid,uuid,boolean)",
  "public.learn_import_batch_authority(uuid,uuid)", "public.learn_quickbooks_enabled(uuid)", "public.learn_operator_input_immutable()"];
async function verify() {
  const receipts = await query(`select release_id,source_hashes,installed_at from public.learn_quickbooks_release_receipts where release_id in ('quickbooks_foundation_v1','${release}')`);
  if (JSON.stringify(receipts.find(r => r.release_id === "quickbooks_foundation_v1")?.source_hashes) !== JSON.stringify(foundation.sourceHashes)) throw Error("TEST foundation receipt mismatch");
  const own = receipts.find(r => r.release_id === release);
  if (!own) {
    const r = await query("select to_regclass('public.learn_quickbooks_customer_links') is null and to_regclass('public.learn_quickbooks_finance_events') is null as absent");
    if (r[0]?.absent !== true) throw Error("TEST finance objects exist without receipt");
    return { state: "not_installed", project };
  }
  if (own.source_hashes.length !== 1 || own.source_hashes[0].name !== name || own.source_hashes[0].sha256 !== hash(source)) throw Error("TEST finance receipt mismatch");
  const checks = (await query(`select jsonb_build_object(
   'privateTables',(select count(*)=2 and bool_and(c.relrowsecurity and not has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') and not has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') and not has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) from pg_class c where c.oid in ('public.learn_quickbooks_customer_links'::regclass,'public.learn_quickbooks_finance_events'::regclass)),
   'financeRpc',has_function_privilege('authenticated','learn_quickbooks_customer_finance(uuid,uuid,text,uuid,text)','execute') and not has_function_privilege('anon','learn_quickbooks_customer_finance(uuid,uuid,text,uuid,text)','execute') and not has_function_privilege('service_role','learn_quickbooks_customer_finance(uuid,uuid,text,uuid,text)','execute'),
   'links',(select count(*) from learn_quickbooks_customer_links),'events',(select count(*) from learn_quickbooks_finance_events),
   'apps',(select count(*) from learn_quickbooks_apps),'connections',(select count(*) from learn_quickbooks_connections),'sources',(select count(*) from learn_quickbooks_source_versions)) as result`))[0]?.result;
  if (!checks?.privateTables || !checks?.financeRpc) throw Error("TEST finance permission verification failed");
  const functions = [...source.matchAll(/create function public\.(learn_quickbooks_[a-z_]+)\([\s\S]*?\$\$([\s\S]*?)\$\$;/g)]
    .map(m => ({ name: m[1], md5: createHash("md5").update(m[2]).digest("hex") }));
  if (functions.length !== 6) throw Error("TEST finance function manifest incomplete");
  const deployed = await query(`select p.proname name,md5(p.prosrc) md5,pg_get_userbyid(p.proowner) owner from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (${functions.map(f => quote(f.name)).join(",")})`);
  if (deployed.length !== functions.length || functions.some(f => !deployed.some(d => d.name === f.name && d.md5 === f.md5 && d.owner === "postgres"))) throw Error("TEST deployed finance function differs");
  await query(readFileSync(new URL("./learn-quickbooks-finance-denials.sql", import.meta.url), "utf8"), true);
  return { state: "installed_metadata_verified", project, installedAt: own.installed_at, sourceSha256: hash(source), ...checks, matchingFunctions: functions.length, runtimeDenials: "passed" };
}
try {
  const current = await verify();
  if (phase === "prepare") {
    if (current.state !== "not_installed") throw Error("TEST finance already installed");
    const helpers = await query(`select s.signature,md5(p.prosrc) body_hash,pg_get_userbyid(p.proowner) owner from unnest(array[${signatures.map(quote).join(",")}]) s(signature) left join pg_proc p on p.oid=to_regprocedure(s.signature)`);
    if (helpers.length !== signatures.length || helpers.some(h => !h.body_hash || !h.owner)) throw Error("TEST helper missing");
    for (const helper of helpers) {
      const known = foundation.prerequisiteHashes.find(f => f.signature.replace(/^public\./, "") === helper.signature.replace(/^public\./, ""));
      if (known && known.bodyHash !== helper.body_hash) throw Error("TEST authority changed since foundation verification");
    }
    const columns = await query("select c.relname,a.attname,format_type(a.atttypid,a.atttypmod) type from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid where n.nspname='public' and ((c.relname='customer_cards' and a.attname in ('id','tenant_id')) or (c.relname='profiles' and a.attname in ('tenant_id','role'))) and not a.attisdropped");
    if (columns.length !== 4 || columns.some(c => c.type !== (c.attname === "role" ? "text" : "uuid"))) throw Error("TEST canonical customer/profile columns differ");
    const guards = helpers.map(h => `if not exists(select 1 from pg_proc where oid=to_regprocedure(${quote(h.signature)}) and md5(prosrc)=${quote(h.body_hash)} and pg_get_userbyid(proowner)=${quote(h.owner)}) then raise exception 'QuickBooks finance prerequisite changed';end if;`).join("\n") + "\n" +
      columns.map(c => `if not exists(select 1 from pg_attribute where attrelid=to_regclass(${quote("public." + c.relname)}) and attname=${quote(c.attname)} and not attisdropped and format_type(atttypid,atttypmod)=${quote(c.type)}) then raise exception 'QuickBooks finance column changed';end if;`).join("\n");
    const hashes = [{ name, sha256: hash(source) }];
    const bundle = `-- TEST ${project}; no financial records or identity links seeded.\nbegin;\nset local lock_timeout='5s';\nset local statement_timeout='40s';\ndo $guard$ begin\nif current_setting('serviceos.quickbooks_target',true) is distinct from '${project}' then raise exception 'QuickBooks TEST target required';end if;\n${guards}\nif not exists(select 1 from public.learn_quickbooks_release_receipts where release_id='quickbooks_foundation_v1' and source_hashes=${quote(JSON.stringify(foundation.sourceHashes))}::jsonb) then raise exception 'QuickBooks foundation mismatch';end if;\nend $guard$;\n${source.replace(/^begin;$/m, "").replace(/^commit;$/m, "")}\ninsert into public.learn_quickbooks_release_receipts(release_id,source_hashes) values('${release}',${quote(JSON.stringify(hashes))}::jsonb);\nnotify pgrst,'reload schema';\ncommit;\n`;
    const manifest = { project, release, sourceHashes: hashes, bundleSha256: hash(bundle), helpers, columns, preparedAt: new Date().toISOString(), effects: ["Create reviewed customer links and audited finance RPCs behind existing company-admin/operator authority.", "No credential, source import, user, grant, flag, link or schedule seeded."] };
    writeFileSync(bundlePath, bundle); writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    console.log(JSON.stringify({ state: "prepared", ...manifest }));
  } else {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")), bundle = readFileSync(bundlePath, "utf8");
    if (manifest.project !== project || manifest.release !== release || manifest.bundleSha256 !== hash(bundle) || manifest.sourceHashes[0]?.sha256 !== hash(source)) throw Error("TEST prepared source changed");
    let result = current;
    if (phase === "rehearse") {
      if (current.state !== "not_installed") throw Error("TEST finance already installed");
      await query(`set serviceos.quickbooks_target='${project}';\n` + bundle.replace(/commit;\n$/, "rollback;\n"), true);
      if ((await verify()).state !== "not_installed") throw Error("TEST rollback not confirmed");
      result = { state: "hosted_rollback_verified", project, bundleSha256: manifest.bundleSha256 };
    } else if (phase === "install" && current.state === "not_installed") {
      await query(`set serviceos.quickbooks_target='${project}';\n` + bundle, true);
      result = await verify();
    }
    mkdirSync(".verification-results", { recursive: true, mode: 0o700 });
    writeFileSync(`.verification-results/quickbooks-test-finance-${Date.now()}.json`, JSON.stringify(result, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    console.log(JSON.stringify(result));
  }
} catch (e) {
  console.error(e instanceof Error && e.message.startsWith("TEST ") ? e.message : "TEST finance release unconfirmed; inspect its receipt before retrying."); process.exitCode = 1;
}
