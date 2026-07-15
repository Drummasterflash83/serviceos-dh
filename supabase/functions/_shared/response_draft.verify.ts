// Unit tests for the PURE response context + drafting modules. No DB/network.
// Run: node supabase/functions/_shared/response_draft.verify.ts

import { buildResponseContext } from "./response_context.ts";
import { RESPONSE_DRAFT_VERSION, draftResponse } from "./response_draft.ts";

let failures = 0;
function check(name, cond, detail) {
  if (!cond) failures++;
  console.log(
    `  [${cond ? "PASS" : "FAIL"}] ${name}${!cond ? ` — got ${JSON.stringify(detail)}` : ""}`,
  );
}

const current = {
  id: "int-current",
  subject: "Can you help with my boiler?",
  summary: "customer needs help",
  from_name: "Ann Example",
};
const card = {
  id: "card-1",
  title: "Ann Example",
  status: "active",
  priority: "high",
  summary: "Repeat customer",
  relationshipCount: 3,
};
const history = [
  {
    id: "int-1",
    subject: "Earlier question",
    occurred_at: "2026-07-10T10:00:00Z",
    direction: "inbound",
  },
  {
    id: "int-2",
    subject: "Even earlier",
    occurred_at: "2026-07-05T10:00:00Z",
    direction: "inbound",
  },
];

console.log("Response context assembly:");
const ctx = buildResponseContext({ current, card, history });
check("customer name resolves from the card", ctx.customerName === "Ann Example");
check(
  "repeat customer + history counted (current excluded)",
  ctx.isRepeatCustomer === true && ctx.historyCount === 2,
);
check("priority + status carried from card", ctx.priority === "high" && ctx.status === "active");
check(
  "provenance refs present (card + current + history)",
  !!ctx.refs.card && ctx.refs.current.ref === "int-current" && ctx.refs.history.length === 2,
);
check(
  "history excludes the current interaction + is bounded",
  (() => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      id: `h${i}`,
      subject: null,
      occurred_at: null,
      direction: "inbound",
    }));
    const c = buildResponseContext({ current, card, history: [...many, current] });
    return c.historyCount === 5 && !c.refs.history.some((r) => r.ref === "int-current");
  })(),
);
check(
  "name falls back to sender when no card",
  buildResponseContext({ current, card: null, history: [] }).customerName === "Ann Example",
);

console.log("Business-aware drafting:");
const drafted = draftResponse(ctx);
check("draft greets the customer by name", drafted.body.includes("Hi Ann Example,"));
check(
  "draft references the current message subject",
  drafted.body.includes('about "Can you help with my boiler?"'),
);
check(
  "draft acknowledges prior contact for a repeat customer",
  drafted.body.toLowerCase().includes("been in contact with us recently"),
);
check("draft reflects high priority from context", drafted.body.includes("high priority"));
check("draft is versioned", drafted.version === RESPONSE_DRAFT_VERSION);
check(
  "provenance lists exactly the context that informed the draft (card + current + 2 history)",
  drafted.provenance.some((p) => p.kind === "customer_card" && p.ref === "card-1") &&
    drafted.provenance.some((p) => p.kind === "interaction" && p.ref === "int-current") &&
    drafted.provenance.filter(
      (p) => p.kind === "interaction" && p.ref.startsWith("int-") && p.ref !== "int-current",
    ).length === 2,
);
check(
  "deterministic — same context, same draft",
  JSON.stringify(draftResponse(ctx)) ===
    JSON.stringify(draftResponse(buildResponseContext({ current, card, history }))),
);

console.log("Graceful degradation (no context):");
const bare = draftResponse(
  buildResponseContext({
    current: { id: "x", subject: null, summary: null, from_name: null },
    card: null,
    history: [],
  }),
);
check(
  "still a valid generic reply with no card/history/subject",
  bare.body.includes("Hi there,") && bare.body.includes("follow up with you shortly"),
);
check(
  "no repeat-customer or priority lines when context absent",
  !bare.body.toLowerCase().includes("recently") && !bare.body.includes("priority"),
);
check(
  "provenance still records the current interaction only",
  bare.provenance.length === 1 && bare.provenance[0].ref === "x",
);

console.log(
  failures === 0 ? "\nALL RESPONSE-DRAFT UNIT CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
