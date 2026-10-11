/** Append to the existing Microsoft hosted rollback fixture; no retained writes. */
import { readMicrosoftMailPage } from "../../supabase/functions/_shared/microsoft_mail_page.ts";
const q = (v) => "'" + String(v).replaceAll("'", "''") + "'",
  json = (v) => q(JSON.stringify(v)) + "::jsonb";
const id = (n) => `eb190660-aaaa-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { tenantId: id(1), accountId: id(2), mailboxId: id(3), folderId: "ProjectionFolder" };
const before = {
  contract: "microsoft-message-checkpoint/1",
  scope,
  pageSize: 25,
  continuation: null,
  visitedRequests: [],
};
const raw = {
  id: "ProjectionM1",
  changeKey: "ProjectionV1",
  conversationId: "ProjectionC1",
  subject: "Synthetic Microsoft job enquiry",
  body: { contentType: "text", content: "Synthetic message for rollback only" },
  bodyPreview: "Synthetic preview",
  from: { emailAddress: { address: "customer@example.invalid", name: "Synthetic customer" } },
  toRecipients: [{ emailAddress: { address: "synthetic@example.invalid" } }],
  ccRecipients: [],
  sentDateTime: "2026-10-11T10:00:00Z",
  receivedDateTime: "2026-10-11T10:00:01Z",
  lastModifiedDateTime: "2026-10-11T10:01:00.1234561Z",
  isDraft: false,
  hasAttachments: true,
};
const page = await readMicrosoftMailPage(
  "synthetic",
  { ...scope, pageSize: 25, continuation: null },
  async () =>
    Response.json({
      value: [
        raw,
        { id: "ProjectionM2", subject: "Sparse stays held" },
        { id: "ProjectionM1", "@removed": { reason: "deleted" } },
      ],
      "@odata.deltaLink": `https://graph.microsoft.com/v1.0/users/${scope.mailboxId}/mailFolders/${scope.folderId}/messages/delta?$deltatoken=SYNTHETIC`,
    }),
  () => Date.parse("2026-10-11T11:00:00Z"),
);
const after = { ...before, continuation: page.continuation };
const payload = {
  email_account_id: id(2),
  mailbox_id: id(3),
  binding_id: id(4),
  kind: "messages",
  folder_id: scope.folderId,
};
console.log(`
delete from feature_flags where tenant_id=${q(id(1))} and flag='learn.inputs.email.enabled';
insert into platform_jobs(id,tenant_id,connector_id,module_id,job_type,job_key,status,payload,claimed_by,attempt_count,lease_expires_at)
 values(${q(id(30))},${q(id(1))},'microsoft-365','communications.email','email.microsoft_sync',${q("email.microsoft_sync:" + id(4) + ":" + scope.folderId)},'running',${json(payload)},'microsoft-rollback',1,clock_timestamp()+interval '10 minutes');
set local role service_role;
do $$declare s jsonb;r jsonb;done jsonb;projected jsonb;begin
 s:=learn_microsoft_journal_open(${q(id(1))},${q(id(2))},${q(id(3))},${q(id(4))},'messages',${q(scope.folderId)},${json(before)},${q(id(30))},'microsoft-rollback',1);
 r:=learn_microsoft_journal_commit(${q(id(1))},(s->>'streamId')::uuid,${q(id(31))},0,${json(before)},${json(page)},${json(after)},${q(id(30))},'microsoft-rollback',1);
 done:=learn_microsoft_job_settle(${q(id(1))},${q(id(30))},'microsoft-rollback',1,true);
 assert done->>'state'='completed' and done->>'observationsStored'='3';
 projected:=learn_microsoft_page_project(${q(id(1))},${q(id(31))});
 assert projected->>'published'='1' and projected->>'held'='1' and projected->>'removedFromFolder'='1';
 assert learn_microsoft_page_project(${q(id(1))},${q(id(31))})=projected;
 assert learn_microsoft_job_settle(${q(id(1))},${q(id(30))},'microsoft-rollback',1,true)=done;
 begin perform learn_microsoft_page_project(${q(id(99))},${q(id(31))});raise exception 'foreign projection accepted';exception when sqlstate 'PT409' then null;end;
 begin perform 1 from learn_microsoft_projection_receipts;raise exception 'raw receipt access accepted';exception when insufficient_privilege then null;end;
end$$;
reset role;
do $$declare mid uuid;iid uuid;begin
 select id into strict mid from email_messages where tenant_id=${q(id(1))} and provider='microsoft_365' and subject='Synthetic Microsoft job enquiry' and direction='inbound' and body_text='Synthetic message for rollback only' and raw_payload->'microsoft_source'->>'last_modified'='2026-10-11T10:01:00.1234561Z';
 select id into strict iid from interactions where tenant_id=${q(id(1))} and source_table='email_messages' and source_id=mid and source_connector_id='microsoft-365' and processing_status='pending' and to_addresses=array['synthetic@example.invalid'];
 assert (select count(*) from platform_events where tenant_id=${q(id(1))} and subject_id=iid and event_type='interaction.ready' and status='pending')=1;
 assert (select count(*) from email_threads where tenant_id=${q(id(1))} and provider='microsoft_365')=1;
 assert (select count(*) from email_messages where tenant_id=${q(id(1))})=1;
 assert (select source_page from learn_microsoft_source_pages where id=${q(id(31))})=${json(page)};
end$$;
set local role authenticated;
do $$begin
 begin perform learn_microsoft_page_project(${q(id(1))},${q(id(31))});raise exception 'human projection accepted';exception when insufficient_privilege then null;end;
end$$;reset role;
`);
