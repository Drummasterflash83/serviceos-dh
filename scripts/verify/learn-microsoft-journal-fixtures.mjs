// Synthetic payloads from the actual Graph readers; no provider access or credentials.
import {
  beginMicrosoftFolderDiscovery,
  stepMicrosoftFolderDiscovery,
} from "../../supabase/functions/_shared/microsoft_mail_folders.ts";
import { readMicrosoftMailPage } from "../../supabase/functions/_shared/microsoft_mail_page.ts";
const tenantId = "00000000-0000-4000-8000-000000000001",
  accountId = "00000000-0000-4000-8000-000000000002",
  mailboxId = "00000000-0000-4000-8000-000000000003";
const scope = { tenantId, accountId, mailboxId },
  initial = beginMicrosoftFolderDiscovery(scope, 25);
const first = await stepMicrosoftFolderDiscovery("synthetic", scope, initial, async () =>
  Response.json({
    value: [
      {
        id: "Folder1",
        parentFolderId: "Root",
        displayName: "Synthetic folder",
        childFolderCount: 0,
        totalItemCount: 1,
        unreadItemCount: 0,
        isHidden: false,
      },
    ],
  }),
);
const second = await stepMicrosoftFolderDiscovery("synthetic", scope, first.checkpoint, async () =>
  Response.json({ value: [] }),
);
const mailScope = { ...scope, folderId: "Folder1" };
const mailInitial = {
  contract: "microsoft-message-checkpoint/1",
  scope: mailScope,
  pageSize: 25,
  continuation: null,
};
const mail = await readMicrosoftMailPage(
  "synthetic",
  { ...mailScope, pageSize: 25, continuation: null },
  async () =>
    Response.json({
      value: [
        {
          id: "Message1",
          subject: "Synthetic evidence",
          body: { contentType: "text", content: "Original synthetic content" },
        },
        { id: "Message1", isRead: true },
        { id: "Message1", "@removed": { reason: "deleted" } },
      ],
      "@odata.deltaLink": `https://graph.microsoft.com/v1.0/users/${mailboxId}/mailFolders/Folder1/messages/delta?$deltatoken=synthetic`,
    }),
);
console.log(
  JSON.stringify({
    scope,
    folders: [
      { before: initial, page: first.page, after: first.checkpoint },
      { before: first.checkpoint, page: second.page, after: second.checkpoint },
    ],
    messages: {
      before: mailInitial,
      page: mail,
      after: { ...mailInitial, continuation: mail.continuation },
    },
  }),
);
