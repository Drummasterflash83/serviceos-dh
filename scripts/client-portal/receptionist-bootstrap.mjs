// Configuration only: NEVER creates users, grants memberships or sends invitations.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
if (!process.argv.includes("--apply"))
  throw Error("Pass --apply to create the receptionist configuration.");
const env = Object.fromEntries(
  readFileSync(".env.verify", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [
        l.slice(0, i),
        l
          .slice(i + 1)
          .trim()
          .replace(/^['"]|['"]$/g, ""),
      ];
    }),
);
if (new URL(env.SUPABASE_URL).hostname !== "tgbnakbxwcqjeimygroz.supabase.co")
  throw Error("Unexpected project");
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const check = (r) => {
  if (r.error) throw Error(r.error.message);
  return r.data;
};
const tenant = "00000000-0000-0000-0000-000000000001";
if (check(await db.from("tenants").select("slug").eq("id", tenant).single()).slug !== "drummonds")
  throw Error("Unexpected tenant");
check(
  await db
    .from("receptionist_workspaces")
    .upsert(
      {
        tenant_id: tenant,
        company: "Drummonds",
        name: "Emma",
        role: "AI receptionist",
        assistant_id: "4eb2bee8-ac25-47c9-b962-409ed250ceb6",
        phone_number: "+44 7426 924154",
        launch_stage: "Testing",
        launch_note:
          "Isolated test number recorded in the launch notes. Main-number routing and current provider configuration still need live verification.",
        knowledge_version:
          "5.4 Service plans and sales voicemail · recorded 18 September 2026; verify current Vapi version",
        vapi_secret_name: "RECEPTIONIST_VAPI_DRUMMONDS",
        slack_secret_name: "RECEPTIONIST_SLACK_DRUMMONDS",
        build_task_id: "019f69e0-4800-76d0-ad0e-faf017a29567",
      },
      { onConflict: "tenant_id", ignoreDuplicates: true },
    ),
);
console.log(
  "Receptionist configuration ready. Existing configuration preserved. No users, memberships, invitations or routing changes.",
);
