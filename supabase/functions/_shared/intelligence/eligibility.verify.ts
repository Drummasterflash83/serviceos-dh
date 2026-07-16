// Unit tests for the PURE intelligence eligibility decision. No DB/network.
// Run: node supabase/functions/_shared/intelligence/eligibility.verify.ts

import { shouldCreateIntelligence, type EligibilityInput } from "./eligibility.ts";

let failures = 0;
function check(name, cond, detail) {
  if (!cond) failures++;
  console.log(
    `  [${cond ? "PASS" : "FAIL"}] ${name}${!cond ? ` — got ${JSON.stringify(detail)}` : ""}`,
  );
}

function base(over: Partial<EligibilityInput>): EligibilityInput {
  return {
    direction: "inbound",
    interaction_type: "email_message",
    subject: null,
    summary: null,
    body_preview: null,
    sentiment: null,
    priority: null,
    from_address: "ann@acme.co.uk",
    related_person_id: "person-1",
    related_company_id: null,
    ...over,
  };
}

console.log("Eligible — real business events:");
check(
  "customer complaint is eligible (customer_risk)",
  (() => {
    const d = shouldCreateIntelligence(
      base({ subject: "Boiler broken again", sentiment: "negative" }),
    );
    return d.eligible && d.reason === "customer_risk" && d.confidence >= 0.85;
  })(),
);
check(
  "sales opportunity is eligible",
  (() => {
    const d = shouldCreateIntelligence(base({ subject: "Can we quote for a new system?" }));
    return d.eligible && d.reason === "sales_opportunity";
  })(),
);
check(
  "supplier delay is eligible (supplier_risk)",
  (() => {
    const d = shouldCreateIntelligence(
      base({ summary: "Delivery delayed by 7 days, parts on backorder" }),
    );
    return d.eligible && d.reason === "supplier_risk";
  })(),
);
check(
  "known customer, substantive, no keyword → eligible (customer_context, lower confidence)",
  (() => {
    const d = shouldCreateIntelligence(
      base({ subject: "Following up on our conversation yesterday" }),
    );
    return d.eligible && d.reason === "customer_context" && d.confidence < 0.8;
  })(),
);

console.log("Ineligible — noise:");
check(
  '"Thanks" is ignored (low_value)',
  (() => {
    const d = shouldCreateIntelligence(base({ subject: "Thanks" }));
    return !d.eligible && d.reason === "low_value";
  })(),
);
check(
  "newsletter is ignored (marketing)",
  (() => {
    const d = shouldCreateIntelligence(
      base({ subject: "Our March newsletter", body_preview: "click unsubscribe to opt out" }),
    );
    return !d.eligible && d.reason === "marketing";
  })(),
);
check(
  "automated notification is ignored",
  (() => {
    const d = shouldCreateIntelligence(
      base({ subject: "Delivery status update", from_address: "no-reply@shipping.com" }),
    );
    return !d.eligible && d.reason === "automated_notification";
  })(),
);
check(
  "empty content is ignored",
  (() => {
    const d = shouldCreateIntelligence(base({ subject: null, summary: null, body_preview: null }));
    return !d.eligible && d.reason === "empty";
  })(),
);
check(
  "risk language beats an automated-looking address only when not a no-reply",
  (() => {
    // A real complaint from a real address stays eligible.
    const d = shouldCreateIntelligence(base({ subject: "This is urgent, my heating has failed" }));
    return d.eligible && d.reason === "customer_risk";
  })(),
);

console.log("Determinism + explainability:");
check(
  "deterministic — same input, same verdict",
  JSON.stringify(shouldCreateIntelligence(base({ subject: "Boiler broken again" }))) ===
    JSON.stringify(shouldCreateIntelligence(base({ subject: "Boiler broken again" }))),
);
check(
  "carries signals for explainability",
  shouldCreateIntelligence(base({ subject: "complaint", sentiment: "negative" })).signals.length >=
    1,
);

console.log(failures === 0 ? "\nALL ELIGIBILITY CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
