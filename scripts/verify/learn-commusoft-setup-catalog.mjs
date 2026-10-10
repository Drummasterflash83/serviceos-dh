/** TEST schema/privilege capabilities only. Never reads Vault rows or keys. */
import {
  readOperatorInputsCatalog,
  OPERATOR_INPUT_FUNCTIONS,
  OPERATOR_INPUT_BASE_TABLES,
  OPERATOR_INPUT_TABLES,
} from "./learn-operator-inputs-catalog.mjs";
import { COMMUSOFT_HELPERS, COMMUSOFT_GRANTS_QUERY } from "./learn-commusoft-catalog.mjs";
import { RULES_FUNCTION_QUERY } from "./learn-rules-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
export const CONNECTION_TABLES = [
  "learn_commusoft_connection_requests",
  "learn_commusoft_verification_requests",
  "learn_commusoft_verification_permits",
  "learn_commusoft_verification_results",
];
export const CONNECTION_FUNCTIONS = [
  "provider_secret_name",
  "provider_secret_store",
  "learn_commusoft_configure",
  "learn_commusoft_verification_binding",
  "learn_commusoft_verification_authority",
  "learn_commusoft_verification_receipt",
  "learn_commusoft_verify_request",
  "learn_commusoft_verify_acquire",
  "learn_commusoft_verify_authorized",
  "learn_commusoft_verify_finish",
];
export const CONNECTION_BASE_TABLES = [
  ...new Set([
    ...OPERATOR_INPUT_BASE_TABLES,
    ...OPERATOR_INPUT_TABLES,
    "provider_connection_events",
    "learn_business_input_request_gates",
  ]),
];
const quoted = (xs) => xs.map((x) => `'${x}'`).join(",");
export const CONNECTION_FUNCTION_QUERY = RULES_FUNCTION_QUERY.replace(
  /p\.proname in \([^)]*\)/,
  `p.proname in (${quoted([...CONNECTION_FUNCTIONS, ...OPERATOR_INPUT_FUNCTIONS, ...COMMUSOFT_HELPERS, "provider_secret_read", "provider_secret_revoke"])})`,
);
export const CONNECTION_GRANTS_QUERY = COMMUSOFT_GRANTS_QUERY.replace(
  /c\.relname in \([^)]*\)/g,
  `c.relname in (${quoted([...CONNECTION_TABLES, ...CONNECTION_BASE_TABLES])})`,
);
export const CONNECTION_VAULT_QUERY = `select jsonb_build_object(
 'extension',(select extversion from pg_extension where extname='supabase_vault'),
 'functions',(select jsonb_agg(jsonb_build_object('name',p.proname,'arguments',pg_get_function_identity_arguments(p.oid),'owner',pg_get_userbyid(p.proowner),'securityDefiner',p.prosecdef,'postgresExecute',has_function_privilege('postgres',p.oid,'execute')) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='vault' and p.proname in ('create_secret','update_secret')),
 'relations',(select jsonb_agg(jsonb_build_object('name',c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),'postgresSelect',has_table_privilege('postgres',c.oid,'select'),'postgresInsert',has_table_privilege('postgres',c.oid,'insert'),'postgresUpdate',has_table_privilege('postgres',c.oid,'update')) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='vault' and c.relname in ('secrets','decrypted_secrets')),
 'apiUsage',(select jsonb_agg(jsonb_build_object('role',r,'usage',has_schema_privilege(r,'vault','usage')) order by r) from unnest(array['anon','authenticated','service_role']) r)
) as vault`;
export async function readConnectionSetupCatalog(args) {
  const base = await readOperatorInputsCatalog(args);
  const [f, g, v] = await Promise.all(
    [CONNECTION_FUNCTION_QUERY, CONNECTION_GRANTS_QUERY, CONNECTION_VAULT_QUERY].map((query) =>
      communicationQuery(args.token, query, args),
    ),
  );
  if (
    f?.length !== 1 ||
    !Array.isArray(f[0]?.functions) ||
    g?.length !== 1 ||
    !Array.isArray(g[0]?.grants) ||
    v?.length !== 1 ||
    !v[0]?.vault
  )
    throw Error("Connection setup metadata incomplete");
  return {
    ...base,
    connectionFunctions: f[0].functions,
    connectionGrants: g[0].grants,
    connectionVault: v[0].vault,
  };
}
