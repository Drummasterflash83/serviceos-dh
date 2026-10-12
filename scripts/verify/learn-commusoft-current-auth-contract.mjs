/** TEST 071 adds exactly the reviewed Gmail source-version retention trigger.
 * All original Auth, authority, table and provenance checks remain mandatory. */
import { phoneProcessingAuthContractMatches } from "./learn-phone-processing-auth-contract.mjs";
export const RETENTION_TRIGGER = {
  name: "learn_email_preserve_source_version",
  function:
    "CREATE OR REPLACE FUNCTION public.learn_email_preserve_source_version()\n RETURNS trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog'\nAS $function$\nbegin\n if old.provider='gmail' and (to_jsonb(old)-'updated_at') is distinct from (to_jsonb(new)-'updated_at') then\n  insert into public.learn_email_source_versions(tenant_id,email_message_id,source_row)\n   values(old.tenant_id,old.id,to_jsonb(old));\n end if;\n return new;\nend $function$\n",
  definition:
    "CREATE TRIGGER learn_email_preserve_source_version BEFORE UPDATE ON public.email_messages FOR EACH ROW EXECUTE FUNCTION learn_email_preserve_source_version()",
};
export function currentCommusoftAuthContractMatches(contract) {
  try {
    const copy = structuredClone(contract);
    const tables = copy?.tables?.filter((t) => t.name === "email_messages");
    if (tables?.length !== 1 || !Array.isArray(tables[0].triggers)) return false;
    const matches = tables[0].triggers.filter((t) => t.name === RETENTION_TRIGGER.name);
    if (
      matches.length !== 1 ||
      Object.keys(matches[0]).sort().join(",") !== "definition,function,name" ||
      Object.keys(RETENTION_TRIGGER).some((k) => matches[0][k] !== RETENTION_TRIGGER[k])
    )
      return false;
    tables[0].triggers = tables[0].triggers.filter((t) => t.name !== RETENTION_TRIGGER.name);
    return phoneProcessingAuthContractMatches(copy);
  } catch {
    return false;
  }
}
