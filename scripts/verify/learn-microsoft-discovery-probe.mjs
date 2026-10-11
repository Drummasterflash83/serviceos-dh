/** Synthetic recurring folder traversal; append to card rehearsal and ROLLBACK. */
import { execFileSync } from "node:child_process";
import { stepMicrosoftFolderDiscovery } from "../../supabase/functions/_shared/microsoft_mail_folders.ts";
const f = JSON.parse(
  execFileSync(process.execPath, ["scripts/verify/learn-microsoft-journal-fixtures.mjs"], {
    encoding: "utf8",
  }).replaceAll("00000000-0000-4000-8000-", "eb190660-aaaa-4000-8000-"),
);
const q = (v) => "'" + String(v).replaceAll("'", "''") + "'",
  json = (v) => q(JSON.stringify(v)) + "::jsonb";
const id = (n) => q(`eb190660-aaaa-4000-8000-${String(n).padStart(12, "0")}`) + "::uuid";
const t = id(1),
  a = id(2),
  m = id(3),
  b = id(4);
const pages = [f.folders[1]];
let cp = f.folders[0].before;
for (const value of [
  [
    f.folders[0].page.folders[0].raw,
    { ...f.folders[0].page.folders[0].raw, id: "NewFolder", displayName: "Synthetic new folder" },
  ],
  [],
  [],
]) {
  const step = await stepMicrosoftFolderDiscovery("synthetic", f.scope, cp, async () =>
    Response.json({ value }),
  );
  pages.push({ before: cp, page: step.page, after: step.checkpoint });
  cp = step.checkpoint;
}
console.log(`
delete from feature_flags where tenant_id=${t} and flag='learn.inputs.email.enabled';
select set_config('learn.microsoft_first_dispatch',(select to_jsonb(d)::text from learn_microsoft_folder_dispatches d where tenant_id=${t} and folder_id='Folder1'),true);
`);
for (const [i, p] of pages.entries()) {
  const revision = [1, 3, 4, 5][i];
  console.log(`
select set_config('learn.microsoft_discovery_job',(select id::text from platform_jobs where tenant_id=${t} and job_type='email.microsoft_discovery' and status='queued'),true);
${i === 1 ? `do $$begin assert exists(select 1 from platform_jobs where id=current_setting('learn.microsoft_discovery_job')::uuid and available_at>clock_timestamp()+interval '899 seconds');end$$;` : ""}
update platform_jobs set status='running',claimed_by='microsoft-rollback',attempt_count=1,lease_expires_at=clock_timestamp()+interval '10 minutes' where id=current_setting('learn.microsoft_discovery_job')::uuid;
set local role service_role;
do $$declare s jsonb;r jsonb;done jsonb;j uuid:=current_setting('learn.microsoft_discovery_job')::uuid;begin
 s:=learn_microsoft_journal_open(${t},${a},${m},${b},'folders','',${json(f.folders[0].before)},j,'microsoft-rollback',1);
 assert (s->>'revision')::bigint=${revision} and s->'checkpoint'=${json(p.before)};
 r:=learn_microsoft_journal_commit(${t},(s->>'streamId')::uuid,${id(70 + i)},${revision},${json(p.before)},${json(p.page)},${json(p.after)},j,'microsoft-rollback',1);
 done:=learn_microsoft_job_settle(${t},j,'microsoft-rollback',1,true);
 assert done->>'continuationKind'=${q(i === 0 || i === 3 ? "discovery" : "page")};
 ${i === 1 ? `assert done->'folderDispatch'->>'newJobs'='1' and done->'folderDispatch'->>'previouslyDispatched'='1';` : ""}
 assert learn_microsoft_job_settle(${t},j,'microsoft-rollback',1,true)=done;
end$$;reset role;
`);
}
console.log(`do $$begin
 assert (select count(*) from learn_microsoft_discovery_rounds where tenant_id=${t})=2;
 assert (select revision from learn_microsoft_capture_streams where tenant_id=${t} and kind='folders')=7;
 assert (select to_jsonb(d)::text from learn_microsoft_folder_dispatches d where tenant_id=${t} and folder_id='Folder1')=current_setting('learn.microsoft_first_dispatch');
 assert (select count(*) from platform_jobs where tenant_id=${t} and job_type='email.microsoft_sync' and payload->>'folder_id'='NewFolder')=1;
 assert (select count(*) from platform_jobs where tenant_id=${t} and job_type='email.microsoft_discovery' and status='queued')=1;
 assert exists(select 1 from learn_microsoft_source_pages where id=${id(20)} and after_checkpoint=${json(f.folders[0].after)});
 assert (select count(*) from customer_cards where tenant_id=${t} and summary='Updated synthetic preview')=1;
end$$;
set local role service_role;
do $$begin begin perform 1 from learn_microsoft_discovery_rounds;raise exception 'raw rounds accessible';exception when insufficient_privilege then null;end;end$$;reset role;`);
