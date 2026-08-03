// ServiceOS — Marketing CRM STAGING SHOWCASE seed.
//
// Populates ONE tenant with clearly-labelled, obviously-synthetic demo data so
// the Marketing CRM can be reviewed visually. It is:
//   * IDEMPOTENT — every object is keyed and converges on re-run;
//   * STAGING-GATED — it refuses to run against any project other than the
//     staging ref, and refuses a tenant that is not the declared showcase
//     tenant. It is structurally incapable of running in production;
//   * NON-SENDING — it creates DRAFT campaigns/sequences only. Nothing is
//     launched, enrolled, sent or dispatched, no AI provider is called and no
//     external provider is connected;
//   * SAFE-RECIPIENT — every contact address is on `example.com`. The only real
//     address this codebase may contact is the operator's own test-to-self.
//
// Run:
//   STAGING_SUPABASE_URL=… STAGING_SERVICE_ROLE_KEY=… \
//     node scripts/seed/marketing-staging-showcase.mjs

import { createClient } from "@supabase/supabase-js";

// ── HARD GATES ─────────────────────────────────────────────────────────────
const STAGING_REF = "eityajdtzvdbdqtoipia";
const SHOWCASE_TENANT = "cd56432a-9594-4e7b-9c06-f7e0f1ea6e0a";
const ACTOR = "66c13177-cfd4-4616-a6cb-54e0d1bf8d38";

const URL = process.env.STAGING_SUPABASE_URL ?? "";
const SR = process.env.STAGING_SERVICE_ROLE_KEY ?? "";
if (!URL.includes(STAGING_REF)) {
  console.error(`REFUSED: this seed only runs against the staging project ${STAGING_REF}.`);
  console.error(`         STAGING_SUPABASE_URL was ${URL || "(unset)"}.`);
  process.exit(2);
}
if (!SR) {
  console.error("REFUSED: STAGING_SERVICE_ROLE_KEY is required.");
  process.exit(2);
}
const db = createClient(URL, SR, { auth: { persistSession: false } });

let created = 0;
let converged = 0;
const step = (label, r) => {
  if (r === "created") created++;
  if (r === "converged") converged++;
  console.log(`  ${r === "created" ? "+" : "="} ${label}`);
};
const fail = (label, e) => {
  console.error(`  ! ${label}: ${e?.message ?? e}`);
  process.exitCode = 1;
};

/** Deterministic uuid from a label, so re-runs converge without a registry. */
async function idFor(label) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`showcase:${label}`));
  const h = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const CONTACTS = [
  [
    "Margaret Whitfield",
    "margaret.whitfield@example.com",
    "+441902100201",
    "Boiler service due Sept — long-standing customer, prefers morning visits.",
  ],
  [
    "Alan Pryce",
    "alan.pryce@example.com",
    "+441902100202",
    "New combi installed Feb. Warranty registration complete.",
  ],
  [
    "Priya Raman",
    "priya.raman@example.com",
    "+441902100203",
    "Landlord — four managed properties, annual gas safety certificates.",
  ],
  [
    "Tom Beresford",
    "tom.beresford@example.com",
    "+441902100204",
    "Quoted for a full system upgrade, decision expected this quarter.",
  ],
  [
    "Nadia Okonkwo",
    "nadia.okonkwo@example.com",
    "+441902100205",
    "Repeat customer. Asked about smart thermostat options.",
  ],
  [
    "Gerald Simms",
    "gerald.simms@example.com",
    "+441902100206",
    "Elderly customer — priority response, daughter is the contact.",
  ],
  [
    "Hollie Fenwick",
    "hollie.fenwick@example.com",
    "+441902100207",
    "New build handover, first annual service due.",
  ],
  [
    "Rashid Malik",
    "rashid.malik@example.com",
    "+441902100208",
    "Commercial — small office block, quarterly maintenance.",
  ],
  [
    "Ellen Cartwright",
    "ellen.cartwright@example.com",
    "+441902100209",
    "Radiator upgrade enquiry from the website.",
  ],
  [
    "Douglas Reid",
    "douglas.reid@example.com",
    "+441902100210",
    "Lapsed customer — last service 2024, worth re-engaging.",
  ],
  [
    "Sofia Marchetti",
    "sofia.marchetti@example.com",
    "+441902100211",
    "Referred by Margaret Whitfield. Boiler replacement quoted.",
  ],
  [
    "Kwame Boateng",
    "kwame.boateng@example.com",
    "+441902100212",
    "Power flush completed. Very satisfied — good review candidate.",
  ],
];

