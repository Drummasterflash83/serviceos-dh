/** Read only the dedicated daily-export login from its exact Keychain item. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const PROJECT = "tgbnakbxwcqjeimygroz";
const ROLE = "serviceos_backup_reader";
const SERVICE = "OpenFolk.ServiceOS.DatabaseSource.Reader";

export async function loadDatabaseSourceReader(execute = promisify(execFile)) {
  try {
    const { stdout } = await execute("/usr/bin/security", [
      "find-generic-password", "-s", SERVICE, "-a", PROJECT, "-w",
    ], { encoding: "utf8", timeout: 15000, maxBuffer: 4096 });
    const value = JSON.parse(stdout);
    if (value?.project !== PROJECT || value?.role !== ROLE ||
      value?.host !== "aws-1-eu-west-2.pooler.supabase.com" ||
      typeof value.password !== "string" ||
      value.password.length < 32 || value.password.length > 256 ||
      /[\r\n\0]/.test(value.password) ||
      Object.keys(value).sort().join(",") !== "host,password,project,role")
      throw Error("invalid");
    return value;
  } catch {
    throw Error("database_source_reader_unavailable");
  }
}
