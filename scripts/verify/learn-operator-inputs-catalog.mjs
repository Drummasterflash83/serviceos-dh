/** Read-only operator-input metadata. No grants, credentials or provider reads. */
import {
  readCommusoftCatalog,
  COMMUSOFT_GRANTS_QUERY,
  COMMUSOFT_HELPERS,
  COMMUSOFT_BASE_TABLES,
} from "./learn-commusoft-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { RULES_FUNCTION_QUERY } from "./learn-rules-catalog.mjs";
export const OPERATOR_INPUT_FUNCTIONS = [
  "current_user_is_openfolk_operator",
  "learn_operator_input_immutable",
  "learn_operator_input_access",
  "learn_operator_input_flags",
  "learn_operator_input_request",
  "learn_operator_inputs",
];
export const OPERATOR_INPUT_TABLES = ["platform_authority_grants", "learn_operator_input_requests"];
export const OPERATOR_INPUT_BASE_TABLES = [
  ...COMMUSOFT_BASE_TABLES,
  "authority_permissions",
  "feature_flags",
];
const quoted = (xs) => xs.map((n) => `'${n}'`).join(",");
export const OPERATOR_INPUT_FUNCTION_QUERY = RULES_FUNCTION_QUERY.replace(
  /p\.proname in \([^)]*\)/,
  `p.proname in (${quoted([...OPERATOR_INPUT_FUNCTIONS, ...COMMUSOFT_HELPERS])})`,
);
export const OPERATOR_INPUT_GRANTS_QUERY = COMMUSOFT_GRANTS_QUERY.replace(
  /c\.relname in \([^)]*\)/g,
  `c.relname in (${quoted([...OPERATOR_INPUT_TABLES, ...OPERATOR_INPUT_BASE_TABLES])})`,
);
export const OPERATOR_INPUT_AUTHORITY_QUERY = `select jsonb_build_object(
 'permissions',(select coalesce(jsonb_agg(to_jsonb(p) order by permission),'[]') from public.authority_permissions p where permission in ('platform.controlplane.view','platform.controlplane.admin')),
 'vault_metadata_columns',(select coalesce(jsonb_agg(jsonb_build_object('column',column_name,'type',data_type) order by column_name),'[]') from information_schema.columns where table_schema='vault' and table_name='secrets' and column_name in ('id','name')),
 'deployment_owner',current_user) as authority`;
export async function readOperatorInputsCatalog(args) {
  const base = await readCommusoftCatalog(args);
  const [functions, grants, authority] = await Promise.all(
    [
      OPERATOR_INPUT_FUNCTION_QUERY,
      OPERATOR_INPUT_GRANTS_QUERY,
      OPERATOR_INPUT_AUTHORITY_QUERY,
    ].map((q) => communicationQuery(args.token, q, args)),
  );
  if (
    functions?.length !== 1 ||
    !Array.isArray(functions[0]?.functions) ||
    grants?.length !== 1 ||
    !Array.isArray(grants[0]?.grants) ||
    authority?.length !== 1 ||
    !authority[0]?.authority
  )
    throw Error("Operator input metadata incomplete");
  return {
    ...base,
    operatorInputFunctions: functions[0].functions,
    operatorInputGrants: grants[0].grants,
    operatorInputAuthority: authority[0].authority,
  };
}
