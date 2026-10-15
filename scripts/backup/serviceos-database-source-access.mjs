/** Read only the dedicated daily-export login from its exact Keychain item. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const PROJECT = "tgbnakbxwcqjeimygroz";
const ROLE = "serviceos_backup_reader";
const KEYCHAIN = fileURLToPath(new URL("./database-source-keychain.py", import.meta.url));

export async function loadDatabaseSourceReader(execute = promisify(execFile)) {
  try {
    const { stdout } = await execute("python3", ["-B", KEYCHAIN, "--get"],
      { encoding: "utf8", timeout: 15000, maxBuffer: 4096 });
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
