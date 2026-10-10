/** TEST retained-job reader plus the complete preceding release and preservation baseline. */
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  ASSESSMENT_RECOVERY_CATALOG,
  ASSESSMENT_RECOVERY_PRESERVED,
} from "./learn-assessment-recovery-catalog.mjs";
export const JOB_DETAILS_PRESERVED = [
  ...ASSESSMENT_RECOVERY_PRESERVED,
  "public.learn_assessment_cancellations",
];
export const JOB_DETAILS_SNAPSHOT = JOB_DETAILS_PRESERVED.map(
  (n) =>
    `select '${n}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from ${n} s`,
).join(" union all ");
const functions = `(select coalesce(jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text) order by p.oid::regprocedure::text),'[]'::jsonb) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('learn_business_input_time_detail','learn_commusoft_job_details'))`;
export const JOB_DETAILS_CATALOG = `jsonb_build_object('base',${ASSESSMENT_RECOVERY_CATALOG},'functions',${functions})`;
export async function readJobDetailsCatalog(token, options) {
  const rows = await communicationQuery(
    token,
    `set local search_path=public,pg_catalog;select ${JOB_DETAILS_CATALOG} as catalog,md5((${JOB_DETAILS_CATALOG})::text) as fingerprint`,
    options,
  );
  if (
    rows.length !== 1 ||
    !/^[a-f0-9]{32}$/.test(rows[0].fingerprint) ||
    ![0, 2].includes(rows[0].catalog?.functions?.length) ||
    rows[0].catalog?.base?.functions?.length !== 3 ||
    !Array.isArray(rows[0].catalog?.base?.ledger)
  )
    throw Error("Job details catalog incomplete");
  return rows[0];
}
