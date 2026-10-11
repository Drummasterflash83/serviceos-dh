/** Append to the Microsoft projection fixture inside one rolled-back transaction. */
import { readMicrosoftMailPage } from "../../supabase/functions/_shared/microsoft_mail_page.ts";
const q = (v) => "'" + String(v).replaceAll("'", "''") + "'",
  json = (v) => q(JSON.stringify(v)) + "::jsonb";
const id = (n) => `eb190660-aaaa-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { tenantId: id(1), accountId: id(2), mailboxId: id(3), folderId: "ProjectionFolder" };
const before = {
  contract: "microsoft-message-checkpoint/1",
  scope,
  pageSize: 25,
  continuation: {
    kind: "delta",
    url: `https://graph.microsoft.com/v1.0/users/${scope.mailboxId}/mailFolders/${scope.folderId}/messages/delta?$deltatoken=SYNTHETIC`,
  },
  visitedRequests: [],
};
const raw = {
  id: "ProjectionM1",
  changeKey: "ProjectionV2",
  conversationId: "ProjectionC1",
  subject: "Synthetic Microsoft job enquiry updated",
  body: { contentType: "text", content: "Updated synthetic message retained separately" },
  bodyPreview: "Updated synthetic preview",
  from: { emailAddress: { address: "customer@example.invalid", name: "Synthetic customer" } },
  toRecipients: [{ emailAddress: { address: "synthetic@example.invalid" } }],
  ccRecipients: [],
  sentDateTime: "2026-10-11T10:00:00Z",
  receivedDateTime: "2026-10-11T10:00:01Z",
  lastModifiedDateTime: "2026-10-11T10:02:00.1234561Z",
  isDraft: false,
  hasAttachments: true,
};
const page = await readMicrosoftMailPage(
  "synthetic",
  { ...scope, pageSize: 25, continuation: before.continuation },
  async () =>
    Response.json({
      value: [raw],
      "@odata.deltaLink": `https://graph.microsoft.com/v1.0/users/${scope.mailboxId}/mailFolders/${scope.folderId}/messages/delta?$deltatoken=SYNTHETIC2`,
    }),
  () => Date.parse("2026-10-11T11:02:00Z"),
);
function delivery(n) {
  return `
insert into platform_jobs(id,tenant_id,connector_id,module_id,job_type,job_key,status,payload,claimed_by,attempt_count,lease_expires_at)
 values(${q(id(n))},${q(id(1))},'openfolk-core','core.identity','identity.resolve',${q("identity.resolve:" + id(1))},'running','{"limit":20}','microsoft-card-rollback',1,clock_timestamp()+interval '10 minutes');
set local role service_role;
do $$declare selected record;r jsonb;settled jsonb;begin
 select * into strict selected from learn_identity_pending(${q(id(1))},20);
 r:=learn_processing_publish(${q(id(1))},${q(id(n))},'microsoft-card-rollback',1,${q(id(n + 1))},'identity',selected.interaction_id,selected.source_revision,'publish');
 assert r->>'state'='committed' and r->>'cardEnriched'='true' and r->>'eventsConsumed'='1','Microsoft card publication differs';
 assert learn_processing_publish(${q(id(1))},${q(id(n))},'microsoft-card-rollback',1,${q(id(n + 1))},'identity',selected.interaction_id,selected.source_revision,'inspect')=r,'Microsoft card replay differs';
 settled:=learn_processing_settle(${q(id(1))},${q(id(n))},'microsoft-card-rollback',1,${q(id(n + 2))},'{"success":true,"records_processed":1,"result":{"resolved":1,"cards_enriched":1,"events_consumed":1,"review_required":0,"failed":0},"continue":false,"retryable":false,"error_code":null}','settle');
 assert settled->>'state'='succeeded' and settled->>'publications_committed'='1','Microsoft identity job settlement differs';
end$$;reset role;
`;
}
console.log(delivery(40));
console.log(`
select set_config('learn.microsoft_original_card',(select id::text from customer_cards where tenant_id=${q(id(1))}),true);
select set_config('learn.microsoft_original_person',(select related_person_id::text from interactions where tenant_id=${q(id(1))}),true);
do $$begin
 assert (select count(*) from customer_cards where tenant_id=${q(id(1))} and summary='Synthetic preview')=1,'Initial Microsoft card missing';
 assert not exists(select 1 from platform_events where tenant_id=${q(id(1))} and status='pending'),'Initial Microsoft event not consumed';
end$$;
select set_config('learn.microsoft_update_job',(select id::text from platform_jobs where tenant_id=${q(id(1))} and job_type='email.microsoft_sync' and payload->>'folder_id'='ProjectionFolder' and status='queued'),true);
update platform_jobs set status='running',claimed_by='microsoft-rollback',attempt_count=1,lease_expires_at=clock_timestamp()+interval '10 minutes' where id=current_setting('learn.microsoft_update_job')::uuid;
set local role service_role;
do $$declare s jsonb;r jsonb;done jsonb;j uuid:=current_setting('learn.microsoft_update_job')::uuid;begin
 s:=learn_microsoft_journal_open(${q(id(1))},${q(id(2))},${q(id(3))},${q(id(4))},'messages','ProjectionFolder',${json({ ...before, continuation: null })},j,'microsoft-rollback',1);
 assert s->'checkpoint'=${json(before)},'Stored Microsoft delta checkpoint differs';
 r:=learn_microsoft_journal_commit(${q(id(1))},(s->>'streamId')::uuid,${q(id(51))},1,${json(before)},${json(page)},${json({ ...before, continuation: page.continuation })},j,'microsoft-rollback',1);
 done:=learn_microsoft_job_settle(${q(id(1))},j,'microsoft-rollback',1,true);
 assert done->>'state'='completed' and done->>'continuationKind'='incremental';
end$$;reset role;
`);
console.log(delivery(60));
console.log(`
do $$begin
 assert (select count(*) from customer_cards where tenant_id=${q(id(1))})=1;
 assert exists(select 1 from customer_cards where tenant_id=${q(id(1))} and id=current_setting('learn.microsoft_original_card')::uuid and summary='Updated synthetic preview'),'Updated Microsoft source did not refresh original card';
 assert exists(select 1 from interactions where tenant_id=${q(id(1))} and related_person_id=current_setting('learn.microsoft_original_person')::uuid and processing_status='enriched'),'Microsoft identity changed on update';
 assert (select count(*) from platform_events where tenant_id=${q(id(1))} and status='consumed')=2;
 assert not exists(select 1 from platform_events where tenant_id=${q(id(1))} and status='pending');
 assert (select count(*) from learn_identity_delivery_receipts where tenant_id=${q(id(1))})=2;
 assert (select count(*) from learn_processing_publications where tenant_id=${q(id(1))})=2;
 assert (select count(*) from learn_processing_settlements where tenant_id=${q(id(1))})=2;
 assert exists(select 1 from learn_microsoft_source_pages where id=${q(id(31))} and source_page::text like '%ProjectionV1%'),'Original source page lost';
 assert exists(select 1 from learn_microsoft_source_pages where id=${q(id(51))} and source_page::text like '%ProjectionV2%'),'Updated source page missing';
end$$;
`);
