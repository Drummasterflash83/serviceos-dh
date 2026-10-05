// Explicit private client invoice publication. No invitations or payment actions.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const input = process.argv[2];
if (!input || !process.argv.includes("--apply"))
  throw Error("Private manifest path and --apply required");
const env = Object.fromEntries(
  readFileSync("/Users/chrisdrummond/serviceos-dh/.env.verify", "utf8")
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
  throw Error("Wrong project");
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const m = JSON.parse(readFileSync(input, "utf8"));
const check = (r) => {
  if (r.error) throw Error(r.error.code || "operation_failed");
  return r.data;
};
const tenant = check(await db.from("tenants").select("slug").eq("id", m.tenant).single());
if (tenant.slug !== m.slug) throw Error("Wrong tenant");
const paid = m.invoices.filter((i) => i.status === "paid").reduce((n, i) => n + i.amount_pence, 0);
if (paid !== m.expected_paid_pence) throw Error("Payment mismatch");
for (const item of m.invoices) {
  const { file, ...record } = item;
  const bytes = readFileSync(file);
  if (bytes.subarray(0, 5).toString() !== "%PDF-") throw Error("Not PDF");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const path = `${m.tenant}/${record.reference}-${sha256.slice(0, 16)}.pdf`;
  const old = check(
    await db
      .from("client_invoices")
      .select("sha256")
      .eq("tenant_id", m.tenant)
      .eq("reference", record.reference)
      .maybeSingle(),
  );
  if (old) {
    if (old.sha256 !== sha256) throw Error("Existing invoice differs; explicit revision required");
    continue;
  }
  const upload = await db.storage
    .from("client-invoices")
    .upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (upload.error) {
    const prior = await db.storage.from("client-invoices").download(path);
    if (
      prior.error ||
      createHash("sha256")
        .update(Buffer.from(await prior.data.arrayBuffer()))
        .digest("hex") !== sha256
    )
      throw Error("Upload failed");
  }
  check(
    await db
      .from("client_invoices")
      .insert({ ...record, tenant_id: m.tenant, storage_path: path, sha256 }),
  );
  console.log(`Published ${record.reference}`);
}
check(
  await db
    .from("client_delivery_updates")
    .upsert({ tenant_id: m.tenant, content: m.delivery, verified_at: new Date().toISOString() }),
);
const rows = check(
  await db.from("client_invoices").select("status,amount_pence").eq("tenant_id", m.tenant),
);
console.log(
  JSON.stringify({
    count: rows.length,
    paid_pence: rows
      .filter((r) => r.status === "paid")
      .reduce((n, r) => n + Number(r.amount_pence), 0),
    outstanding_pence: rows
      .filter((r) => r.status === "outstanding")
      .reduce((n, r) => n + Number(r.amount_pence), 0),
    invitations_sent: 0,
  }),
);
