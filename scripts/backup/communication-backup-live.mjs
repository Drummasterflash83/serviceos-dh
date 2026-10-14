/** Fixed approved source/destination. No access expansion or key persistence. */
import { createHash } from "node:crypto";
import { binding, loadRecordingCredential } from "./drummonds-recording-backup-access.mjs";
import { savedCliToken } from "../verify/learn-test-readiness.mjs";
import { createRecordingSource, createVoicemailSource } from "./recording-backup-source.mjs";
import { createRecordingS3 } from "./recording-backup-s3.mjs";
import { RecordingBackupError } from "./recording-backup-core.mjs";
const check = (v, c) => {
  if (!v) throw new RecordingBackupError(c);
};
export async function resolveCommunicationSourceCredential(management) {
  const project = await management("");
  check(
    project?.id === binding.sourceProjectRef &&
      project.organization_id === "nmhqcjrjrtwsvlcvqqnh" &&
      project.status === "ACTIVE_HEALTHY",
    "communication_source_identity_invalid",
  );
  const keys = await management("/api-keys?reveal=true"),
    secrets = await management("/secrets");
  check(Array.isArray(keys) && Array.isArray(secrets), "communication_source_credential_invalid");
  const selected = secrets.filter((x) => x.name === "SUPABASE_SERVICE_ROLE_KEY");
  check(selected.length === 1, "communication_source_credential_invalid");
  const digest = selected[0].digest ?? selected[0].value;
  check(/^[a-f0-9]{64}$/.test(digest ?? ""), "communication_source_credential_invalid");
  const matches = keys.filter(
    (k) =>
      typeof k.api_key === "string" &&
      createHash("sha256").update(k.api_key).digest("hex") === digest,
  );
  check(matches.length === 1, "communication_source_credential_invalid");
  return matches[0].api_key;
}
export async function createLiveCommunicationSession(signal, budget) {
  const token = savedCliToken();
  let calls = 0;
  const management = async (suffix) => {
    check(++calls <= 3, "communication_management_limit");
    const response = await fetch(
      `https://api.supabase.com/v1/projects/${binding.sourceProjectRef}${suffix}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
      },
    );
    check(response.ok && response.body, "communication_source_access_unconfirmed");
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      check(bytes <= 1048576, "communication_management_size");
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  };
  let key = await resolveCommunicationSourceCredential(management),
    writer = await loadRecordingCredential("Writer");
  return {
    async ports(bucket) {
      check(
        ["phone-recordings", "learn-voicemail-sources", "receptionist-voicemails"].includes(bucket),
        "communication_bucket_invalid",
      );
      const options = {
        readAttempts: 3,
        signal,
        credentials: async () => ({ apikey: key, token: key }),
        requestBudget: 100000,
        fetcher: (url, options) => {
          budget.sourceRequest();
          return fetch(url, {
            ...options,
            signal: AbortSignal.any([signal, options.signal]),
          });
        },
      };
      const source =
        bucket === "phone-recordings"
          ? createRecordingSource(binding, options)
          : createVoicemailSource(binding, bucket, options);
      const destination = createRecordingS3(binding, {
        readAttempts: 3,
        credentials: async () => ({
          accessKeyId: writer.accessKeyId,
          secretAccessKey: writer.secretAccessKey,
        }),
        expectedPrincipalArn: writer.principalArn,
        signal,
      });
      return { source, ...destination };
    },
    close() {
      key = "";
      writer = null;
    },
  };
}
