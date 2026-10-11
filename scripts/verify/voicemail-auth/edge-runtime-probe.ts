import { runVoicemailQueueJob } from "../../../supabase/functions/_shared/voicemail/queue.ts";
// Copied into an offline disposable runtime with a freshly generated fixture.
import {
  extractSignedVoicemail,
  decodeVoicemailAudio,
  importPrivateVoicemail,
} from "../../../supabase/functions/_shared/voicemail/edge.js";
import { importWorkspaceVoicemail } from "../../../supabase/functions/_shared/voicemail/workspace-import.ts";
import { createVoicemailImportHttpHandler } from "../../../supabase/functions/_shared/voicemail/import-http.ts";
import { providerKeyResolver } from "../../../supabase/functions/_shared/voicemail/provider-keys.js";
import { Buffer } from "node:buffer";
import fixture from "./fixture.json" with { type: "json" };
Deno.serve(async () => {
  const resolver = async (name, type) => {
    if (name !== fixture.dnsName || type !== "TXT") throw Error("Unexpected DNS query");
    return [[fixture.keyRecord]];
  };
  const options = {
    internalDate: "1791705600000",
    expectedMailbox: "synthetic@example.invalid",
    resolver,
  };
  try {
    const extracted = await extractSignedVoicemail(new TextEncoder().encode(fixture.raw), options);
    if (
      !extracted.signature.contentSignatureVerified ||
      extracted.audio.length !== fixture.audioBytes ||
      extracted.audioSha256 !== fixture.audioSha256
    )
      throw Error("Synthetic extraction mismatch");
    const decoded = await decodeVoicemailAudio(extracted.audio);
    if (JSON.stringify(decoded) !== JSON.stringify(fixture.decoded))
      throw Error("Edge/Node decode differs");
    let tamperRejected = false,
      invalidAudioRejected = false;
    try {
      await extractSignedVoicemail(
        new TextEncoder().encode(fixture.raw.replace("runtime check.", "tampered.")),
        options,
      );
    } catch {
      tamperRejected = true;
    }
    try {
      await decodeVoicemailAudio(new Uint8Array([1, 2, 3, 4]));
    } catch (e) {
      invalidAudioRejected = /^voicemail_decode_/.test(e.message);
    }
    if (!tamperRejected || !invalidAudioRejected) throw Error("Rejection check failed");
    // Controlled SDK-shaped transport tests runtime orchestration, not SQL or real Storage.
    const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const routeId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const accountId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const mailboxId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const intakeId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const sourceId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const stored = new Map();
    const rpcCalls = [];
    let uploads = 0,
      readbacks = 0;
    const queueJobId = "abababab-abab-4bab-8bab-abababababab";
    let queueReceipt = null,
      queueRecovered = false;
    const queueRequest = {
      tenantId,
      routeId,
      accountId,
      messageId: "abcdef1234",
      internalDate: options.internalDate,
    };
    const client = {
      rpc: async (name, args) => {
        if (name === "voicemail_queue_step") {
          if (
            args.p_tenant !== tenantId ||
            args.p_job !== queueJobId ||
            args.p_worker !== "synthetic-edge-worker" ||
            args.p_attempt !== 1
          )
            throw Error("Queue scope differs");
          if (args.p_operation === "bind")
            return {
              data: queueReceipt
                ? { state: "settled", receipt: queueReceipt }
                : { state: "bound", request: queueRequest },
            };
          if (args.p_operation === "fail" || args.p_operation === "inspect") {
            if (!queueReceipt) throw Error("No queue receipt");
            return { data: queueReceipt };
          }
          const operation = {
            route: "voicemail_intake_route",
            prepare: "voicemail_intake_prepare",
            publish: "voicemail_intake_publish",
          }[args.p_operation];
          if (!operation) throw Error("Unknown queue step");
          const result = await client.rpc(operation, args.p_args);
          if (args.p_operation !== "publish") return result;
          queueReceipt = {
            version: "voicemail-queue/1",
            tenant_id: tenantId,
            job_id: queueJobId,
            worker: "synthetic-edge-worker",
            attempt: 1,
            state: "succeeded",
            records_processed: 1,
            message_id: intakeId,
            code: null,
            settled_at: new Date().toISOString(),
            coverage_complete: false,
          };
          throw Error("Synthetic lost queue publication acknowledgement");
        }
        rpcCalls.push(name);
        if (args.p_tenant !== tenantId) throw Error("Tenant differs");
        if (name === "voicemail_intake_route")
          return {
            data: {
              id: routeId,
              tenant_id: tenantId,
              email_account_id: accountId,
              enabled: true,
              signing_domain: "birchills-net.20251104.gappssmtp.com",
              mailbox_id: mailboxId,
              recipient_email: options.expectedMailbox,
            },
          };
        if (name === "voicemail_intake_prepare")
          return {
            data: {
              intake_id: intakeId,
              source_id: sourceId,
              state: "prepared",
              audio_path: `${tenantId}/${mailboxId}/${intakeId}`,
              source_path: `${tenantId}/${intakeId}/${sourceId}.eml`,
            },
          };
        if (name === "voicemail_intake_publish") {
          if (readbacks !== 2 || args.p_audio_sha256 !== fixture.audioSha256)
            throw Error("Publish before readback");
          return { data: { state: "published", message_id: intakeId } };
        }
        throw Error("Unexpected RPC");
      },
      storage: {
        from: (bucket) => ({
          upload: async (path, bytes, options) => {
            if (options.upsert !== false || stored.has(`${bucket}/${path}`))
              throw Error("Overwrite");
            uploads++;
            stored.set(`${bucket}/${path}`, new Blob([bytes], { type: options.contentType }));
            return { error: null };
          },
          download: async (path) => {
            readbacks++;
            return { data: stored.get(`${bucket}/${path}`) };
          },
        }),
      },
    };
    let providerReads = 0,
      tokenReads = 0;
    const importRequest = (transport, input) =>
      importWorkspaceVoicemail(transport, input, {
        importer: importPrivateVoicemail,
        resolver: providerKeyResolver((name) => resolver(name, "TXT")).resolve,
        ports: () => ({
          mailbox: async () => ({
            tenantId,
            accountId,
            mailbox: options.expectedMailbox,
            profileMailbox: options.expectedMailbox,
          }),
          accessToken: async () => {
            tokenReads++;
            return "synthetic-provider-token";
          },
        }),
        fetcher: async (url, init) => {
          providerReads++;
          if (
            init.redirect !== "error" ||
            init.headers.Authorization !== "Bearer synthetic-provider-token"
          )
            throw Error("Provider request unsafe");
          if (url === "https://gmail.googleapis.com/gmail/v1/users/me/profile")
            return Response.json({ emailAddress: options.expectedMailbox });
          if (
            url !== "https://gmail.googleapis.com/gmail/v1/users/me/messages/abcdef1234?format=raw"
          )
            throw Error("Unexpected URL");
          return Response.json({
            id: "abcdef1234",
            internalDate: options.internalDate,
            raw: Buffer.from(fixture.raw).toString("base64url"),
          });
        },
      });
    const queueContext = {
      supabaseAdmin: client,
      tenantId,
      jobId: queueJobId,
      jobType: "phone.voicemail_import",
      payload: {},
      claim: { claimedBy: "synthetic-edge-worker", attemptCount: 1 },
    };
    const endpoint = createVoicemailImportHttpHandler({
      serviceKey: "synthetic-server-secret",
      run: async (input) => {
        if (!fixture.queue) return importRequest(client, input);
        const result = await runVoicemailQueueJob(queueContext, importRequest);
        if (result.state !== "succeeded" || !result.historicalReceipt)
          throw Error("Lost queue receipt not recovered");
        queueRecovered = true;
        return { state: "published", messageId: intakeId, storedBytesReadBack: true };
      },
    });
    const rejected = await endpoint(
      new Request("http://localhost/import", { method: "POST", body: "{}" }),
    );
    if (rejected.status !== 403 || tokenReads || providerReads || rpcCalls.length)
      throw Error("Auth did not precede work");
    const response = await endpoint(
      new Request("http://localhost/import", {
        method: "POST",
        headers: {
          authorization: "Bearer synthetic-server-secret",
          "x-internal-tenant-id": tenantId,
        },
        body: JSON.stringify({
          routeId,
          accountId,
          messageId: "abcdef1234",
          internalDate: options.internalDate,
        }),
      }),
    );
    const imported = await response.json();
    if (
      response.status !== 200 ||
      imported.success !== true ||
      imported.messageId !== intakeId ||
      imported.coverageComplete !== false ||
      uploads !== 2 ||
      readbacks !== 2 ||
      rpcCalls.length !== 5 ||
      providerReads !== 2 ||
      tokenReads !== 1
    )
      throw Error("Import orchestration incomplete: " + JSON.stringify(imported));
    if (fixture.queue) {
      const result = await runVoicemailQueueJob(queueContext, () => {
        throw Error("Completed queue job must not read the provider");
      });
      if (result.state !== "succeeded" || !result.historicalReceipt || providerReads !== 2)
        throw Error("Completed queue replay failed");
    }
    return Response.json({
      state: "passed",
      queueLostAcknowledgementRecovered: queueRecovered,
      queueReplayWithoutProvider: fixture.queue === true,
      signedExtraction: true,
      tamperRejected,
      invalidAudioRejected,
      positiveAudioDecode: decoded,
      coordinatorWithControlledTransport: true,
      internalAuthEnforced: true,
      workspaceProviderBridge: true,
      providerReads,
      tokenReads,
      uploads,
      readbacks,
      audioBytes: fixture.audioBytes,
      version: Deno.version,
    });
  } catch (e) {
    return Response.json({ state: "failed", error: e.message, stack: e.stack }, { status: 500 });
  }
});
