// Unit tests for the PURE response-proposal + human-refinement model. No DB/network.
// Run: node supabase/functions/_shared/response_proposal.verify.ts

import {
  RESPONSE_PROPOSAL_VERSION,
  buildResponseProposal,
  buildResponseRevision,
  canApprove,
  canRevise,
  resolveEffectiveResponse,
} from "./response_proposal.ts";

let failures = 0;
function check(name, cond, detail) {
  if (!cond) failures++;
  console.log(
    `  [${cond ? "PASS" : "FAIL"}] ${name}${!cond ? ` — got ${JSON.stringify(detail)}` : ""}`,
  );
}

const PROVENANCE = [
  { kind: "customer_card", ref: "card-1", note: "customer identity + status" },
  { kind: "interaction", ref: "int-current", note: "current inbound message" },
];

console.log("Immutable original proposal:");
const built = buildResponseProposal({
  channel: "email",
  sourceInteraction: "int-current",
  body: "Hi Ann Example,\n\nThank you for your message.",
  provenance: PROVENANCE,
  draftVersion: "response-draft/1",
  generatedBy: "response-assistant",
  generatedAt: "2026-07-27T09:00:00Z",
});
check("a valid draft builds a proposal", built.ok === true);
const proposal = built.ok ? built.proposal : null;
check("proposal carries the original body", proposal?.original_body.includes("Hi Ann Example,"));
check("proposal is versioned", proposal?.proposal_version === RESPONSE_PROPOSAL_VERSION);
check(
  "proposal records generated_at + draft version",
  proposal?.generated_at === "2026-07-27T09:00:00Z" &&
    proposal?.draft_version === "response-draft/1",
);
check("proposal preserves provenance links", proposal?.provenance.length === 2);
check(
  "an empty body is refused (no unaddressed proposal)",
  buildResponseProposal({
    sourceInteraction: "int-current",
    body: "   ",
    draftVersion: "response-draft/1",
    generatedAt: "2026-07-27T09:00:00Z",
  }).ok === false,
);
check(
  "a missing source interaction is refused",
  buildResponseProposal({
    sourceInteraction: null,
    body: "hello",
    draftVersion: "response-draft/1",
    generatedAt: "2026-07-27T09:00:00Z",
  }).ok === false,
);

console.log("Human refinement (append-only edit):");
const rev = buildResponseRevision({
  revisionNumber: 1,
  body: "Hi Ann,\n\nThanks so much — I've booked you in for Thursday.",
  editorRef: "ops@drummonds.co.uk",
  changeReason: "personalised + gave a concrete date",
  basedOn: "ai_proposal",
  basedOnRef: null,
  createdAt: "2026-07-27T09:05:00Z",
});
check("a valid edit builds a revision", rev.ok === true);
check(
  "revision records editor identity",
  rev.ok && rev.revision.editor_ref === "ops@drummonds.co.uk",
);
check(
  "revision records change reason",
  rev.ok && rev.revision.change_reason === "personalised + gave a concrete date",
);
check(
  "revision records lineage (based on the AI proposal)",
  rev.ok && rev.revision.based_on === "ai_proposal",
);
check(
  "an empty edit is refused (cannot approve an empty reply)",
  buildResponseRevision({
    revisionNumber: 1,
    body: "  ",
    editorRef: "ops@drummonds.co.uk",
    basedOn: "ai_proposal",
    basedOnRef: null,
    createdAt: "2026-07-27T09:05:00Z",
  }).ok === false,
);
check(
  "an edit with no editor identity is refused (every change is attributable)",
  buildResponseRevision({
    revisionNumber: 1,
    body: "edited",
    editorRef: "",
    basedOn: "ai_proposal",
    basedOnRef: null,
    createdAt: "2026-07-27T09:05:00Z",
  }).ok === false,
);

console.log("Effective response = the reviewed version approval executes:");
const noEdits = resolveEffectiveResponse({ proposal, revisions: [] });
check(
  "with no edits, the effective body is the original AI draft",
  noEdits.source === "ai_proposal" && noEdits.body === proposal.original_body,
);
check(
  "with no edits, provenance is exactly the original",
  noEdits.edited === false && noEdits.provenance.length === 2,
);

const editedRev = {
  id: "rev-uuid-1",
  revision_number: 1,
  revised_body: rev.ok ? rev.revision.revised_body : "",
  editor_ref: "ops@drummonds.co.uk",
  change_reason: "personalised",
};
const edited = resolveEffectiveResponse({ proposal, revisions: [editedRev] });
check(
  "with an edit, the effective body is the HUMAN revision",
  edited.source === "revision" && edited.body.includes("booked you in for Thursday"),
);
check(
  "the original AI draft is UNTOUCHED (immutable)",
  proposal.original_body.includes("Thank you for your message.") &&
    !proposal.original_body.includes("Thursday"),
);
check(
  "effective provenance PRESERVES the original + adds a human_revision marker",
  edited.provenance.length === 3 && edited.provenance.some((p) => p.kind === "human_revision"),
);
check(
  "the human_revision marker names the editor",
  edited.provenance.some(
    (p) => p.kind === "human_revision" && p.note.includes("ops@drummonds.co.uk"),
  ),
);

const r2 = {
  id: "rev-uuid-2",
  revision_number: 2,
  revised_body: "Second, better edit.",
  editor_ref: "owner@drummonds.co.uk",
  change_reason: null,
};
const latest = resolveEffectiveResponse({ proposal, revisions: [editedRev, r2] });
check(
  "the LATEST revision wins (highest revision_number)",
  latest.body === "Second, better edit." && latest.revision_number === 2,
);
check(
  "resolution is order-independent (sorts by revision_number)",
  resolveEffectiveResponse({ proposal, revisions: [r2, editedRev] }).body ===
    "Second, better edit.",
);

console.log("Lifecycle gates (the lock, decided from facts):");
check(
  "revise is allowed while pending + unapproved with a proposal",
  canRevise({ hasProposal: true, intentStatus: "pending", hasApprovalSnapshot: false }).ok === true,
);
check(
  "revise is REJECTED once approved — even though the intent is still pending",
  (() => {
    const g = canRevise({ hasProposal: true, intentStatus: "pending", hasApprovalSnapshot: true });
    return !g.ok && g.code === "already_approved" && g.httpStatus === 409;
  })(),
);
check(
  "revise is rejected once the intent has left pending (executing/…)",
  (() => {
    const g = canRevise({
      hasProposal: true,
      intentStatus: "executing",
      hasApprovalSnapshot: false,
    });
    return !g.ok && g.code === "not_pending";
  })(),
);
check(
  "revise is rejected when there is no proposal to refine",
  (() => {
    const g = canRevise({
      hasProposal: false,
      intentStatus: "pending",
      hasApprovalSnapshot: false,
    });
    return !g.ok && g.code === "no_proposal";
  })(),
);
check(
  "approve is allowed once, while pending + not yet approved",
  canApprove({ intentStatus: "pending", hasApprovalSnapshot: false }).ok === true,
);
check(
  "a DUPLICATE approval is rejected (snapshot already exists, still pending)",
  (() => {
    const g = canApprove({ intentStatus: "pending", hasApprovalSnapshot: true });
    return !g.ok && g.code === "already_approved" && g.httpStatus === 409;
  })(),
);

console.log(
  failures === 0 ? "\nALL RESPONSE-PROPOSAL UNIT CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