const TAGS = [
  ["showcase-service-plan", "Service plan"],
  ["showcase-landlord", "Landlord"],
  ["showcase-lapsed", "Lapsed"],
  ["showcase-commercial", "Commercial"],
];

async function main() {
  console.log(`Marketing staging showcase → ${STAGING_REF} / tenant ${SHOWCASE_TENANT}\n`);

  const t = await db.from("tenants").select("id,slug").eq("id", SHOWCASE_TENANT).maybeSingle();
  if (!t.data) {
    console.error("REFUSED: the declared showcase tenant does not exist on this project.");
    process.exit(2);
  }
  console.log(`tenant: ${t.data.slug}\n`);

  // ── contacts (governed RPC, idempotency-keyed) ───────────────────────────
  console.log("Contacts");
  const personIds = [];
  for (const [name, email, phone, note] of CONTACTS) {
    const key = await idFor(`contact:${email}`);
    const r = await db.rpc("marketing_create_contact", {
      p_tenant: SHOWCASE_TENANT,
      p_actor: ACTOR,
      p_details: {
        display_name: name,
        first_name: name.split(" ")[0],
        last_name: name.split(" ").slice(1).join(" "),
        email,
        phone,
        source: "manual",
        notes: note,
      },
      p_idempotency_key: key,
    });
    if (r.error) {
      fail(`contact ${email}`, r.error);
      continue;
    }
    const pid = r.data?.person_id ?? r.data?.id ?? r.data;
    if (pid) personIds.push(typeof pid === "string" ? pid : null);
    step(`contact ${name}`, r.data?.created === false ? "converged" : "created");
  }

  // ── tags (governed mutate; converge on duplicate) ────────────────────────
  console.log("\nTags");
  for (const [, label] of TAGS) {
    const r = await db.rpc("marketing_tag_mutate", {
      p_tenant: SHOWCASE_TENANT,
      p_actor: ACTOR,
      p_op: "create",
      p_args: { label, tone: "info" },
    });
    step(`tag ${label}`, r.error ? "converged" : "created");
  }

  // ── segments (governed mutate) ───────────────────────────────────────────
  console.log("\nSegments");
  const SEGMENTS = [
    {
      name: "Showcase — Service plan customers",
      description: "Customers on a recurring service plan (showcase data).",
      definition: {
        op: "and",
        children: [{ field: "relationship", match: { lifecycle: "won", status: "active" } }],
      },
    },
    {
      name: "Showcase — Lapsed since 2024",
      description: "No service recorded since 2024 — re-engagement candidates (showcase data).",
      definition: {
        op: "and",
        children: [
          { field: "relationship", match: { lifecycle: "nurture" } },
          { field: "last_contact", never: true },
        ],
      },
    },
  ];
  const existingSegs = await db
    .from("marketing_segments")
    .select("name")
    .eq("tenant_id", SHOWCASE_TENANT);
  const segNames = new Set((existingSegs.data ?? []).map((s) => s.name));
  for (const s of SEGMENTS) {
    if (segNames.has(s.name)) {
      step(`segment ${s.name}`, "converged");
      continue;
    }
    const r = await db.rpc("marketing_segment_mutate", {
      p_tenant: SHOWCASE_TENANT,
      p_actor: ACTOR,
      p_op: "create",
      p_args: s,
    });
    r.error ? fail(`segment ${s.name}`, r.error) : step(`segment ${s.name}`, "created");
  }

  // ── templates (governed RPC, request-idempotent) ─────────────────────────
  console.log("\nTemplates");
  const TEMPLATES = [
    {
      name: "Showcase — Annual service reminder",
      description: "Friendly reminder that an annual boiler service is due.",
      subject: "Your annual boiler service is due, {{first_name}}",
      preview_text: "A quick reminder from the team at Drummonds",
      body_authored:
        "Hello {{first_name}},\n\nYour annual boiler service is coming up. Keeping it serviced protects your warranty and keeps everything running safely and efficiently through the winter.\n\nReply to this email or call us on 01902 000000 and we will find a time that suits you.\n\nBest wishes,\nThe team at Drummonds",
    },
    {
      name: "Showcase — Landlord gas safety certificate",
      description: "Annual CP12 reminder for landlords with managed properties.",
      subject: "Gas safety certificates due for your properties",
      preview_text: "Stay compliant — book your CP12 checks",
      body_authored:
        "Hello {{first_name}},\n\nYour annual gas safety checks are due. We can complete all of your managed properties in a single visit window and send the CP12 certificates straight through to you.\n\nJust reply with the dates that work and we will arrange access with your tenants.\n\nBest wishes,\nThe team at Drummonds",
    },
    {
      name: "Showcase — Winter readiness check",
      description: "Seasonal prompt ahead of the heating season.",
      subject: "Is your heating ready for winter?",
      preview_text: "A short check now saves a cold week later",
      body_authored:
        "Hello {{first_name}},\n\nCold snaps are when breakdowns happen. A winter readiness check covers pressure, flow, radiator balance and a full safety inspection.\n\nReply to book, and we will confirm within one working day.\n\nBest wishes,\nThe team at Drummonds",
    },
  ];
  const templateIds = {};
  for (const tpl of TEMPLATES) {
    const r = await db.rpc("marketing_template_create", {
      p_tenant: SHOWCASE_TENANT,
      p_actor: ACTOR,
      p_args: { ...tpl, request_id: `showcase-tpl-${tpl.name.length}-${tpl.subject.length}` },
    });
    if (r.error) {
      fail(`template ${tpl.name}`, r.error);
      continue;
    }
    templateIds[tpl.name] = r.data?.id ?? r.data?.template_id;
    step(`template ${tpl.name}`, r.data?.created === false ? "converged" : "created");
  }

  // ── ONE DRAFT campaign — never launched ──────────────────────────────────
  console.log("\nBroadcast (DRAFT — never launched)");
  // the production-verified sender (or, failing that, whatever is ready)
  const senders = await db
    .from("marketing_sender_profiles")
    .select("id,mailbox_address")
    .eq("tenant_id", SHOWCASE_TENANT);
  const prodSender =
    (senders.data ?? []).find((s) => s.mailbox_address === "hello@drummonds.co") ??
    (senders.data ?? [])[0];
  const segRows = await db
    .from("marketing_segments")
    .select("id,name")
    .eq("tenant_id", SHOWCASE_TENANT);
  const showcaseSeg =
    (segRows.data ?? []).find((s) => s.name.startsWith("Showcase — Service plan")) ??
    (segRows.data ?? [])[0];
  const existingCamp = await db
    .from("marketing_campaigns")
    .select("id,name,status")
    .eq("tenant_id", SHOWCASE_TENANT);
  const campName = "Showcase — Autumn service reminder";
  if ((existingCamp.data ?? []).some((c) => c.name === campName)) {
    step(`campaign ${campName}`, "converged");
  } else {
    const r = await db.rpc("marketing_campaign_create", {
      p_tenant: SHOWCASE_TENANT,
      p_actor: ACTOR,
      p_args: {
        name: campName,
        description:
          "Draft only — showcase data. Reminds service-plan customers that their annual service is due.",
        sender_id: prodSender?.id,
        segment_id: showcaseSeg?.id,
        subject: "Your annual boiler service is due, {{first_name}}",
        preview_text: "A quick reminder from the team at Drummonds",
        body_authored:
          "Hello {{first_name}},\n\nYour annual boiler service is coming up. Keeping it serviced protects your warranty and keeps everything running safely and efficiently through the winter.\n\nReply to this email or call us on 01902 000000 and we will find a time that suits you.\n\nBest wishes,\nThe team at Drummonds",
      },
    });
    r.error ? fail(`campaign ${campName}`, r.error) : step(`campaign ${campName}`, "created");
  }

  // ── ONE DRAFT sequence — never enrolled ──────────────────────────────────
  console.log("\nSequence (DRAFT — never enrolled)");
  const existingSeq = await db
    .from("marketing_sequences")
    .select("id,name")
    .eq("tenant_id", SHOWCASE_TENANT);
  const seqName = "Showcase — New customer welcome";
  if ((existingSeq.data ?? []).some((s) => s.name === seqName)) {
    step(`sequence ${seqName}`, "converged");
  } else {
    const r = await db.rpc("marketing_sequence_create", {
      p_tenant: SHOWCASE_TENANT,
      p_actor: ACTOR,
      p_args: {
        name: seqName,
        description:
          "Draft only — showcase data. Three touches over the first month after an installation.",
        sender_id: prodSender?.id,
        steps: [
          {
            key: "welcome",
            type: "send_email",
            config: {
              subject: "Welcome to Drummonds, {{first_name}}",
              preview_text: "Everything you need after your installation",
              body_authored:
                "Hello {{first_name}},\n\nThank you for choosing Drummonds. Your paperwork and warranty registration are attached to your account, and your engineer has logged the installation.\n\nIf anything at all is not right, reply to this email and we will put it straight.\n\nBest wishes,\nThe team at Drummonds",
            },
          },
          { key: "wait_two_weeks", type: "wait_duration", config: { amount: 14, unit: "days" } },
          {
            key: "settling_in",
            type: "send_email",
            config: {
              subject: "How is the new system settling in?",
              preview_text: "A quick check two weeks on",
              body_authored:
                "Hello {{first_name}},\n\nIt has been a couple of weeks since your installation. Is everything heating as it should, and are the controls making sense?\n\nReply with anything you are unsure about and we will talk it through.\n\nBest wishes,\nThe team at Drummonds",
            },
          },
          { key: "wait_to_month", type: "wait_duration", config: { amount: 21, unit: "days" } },
          {
            key: "service_plan",
            type: "send_email",
            config: {
              subject: "Keeping your warranty valid",
              preview_text: "Annual servicing, handled for you",
              body_authored:
                "Hello {{first_name}},\n\nMost manufacturer warranties require an annual service. Our service plan spreads that across the year and we book it for you, so nothing lapses by accident.\n\nReply if you would like the details.\n\nBest wishes,\nThe team at Drummonds",
            },
          },
        ],
      },
    });
    r.error ? fail(`sequence ${seqName}`, r.error) : step(`sequence ${seqName}`, "created");
  }

  // ── inventory ────────────────────────────────────────────────────────────
  console.log("\nInventory (tenant-scoped)");
  for (const table of [
    "marketing_sender_profiles",
    "marketing_sender_authorities",
    "marketing_tags",
    "marketing_segments",
    "marketing_templates",
    "marketing_campaigns",
    "marketing_sequences",
    "marketing_deliveries",
  ]) {
    const r = await db
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", SHOWCASE_TENANT);
    console.log(`  ${table.padEnd(32)} ${r.count ?? "?"}`);
  }
  const people = await db
    .from("people")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", SHOWCASE_TENANT);
  console.log(`  ${"people".padEnd(32)} ${people.count ?? "?"}`);

  console.log(
    `\nDone — ${created} created, ${converged} already present. ` +
      "Nothing was launched, enrolled or sent.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
