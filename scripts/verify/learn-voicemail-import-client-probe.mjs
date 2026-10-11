/** Actual SQL RPCs + synthetic signed mail, with controlled in-memory storage faults.
 * This checks orchestration, not hosted Storage transport or real audio decoding.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { generateKeyPairSync } from "node:crypto";
import { importPrivateVoicemail } from "./voicemail-auth/private-import.mjs";
import { signingDomain } from "./voicemail-auth/signed-voicemail.mjs";
const container = process.argv[2];
if (!/^serviceos-voicemail-intake-[a-f0-9]{8}$/.test(container ?? ""))
  throw Error("Offline fixture container required");
const require = createRequire(import.meta.url),
  { dkimSign } = require("./voicemail-auth/node_modules/mailauth/lib/dkim/sign.js");
const id = (n) => "ce420000-aaaa-4000-8000-" + String(n).padStart(12, "0");
const q = (s) => "'" + String(s).replaceAll("'", "''") + "'";
function sql(query) {
  return execFileSync(
    "/usr/local/bin/docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-h",
      "127.0.0.1",
      "-X",
      "-qAt",
      "-U",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
}
sql(
  `insert into receptionist_voicemail_email_routes(id,tenant_id,mailbox_id,email_account_id,recipient_email,signing_domain,owner_user_id,access_mode,received_from,binding_evidence,verified_by,enabled) values('${id(7)}','${id(1)}','${id(5)}','${id(3)}','synthetic@example.invalid','${signingDomain}','${id(10)}','owner','2026-10-01','Synthetic coordinator test','${id(12)}',true);`,
);
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const resolver = async (name, type) => {
  assert.equal(name, `synthetic._domainkey.${signingDomain}`);
  assert.equal(type, "TXT");
  return [
    ["v=DKIM1; k=rsa; p=" + publicKey.export({ type: "spki", format: "der" }).toString("base64")],
  ];
};
const objects = new Map();
let mode = "",
  providerReads = 0,
  uploads = 0,
  readbacks = 0;
const rpcArgs = {
  voicemail_intake_route: ["p_tenant", "p_route", "p_received"],
  voicemail_intake_prepare: ["p_tenant", "p_route", "p_source", "p_candidate"],
  voicemail_intake_publish: ["p_tenant", "p_intake", "p_source", "p_raw_sha256", "p_audio_sha256"],
};
const client = {
  rpc: async (name, args) => {
    assert.ok(rpcArgs[name]);
    const values = rpcArgs[name].map((k) =>
      q(typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k]),
    );
    try {
      const data = JSON.parse(
        sql(`set role service_role;select to_jsonb(public.${name}(${values.join(",")}));`),
      );
      if (name === "voicemail_intake_publish" && mode === "lost_publication_ack") {
        mode = "";
        return { error: { code: "timeout" } };
      }
      return { data, error: null };
    } catch {
      return { data: null, error: { code: "rejected" } };
    }
  },
  storage: {
    from(bucket) {
      assert.ok(["learn-voicemail-sources", "receptionist-voicemails"].includes(bucket));
      return {
        async upload(path, bytes, options) {
          uploads++;
          assert.equal(options.upsert, false);
          const key = bucket + ":" + path;
          if (objects.has(key)) return { error: { status: 409 } };
          if (bucket === "receptionist-voicemails" && mode === "fail_audio_write")
            return { error: { status: 503 } };
          objects.set(key, Buffer.from(bytes));
          sql(
            `insert into storage.objects(bucket_id,name,metadata) values(${q(bucket)},${q(path)},${q(JSON.stringify({ size: bytes.length, mimetype: options.contentType }))}::jsonb);`,
          );
          if (bucket === "receptionist-voicemails" && mode === "pause_after_upload")
            sql(
              `insert into feature_flags values('${id(1)}','learn.inputs.phone.enabled','false');`,
            );
          return mode === "lost_storage_ack"
            ? { error: { status: 503 } }
            : { data: { path }, error: null };
        },
        async download(path) {
          readbacks++;
          const bytes = objects.get(bucket + ":" + path);
          if (!bytes) return { error: { status: 404 } };
          const copy = Buffer.from(bytes);
          if (mode === "corrupt_readback" && bucket === "receptionist-voicemails") copy[0] ^= 1;
          return { data: new Blob([copy]), error: null };
        },
      };
    },
  },
};
async function fixture(n) {
  const text = `Dear Mailbox Owner,\r\n\r\nYou have a new message in mailbox 601 from 01234567890 (28 seconds).\r\n\r\nAutomated transcription:\r\nSynthetic coordinator source.\r\n\r\nSystem reference: ${id(n)}\r\n`;
  const body = `From: synthetic@birchills.net\r\nTo: synthetic@example.invalid\r\nSubject: New message in mailbox 601 from 01234567890\r\nDate: Sun, 11 Oct 2026 12:00:00 +0000\r\nMessage-ID: <synthetic-${n}@example.invalid>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=synthetic\r\n\r\n--synthetic\r\nContent-Type: text/plain\r\n\r\n${text}\r\n--synthetic\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename=message.mp3\r\nContent-Transfer-Encoding: base64\r\n\r\nAQIDBA==\r\n--synthetic--\r\n`;
  const signed = await dkimSign(body, {
    strict: true,
    signatureData: [
      {
        signingDomain,
        selector: "synthetic",
        privateKey: privateKey.export({ type: "pkcs8", format: "pem" }),
      },
    ],
  });
  assert.equal(signed.errors.length, 0);
  const raw = Buffer.from(signed.signatures + body),
    source = { id: n.toString(16), accountId: id(3), internalDate: "1791705600000" };
  return {
    client,
    tenantId: id(1),
    routeId: id(7),
    source,
    resolver,
    loadRaw: async () => {
      providerReads++;
      return { id: source.id, internalDate: source.internalDate, raw };
    },
    decodeAudio: async (bytes) => {
      assert.deepEqual([...bytes], [1, 2, 3, 4]);
      return { state: "decoded", frames: 224000, durationSeconds: 28 };
    },
  };
}
const count = () =>
  Number(
    sql(
      `select count(*) from receptionist_voicemails where provider_message_id in (select provider_reference::text from receptionist_voicemail_intakes where route_id='${id(7)}');`,
    ),
  );
const first = await fixture(100);
sql(`update receptionist_voicemail_email_routes set enabled=false where id='${id(7)}';`);
await assert.rejects(importPrivateVoicemail(first), /route_unconfirmed/);
assert.equal(providerReads, 0);
assert.equal(uploads, 0);
sql(`update receptionist_voicemail_email_routes set enabled=true where id='${id(7)}';`);
await assert.rejects(
  importPrivateVoicemail({ ...first, decodeAudio: async () => ({ state: "not_checked" }) }),
  /decode_unconfirmed/,
);
assert.equal(uploads, 0);
await assert.rejects(
  importPrivateVoicemail({
    ...first,
    loadRaw: async () => ({ ...(await first.loadRaw()), internalDate: "1791705601000" }),
  }),
  /provider_source_changed/,
);
assert.equal(uploads, 0);
await assert.rejects(
  importPrivateVoicemail({ ...first, decodeAudio: undefined }),
  /decode_unconfirmed/,
);
assert.equal(uploads, 0); // actual portable decoder rejects fixture bytes
mode = "fail_audio_write";
await assert.rejects(importPrivateVoicemail(first), /readback_unconfirmed/);
assert.equal(count(), 0);
assert.equal(objects.size, 1);
mode = "";
const complete = await importPrivateVoicemail(first);
assert.equal(complete.state, "published");
assert.equal(count(), 1);
assert.equal(objects.size, 2);
const replay = await importPrivateVoicemail(first);
assert.deepEqual(replay, complete);
assert.equal(count(), 1);
assert.equal(objects.size, 2);
mode = "corrupt_readback";
await assert.rejects(importPrivateVoicemail(await fixture(101)), /content_conflict/);
assert.equal(count(), 1);
mode = "lost_storage_ack";
await importPrivateVoicemail(await fixture(102));
assert.equal(count(), 2);
const lost = await fixture(103);
mode = "lost_publication_ack";
await assert.rejects(importPrivateVoicemail(lost), /publish_unconfirmed/);
assert.equal(count(), 3);
await importPrivateVoicemail(lost);
assert.equal(count(), 3);
const paused = await fixture(104);
mode = "pause_after_upload";
await assert.rejects(importPrivateVoicemail(paused), /publish_unconfirmed/);
assert.equal(count(), 3);
mode = "";
sql("delete from feature_flags;");
await importPrivateVoicemail(paused);
assert.equal(count(), 4);
const beforeObjects = objects.size;
await assert.rejects(
  importPrivateVoicemail({
    ...(await fixture(105)),
    decodeAudio: async (bytes) => {
      bytes[0] ^= 1;
      return { state: "decoded", frames: 224000, durationSeconds: 28 };
    },
  }),
  /source_mutated/,
);
assert.equal(objects.size, beforeObjects);
assert.equal(
  sql(
    `select count(*) from receptionist_voicemails where id in(select id from receptionist_voicemail_intakes where route_id='${id(7)}') and owner_user_id<>'${id(10)}';`,
  ),
  "0",
);
console.log(
  JSON.stringify({
    state: "actual_sql_coordinator_checks_passed",
    publishedMessages: count(),
    provider: "synthetic_loader_only",
    storage: "controlled_in_memory_adapter_with_actual_SQL_metadata",
    decoder: "synthetic_contract_double_for_publication_actual_decoder_rejects_invalid_fixture",
    providerReads,
    uploadAttempts: uploads,
    readbacks,
    cases: [
      "route_pause_before_provider",
      "decode_required",
      "provider_receipt_change_denied",
      "actual_decoder_rejects_invalid_audio",
      "partial_upload_retry",
      "identical_replay",
      "corrupt_readback_denied",
      "lost_storage_ack_resolved",
      "lost_publication_ack_replay",
      "pause_during_upload",
      "decoder_mutation_denied",
      "historical_owner_snapshot",
    ],
    hostedRequests: 0,
  }),
);
