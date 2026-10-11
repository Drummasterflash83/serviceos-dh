// Copied into an offline disposable runtime with a freshly generated fixture.
import {
  extractSignedVoicemail,
  decodeVoicemailAudio,
  importPrivateVoicemail,
} from "../../../supabase/functions/_shared/voicemail/edge.js";
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
    const client = {
      rpc: async (name, args) => {
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
    const imported = await importPrivateVoicemail({
      client,
      tenantId,
      routeId,
      source: { accountId, id: "abcdef1234", internalDate: options.internalDate },
      resolver,
      loadRaw: async ({ id }) => ({
        id,
        internalDate: options.internalDate,
        raw: new TextEncoder().encode(fixture.raw),
      }),
    });
    if (
      imported.state !== "published" ||
      !imported.storedBytesReadBack ||
      uploads !== 2 ||
      rpcCalls.length !== 4
    )
      throw Error("Import orchestration incomplete");
    return Response.json({
      state: "passed",
      signedExtraction: true,
      tamperRejected,
      invalidAudioRejected,
      positiveAudioDecode: decoded,
      coordinatorWithControlledTransport: true,
      uploads,
      readbacks,
      audioBytes: fixture.audioBytes,
      version: Deno.version,
    });
  } catch (e) {
    return Response.json({ state: "failed", error: e.message, stack: e.stack }, { status: 500 });
  }
});
