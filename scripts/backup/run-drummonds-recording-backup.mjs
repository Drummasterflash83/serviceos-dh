import { binding, loadRecordingCredential } from "./drummonds-recording-backup-access.mjs";
/** Explicit, bounded live-copy entry point. Do not activate until the reviewed
 * AWS identity/key provisioning is approved and verified. Never prints secrets. */
import { pathToFileURL } from "node:url";
import { savedCliToken } from "../verify/learn-test-readiness.mjs";
import { createRecordingSource } from "./recording-backup-source.mjs";
import { createRecordingS3 } from "./recording-backup-s3.mjs";
import { runRecordingBackup } from "./recording-backup-runner.mjs";
import { RecordingBackupError } from "./recording-backup-core.mjs";
const fail = (code) => {
  throw new RecordingBackupError(code);
};
export { binding };
export function parseRunArgs(args) {
  if (args.length !== 3 && args.length !== 5) fail("runner_arguments_invalid");
  const [action, directory, inventoryFileSha256, count, bytes] = args;
  if (
    !["--copy-drummonds", "--finalize-drummonds"].includes(action) ||
    !directory ||
    !/^[a-f0-9]{64}$/.test(inventoryFileSha256 ?? "") ||
    (args.length === 5 && (!/^[1-9][0-9]*$/.test(count) || !/^[1-9][0-9]*$/.test(bytes)))
  )
    fail("runner_arguments_invalid");
  const maxObjects = count ? Number(count) : 25,
    maxBytes = bytes ? Number(bytes) : 32 * 1024 * 1024;
  if (maxObjects > 100 || maxBytes > 256 * 1024 * 1024) fail("runner_arguments_invalid");
  return {
    mode: action === "--copy-drummonds" ? "copy" : "finalize",
    directory,
    inventoryFileSha256,
    maxObjects,
    maxBytes,
  };
}
export const loadWriterCredential = (execute) => loadRecordingCredential("Writer", execute);
export async function createLiveRecordingPorts(signal, { requestBudget = 20000 } = {}) {
  if (!Number.isSafeInteger(requestBudget) || requestBudget < 1 || requestBudget > 100000)
    fail("runner_source_budget_invalid");
  const writer = await loadWriterCredential();
  const token = savedCliToken();
  const readManagement = async (suffix) => {
    const response = await fetch(
      `https://api.supabase.com/v1/projects/${binding.sourceProjectRef}${suffix}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
      },
    );
    if (!response.ok || !response.body) fail("runner_source_access_unavailable");
    let length = 0;
    const parts = [];
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > 1024 * 1024) fail("runner_source_access_unverified");
      parts.push(chunk);
    }
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  };
  const project = await readManagement("");
  if (
    project.id !== binding.sourceProjectRef ||
    project.organization_id !== "nmhqcjrjrtwsvlcvqqnh" ||
    project.status !== "ACTIVE_HEALTHY"
  )
    fail("runner_source_identity_unverified");
  const keys = await readManagement("/api-keys");
  const key = keys.find((k) => k.name === "service_role")?.api_key;
  if (typeof key !== "string" || !key) fail("runner_source_credential_unavailable");
  const source = createRecordingSource(binding, {
    credentials: async () => ({ apikey: key, token: key }),
    requestBudget,
    fetcher: (url, options) =>
      fetch(url, { ...options, signal: AbortSignal.any([signal, options.signal]) }),
  });
  const destination = createRecordingS3(binding, {
    credentials: async () => ({
      accessKeyId: writer.accessKeyId,
      secretAccessKey: writer.secretAccessKey,
    }),
    expectedPrincipalArn: writer.principalArn,
    signal,
  });
  return { source, ...destination };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let progress;
  try {
    const args = parseRunArgs(process.argv.slice(2));
    const signal = AbortSignal.timeout(30 * 60 * 1000);
    progress = setInterval(
      () =>
        console.log(
          JSON.stringify({
            state: "recording_backup_in_progress",
            mode: args.mode,
            backupComplete: false,
          }),
        ),
      30000,
    );
    const result = await runRecordingBackup({
      ...args,
      binding,
      signal,
      onProgress: (progress) => console.log(JSON.stringify({ state: 'recording_backup_verifying', ...progress, backupComplete: false })),
      createPorts: () => createLiveRecordingPorts(signal),
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error(
      JSON.stringify({
        state: "recording_backup_unconfirmed",
        code: e instanceof RecordingBackupError ? e.code : "runner_failed",
        backupComplete: false,
      }),
    );
    process.exitCode = 1;
  } finally {
    clearInterval(progress);
  }
}
