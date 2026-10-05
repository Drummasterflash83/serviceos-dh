/**
 * Segment-builder round-trip proofs.
 * Run: node --test src/lib/marketing/segment-builder.test.ts
 *
 * The prohibited defect: opening a nested OR/NOT definition and saving it must
 * NEVER flatten, discard or rewrite conditions. The builder's state is the AST
 * itself, so these tests prove: (1) untouched nested definitions round-trip
 * deep-equal; (2) an edit replaces exactly the addressed node while every
 * sibling branch survives byte-identical; (3) unsupported shapes are detected
 * for the read-only fallback instead of being "repaired".
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  canEditNode,
  cloneNode,
  addChildAt,
  getAt,
  removeAt,
  replaceAt,
  setGroupOp,
  toggleNotAt,
  nodeCount,
  nodeDepth,
} from "./segment-builder.ts";
import type { SegmentNode } from "./segments.ts";

const NESTED: SegmentNode = {
  op: "and",
  children: [
    { field: "eligibility", channel: "email", value: "subscribed" },
    {
      op: "or",
      children: [
        { field: "relationship", match: { lifecycle: "engaged", status: "active" } },
        {
          op: "not",
          child: { field: "tag", mode: "any", tag_ids: ["11111111-1111-4111-8111-111111111111"] },
        },
      ],
    },
    { op: "not", child: { field: "last_contact", never: true } },
  ],
};

test("a nested AND(OR(NOT)) definition round-trips without loss", () => {
  const opened = cloneNode(NESTED);
  // "save without edits" = send the state back verbatim
  assert.deepEqual(opened, NESTED);
  assert.equal(nodeCount(opened), 8);
  assert.equal(nodeDepth(opened), 3);
});

test("editing one nested leaf preserves every other branch exactly", () => {
  const opened = cloneNode(NESTED);
  // edit the relationship leaf inside the OR group (path [1, 0])
  const edited = replaceAt(opened, [1, 0], {
    field: "relationship",
    match: { lifecycle: "qualified", status: "active" },
  });
  assert.deepEqual(getAt(edited, [1, 0]), {
    field: "relationship",
    match: { lifecycle: "qualified", status: "active" },
  });
  // untouched branches are still deep-equal to the original
  assert.deepEqual(getAt(edited, [0]), NESTED && getAt(NESTED, [0]));
  assert.deepEqual(getAt(edited, [1, 1]), getAt(NESTED, [1, 1]));
  assert.deepEqual(getAt(edited, [2]), getAt(NESTED, [2]));
});

test("adding to a nested OR group keeps its NOT child intact", () => {
  const opened = cloneNode(NESTED);
  const grown = addChildAt(opened, [1], { field: "search", value: "drummond" });
  const orGroup = getAt(grown, [1]);
  assert.ok(orGroup && "op" in orGroup && orGroup.op === "or");
  assert.equal((orGroup as { children: SegmentNode[] }).children.length, 3);
  assert.deepEqual(getAt(grown, [1, 1]), getAt(NESTED, [1, 1])); // NOT branch intact
});

test("removing a nested node never flattens the remaining structure", () => {
  const opened = cloneNode(NESTED);
  const removed = removeAt(opened, [1, 0]);
  assert.ok(removed);
  // OR group with a single remaining child collapses to that child — which is
  // the intact NOT(tag) branch, not a rewritten condition
  assert.deepEqual(getAt(removed as SegmentNode, [1]), getAt(NESTED, [1, 1]));
  assert.deepEqual(getAt(removed as SegmentNode, [0]), getAt(NESTED, [0]));
});

test("toggling NOT wraps and unwraps losslessly", () => {
  const opened = cloneNode(NESTED);
  const wrapped = toggleNotAt(opened, [0]);
  assert.deepEqual(getAt(wrapped, [0]), { op: "not", child: getAt(NESTED, [0]) });
  const unwrapped = toggleNotAt(wrapped, [0]);
  assert.deepEqual(unwrapped, NESTED);
});

test("switching a group operator preserves all children", () => {
  const opened = cloneNode(NESTED);
  const switched = setGroupOp(opened, [1], "and");
  const g = getAt(switched, [1]);
  assert.ok(g && "op" in g && g.op === "and");
  assert.deepEqual((g as { children: SegmentNode[] }).children, [
    getAt(NESTED, [1, 0]),
    getAt(NESTED, [1, 1]),
  ]);
});

test("supported nested grammar is editable; unknown shapes are read-only", () => {
  assert.equal(canEditNode(NESTED), true);
  // unsupported / unknown shapes must be detected — never "repaired"
  assert.equal(canEditNode({ field: "campaign_engagement", value: "opened" }), false);
  assert.equal(canEditNode({ op: "xor", children: [] }), false);
  assert.equal(canEditNode({ op: "and" }), false); // group without children
  assert.equal(
    canEditNode({ op: "and", field: "search", children: [], value: "x" }),
    false, // mixed group+leaf
  );
  assert.equal(canEditNode(null), false);
  assert.equal(canEditNode([{ field: "search", value: "x" }]), false);
});

test("depth guard: trees beyond the validated depth are not editable", () => {
  let deep: SegmentNode = { field: "search", value: "x" };
  for (let i = 0; i < 5; i++) deep = { op: "not", child: deep };
  assert.equal(canEditNode(deep), false);
});

test("MALFORMED known-field leaves render read-only (exact shape validation)", () => {
  // a known `field` string is NOT sufficient — these must all be rejected so
  // they can never crash LeafEditor
  const malformed: unknown[] = [
    { field: "tag", mode: "any" }, // tag node WITHOUT tag_ids
    { field: "tag", mode: "any", tag_ids: [] }, // empty tag array
    { field: "tag", mode: "sometimes", tag_ids: ["t1"] }, // bad enum
    { field: "tag", mode: "any", tag_ids: [1, 2] }, // wrong element types
    { field: "tag", mode: "any", tag_ids: ["t1"], sneaky: true }, // extra key
    { field: "search" }, // missing value
    { field: "search", value: 5 }, // wrong scalar type
    { field: "search", value: "x", extra: 1 }, // extra key
    { field: "relationship" }, // missing match
    { field: "relationship", match: [] }, // match not an object
    { field: "relationship", match: { sneaky: "x" } }, // unknown nested key
    { field: "relationship", match: { type: "nonsense" } }, // bad vocab
    { field: "relationship", match: { status: 5 } }, // wrong nested type
    { field: "company" }, // missing value
    { field: "company", value: 7 }, // wrong type
    { field: "created" }, // empty range
    { field: "created", from: 20260101 }, // wrong type
    { field: "created", from: "2026-01-01", until: "x" }, // unknown key
    { field: "last_contact" }, // neither never nor range
    { field: "last_contact", never: "true" }, // string where boolean belongs
    { field: "last_contact", never: true, from: "2026-01-01" }, // never + range
    { field: "eligibility", channel: "fax", value: "subscribed" }, // bad enum
    { field: "eligibility", channel: "email" }, // missing value
  ];
  for (const node of malformed) {
    assert.equal(canEditNode(node), false, `should be read-only: ${JSON.stringify(node)}`);
  }
});

test("well-formed variants of every leaf stay editable", () => {
  const wellFormed: SegmentNode[] = [
    { field: "search", value: "ada" },
    { field: "relationship", match: { lifecycle: "engaged", status: "active" } },
    { field: "relationship", match: { owner_id: "unassigned" } },
    { field: "company", value: null },
    { field: "company", value: "11111111-1111-4111-8111-111111111111" },
    { field: "created", from: "2026-01-01T00:00:00Z" },
    { field: "last_contact", never: true },
    { field: "last_contact", to: "2026-01-01T00:00:00Z" },
    { field: "tag", mode: "all", tag_ids: ["a", "b"] },
    { field: "eligibility", channel: "phone", value: "unknown" },
  ];
  for (const node of wellFormed) {
    assert.equal(canEditNode(node), true, `should be editable: ${JSON.stringify(node)}`);
  }
});
