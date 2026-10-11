/** Bounded read-only check of three retained notification candidates. No audio or imports. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken } from "./learn-test-readiness.mjs";
import { getDelegatedToken } from "../../supabase/functions/_shared/google_workspace.ts";
const project = "tgbnakbxwcqjeimygroz",
  tenant = "00000000-0000-0000-0000-000000000001";
if (process.argv.slice(2).join(" ") !== "--read-only-production-and-google")
  throw Error("Explicit read-only scope required");
const key = JSON.parse(
    readFileSync("/Users/chrisdrummond/Downloads/ServiceOS Workspace Connector.json", "utf8"),
  ),
  token = savedCliToken();
const q = (v) => "'" + String(v).replaceAll("'", "''") + "'";
async function bounded(r) {
  if (!r.ok) throw Error("Scoped read unavailable HTTP " + r.status);
  const chunks = [];
  let size = 0;
  for await (const c of r.body) {
    size += c.byteLength;
    if (size > 1048576) throw Error("Response too large");
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
async function query(query) {
  return bounded(
    await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    }),
  );
}
const connections = await query(
  `select domain,service_account_email,service_account_client_id from google_workspace_connections where tenant_id=${q(tenant)} and status='active'`,
);
const matches = connections.filter(
  (c) =>
    c.service_account_email === key.client_email &&
    String(c.service_account_client_id) === key.client_id,
);
if (matches.length !== 1) throw Error("Existing credential binding differs");
const connection = matches[0];
const candidates = await query(`select m.id,m.provider_message_id,m.body_text,
 (select jsonb_agg(jsonb_build_object('id',a.id,'email',a.email_address)) from email_accounts a where a.tenant_id=m.tenant_id and a.provider='gmail' and a.status='active_dwd' and lower(split_part(a.email_address,'@',2))=lower(${q(connection.domain)}) and exists(select 1 from jsonb_array_elements_text(m.to_emails) e where lower(e)=lower(a.email_address))) as recipient_accounts
 from email_messages m where m.tenant_id=${q(tenant)} and m.provider='gmail' and lower(trim(split_part(m.from_email,'@',2))) ~ '(^|\\.)birchills\\.net$' and m.subject ~* 'new message' and coalesce(m.body_text,'') ~* '(voice[ -]?mail|mailbox|voice message)' and m.raw_payload->'has_attachments'='true'::jsonb order by m.received_at desc nulls last,m.id limit 3`);
if (candidates.length !== 3) throw Error("Expected bounded candidate sample missing");
const stem = ".verification-results/voicemail-gmail-sample";
writeFileSync(
  stem + "-journal.json",
  JSON.stringify(
    {
      project,
      tenant,
      startedAt: new Date().toISOString(),
      candidateIds: candidates.map((c) => c.id),
      maxTokenRequests: 3,
      maxMessageRequests: 3,
      audioRequests: 0,
      scope: "gmail.readonly",
    },
    null,
    2,
  ),
  { flag: "wx", mode: 0o600 },
);
const results = [],
  privateSamples = [];
let tokenRequests = 0,
  messageRequests = 0;
for (const c of candidates) {
  const fingerprint = createHash("sha256").update(`${tenant}:${c.id}`).digest("hex");
  if (
    !/^[a-f0-9]{1,64}$/i.test(c.provider_message_id ?? "") ||
    !Array.isArray(c.recipient_accounts) ||
    c.recipient_accounts.length !== 1
  ) {
    results.push({ fingerprint, state: "mailbox_binding_ambiguous" });
    continue;
  }
  const account = c.recipient_accounts[0];
  if (
    typeof account.email !== "string" ||
    account.email.split("@")[1].toLowerCase() !== connection.domain.toLowerCase()
  )
    throw Error("Mailbox scope differs");
  try {
    tokenRequests++;
    const delegated = await getDelegatedToken(
      {
        clientEmail: key.client_email,
        privateKey: key.private_key,
        subject: account.email,
        domain: connection.domain,
      },
      ["https://www.googleapis.com/auth/gmail.readonly"],
    );
    const partFields = (depth) =>
      "mimeType,filename,body(attachmentId,size)" +
      (depth > 0 ? `,parts(${partFields(depth - 1)})` : "");
    const url = new URL(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(c.provider_message_id)}`,
    );
    url.searchParams.set("format", "full");
    url.searchParams.set(
      "fields",
      `id,threadId,labelIds,internalDate,payload(headers(name,value),${partFields(4)})`,
    );
    messageRequests++;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${delegated.accessToken}` },
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      results.push({ fingerprint, state: "provider_read_unconfirmed", status: response.status });
      continue;
    }
    const data = await bounded(response);
    if (data.id !== c.provider_message_id) throw Error("Message identity differs");
    const headers = (data.payload?.headers ?? []).filter((h) =>
      ["from", "to", "delivered-to", "subject", "message-id", "authentication-results"].includes(
        String(h.name).toLowerCase(),
      ),
    );
    const auth = headers.filter((h) => h.name.toLowerCase() === "authentication-results");
    const parts = [];
    function walk(p, depth = 0) {
      if (depth > 5 || parts.length > 100) throw Error("MIME structure exceeds budget");
      if (p.filename || p.body?.attachmentId)
        parts.push({
          mimeType: p.mimeType,
          filename: p.filename ?? "",
          attachmentId: p.body?.attachmentId ?? null,
          size: p.body?.size ?? null,
        });
      for (const child of p.parts ?? []) walk(child, depth + 1);
    }
    walk(data.payload);
    const audio = parts.filter(
      (p) => /^audio\//i.test(p.mimeType ?? "") || /\.(wav|mp3|gsm|ogg|m4a)$/i.test(p.filename),
    );
    const authText = auth.map((h) => h.value).join("\n");
    const summary = {
      fingerprint,
      state: "provider_metadata_read",
      audioParts: audio.length,
      audioTypes: [...new Set(audio.map((p) => p.mimeType))],
      audioBytes: audio.reduce((n, p) => n + (Number.isSafeInteger(p.size) ? p.size : 0), 0),
      audioAttachmentIdsPresent: audio.every(
        (p) => typeof p.attachmentId === "string" && p.attachmentId.length > 0,
      ),
      authenticationResultsHeaders: auth.length,
      googleAuthservHint: auth.some((h) => /^mx\.google\.com\s*;/i.test(h.value)),
      spfPassHint: /\bspf=pass\b/i.test(authText),
      dkimPassHint: /\bdkim=pass\b/i.test(authText),
      dmarcPassHint: /\bdmarc=pass\b/i.test(authText),
      newMessageSubject: headers.some(
        (h) => h.name.toLowerCase() === "subject" && /new message/i.test(h.value),
      ),
    };
    results.push(summary);
    privateSamples.push({
      sourceId: c.id,
      accountId: account.id,
      mailbox: account.email,
      gmailId: data.id,
      headers,
      parts,
      retainedBody: c.body_text,
    });
  } catch (e) {
    results.push({
      fingerprint,
      state: "scoped_read_failed",
      code: /^[a-z_]+$/.test(e.code ?? "") ? e.code : "read_unconfirmed",
    });
  }
}
const report = {
  observedAt: new Date().toISOString(),
  state: "bounded_metadata_check_complete",
  projectRef: project,
  tenantId: tenant,
  tokenRequests,
  messageRequests,
  audioRequests: 0,
  productionChanged: false,
  testCredentialUploaded: false,
  results,
  limitations: [
    "Three direct-recipient candidates only, no complete mailbox coverage.",
    "Authentication header pass hints are diagnostic, not a trusted sender-verification implementation.",
    "Attachment metadata is not downloaded/playable audio; no message ownership or import is established.",
  ],
};
writeFileSync(stem + "-private.json", JSON.stringify(privateSamples, null, 2) + "\n", {
  flag: "wx",
  mode: 0o600,
});
writeFileSync(stem + "-result.json", JSON.stringify(report, null, 2) + "\n", {
  flag: "wx",
  mode: 0o600,
});
console.log(JSON.stringify(report, null, 2));
