// Explicit admin setup. Does not send invitations/emails or generate passwords.
// node scripts/client-portal/bootstrap.mjs --apply
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
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
if (!process.argv.includes("--apply"))
  throw new Error("Pass --apply to create the programme and portal memberships.");
if (new URL(env.SUPABASE_URL).hostname !== "tgbnakbxwcqjeimygroz.supabase.co")
  throw new Error("Unexpected project");
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const tenant = "00000000-0000-0000-0000-000000000001";
function check(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
const company = check(await db.from("tenants").select("slug").eq("id", tenant).single());
if (company.slug !== "drummonds") throw new Error("Unexpected tenant");
const existing = check(
  await db.from("client_programmes").select("tenant_id").eq("tenant_id", tenant).maybeSingle(),
);
if (!existing) {
  check(
    await db
      .from("client_programmes")
      .insert({
        tenant_id: tenant,
        content: JSON.parse(
          readFileSync(new URL("./drummonds-programme.json", import.meta.url), "utf8"),
        ),
      }),
  );
  console.log("Created Drummonds outcome programme.");
} else console.log("Kept existing programme without overwriting edits.");
for (const email of ["chris@openfolk.ai", "heidi@drummondheating.co.uk"]) {
  let profile = check(
    await db.from("profiles").select("id,tenant_id,role").eq("email", email).maybeSingle(),
  );
  if (!profile) {
    const created = check(
      await db.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { full_name: email.startsWith("heidi") ? "Heidi" : "Chris" },
      }),
    );
    profile = check(
      await db.from("profiles").select("id,tenant_id,role").eq("id", created.user.id).single(),
    );
    console.log(`Created ${email} without password or operational tenant assignment.`);
  }
  check(
    await db
      .from("client_portal_access")
      .upsert(
        { tenant_id: tenant, profile_id: profile.id },
        { onConflict: "tenant_id,profile_id", ignoreDuplicates: true },
      ),
  );
  console.log(`Portal membership ready: ${email}; existing operational role and tenant unchanged.`);
}
console.log("No invitation sent. Heidi can use Forgot password at /login to choose her password.");
