/**
 * Segment-builder state model — PURE functions over the validated AST.
 *
 * The builder's state IS the SegmentNode tree (deep-cloned on open, sent back
 * verbatim on save), so a nested AND/OR/NOT definition round-trips WITHOUT
 * LOSS by construction: opening and saving an untouched definition yields a
 * deep-equal tree, and edits replace exactly one addressed node while every
 * other branch is preserved. Definitions the builder cannot faithfully
 * represent (unknown shapes) are detected by `canEditNode` and shown
 * read-only — never flattened, discarded or rewritten.
 */

import type { SegmentNode } from "./segments";

/** A path addresses one node: each step is a child index ('not' has one child
 *  at index 0). The empty path is the root. */
export type NodePath = number[];

export const GROUP_MAX_CHILDREN = 10;
export const MAX_DEPTH = 4;

export function cloneNode<T extends SegmentNode>(node: T): T {
  return JSON.parse(JSON.stringify(node)) as T;
}

const isStr = (v: unknown): v is string => typeof v === "string";
const oneOf = (v: unknown, values: readonly string[]) => isStr(v) && values.includes(v);
const onlyKeys = (n: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(n).every((k) => allowed.includes(k));

const REL_TYPES = [
  "lead",
  "prospect",
  "customer",
  "former_customer",
  "supplier",
  "partner",
  "commercial",
  "other",
] as const;
const REL_STATUSES = ["active", "inactive", "archived"] as const;
const REL_SOURCES = ["discovery", "import", "manual", "ad_lead", "system"] as const;
const ELIGIBILITIES = [
  "subscribed",
  "unsubscribed",
  "suppressed",
  "unknown",
  "invalid",
  "no_contact_point",
] as const;

/** EXACT editable-leaf shape validation — recognising a known `field` string
 *  is NOT sufficient. A malformed known-field node (e.g. a tag leaf without
 *  `tag_ids`, a string where a boolean belongs, an unknown nested key) must
 *  render read-only and must never crash the editors. */
function canEditLeaf(n: Record<string, unknown>): boolean {
  switch (n.field) {
    case "search":
      return onlyKeys(n, ["field", "value"]) && isStr(n.value) && n.value.length <= 120;
    case "relationship": {
      if (!onlyKeys(n, ["field", "match"])) return false;
      const m = n.match;
      if (typeof m !== "object" || m === null || Array.isArray(m)) return false;
      const match = m as Record<string, unknown>;
      if (!onlyKeys(match, ["lifecycle", "type", "status", "source", "owner_id"])) return false;
      if (match.lifecycle !== undefined && !isStr(match.lifecycle)) return false;
      if (match.type !== undefined && !oneOf(match.type, REL_TYPES)) return false;
      if (match.status !== undefined && !oneOf(match.status, REL_STATUSES)) return false;
      if (match.source !== undefined && !oneOf(match.source, REL_SOURCES)) return false;
      if (match.owner_id !== undefined && !isStr(match.owner_id)) return false;
      return true;
    }
    case "company":
      return onlyKeys(n, ["field", "value"]) && (n.value === null || isStr(n.value));
    case "created":
      return (
        onlyKeys(n, ["field", "from", "to"]) &&
        (n.from !== undefined || n.to !== undefined) &&
        (n.from === undefined || isStr(n.from)) &&
        (n.to === undefined || isStr(n.to))
      );
    case "last_contact": {
      if (!onlyKeys(n, ["field", "from", "to", "never"])) return false;
      if (n.never !== undefined && typeof n.never !== "boolean") return false;
      if (n.never === true) return n.from === undefined && n.to === undefined;
      if (n.from === undefined && n.to === undefined) return false;
      return (n.from === undefined || isStr(n.from)) && (n.to === undefined || isStr(n.to));
    }
    case "tag":
      return (
        onlyKeys(n, ["field", "mode", "tag_ids"]) &&
        oneOf(n.mode, ["any", "all", "none"]) &&
        Array.isArray(n.tag_ids) &&
        n.tag_ids.length >= 1 &&
        n.tag_ids.length <= 20 &&
        n.tag_ids.every(isStr)
      );
    case "eligibility":
      return (
        onlyKeys(n, ["field", "channel", "value"]) &&
        oneOf(n.channel, ["email", "phone"]) &&
        oneOf(n.value, ELIGIBILITIES)
      );
    default:
      return false;
  }
}

/** Can the structured builder faithfully represent this node (and children)? */
export function canEditNode(node: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH) return false;
  if (typeof node !== "object" || node === null || Array.isArray(node)) return false;
  const n = node as Record<string, unknown>;
  if ("op" in n && "field" in n) return false;
  if (n.op === "and" || n.op === "or") {
    return (
      onlyKeys(n, ["op", "children"]) &&
      Array.isArray(n.children) &&
      n.children.length >= 1 &&
      n.children.length <= GROUP_MAX_CHILDREN &&
      n.children.every((c) => canEditNode(c, depth + 1))
    );
  }
  if (n.op === "not") {
    return onlyKeys(n, ["op", "child"]) && n.child !== undefined && canEditNode(n.child, depth + 1);
  }
  if (typeof n.field === "string") return canEditLeaf(n);
  return false;
}

function childrenOf(node: SegmentNode): SegmentNode[] | null {
  if ("op" in node) {
    if (node.op === "not") return [node.child];
    return node.children;
  }
  return null;
}

export function getAt(root: SegmentNode, path: NodePath): SegmentNode | null {
  let cur: SegmentNode = root;
  for (const idx of path) {
    const kids = childrenOf(cur);
    if (!kids || idx < 0 || idx >= kids.length) return null;
    cur = kids[idx];
  }
  return cur;
}

/** Replace the node at `path` (immutably — untouched branches are preserved by
 *  reference-equality of their clones' content, proven in tests). */
export function replaceAt(root: SegmentNode, path: NodePath, next: SegmentNode): SegmentNode {
  if (path.length === 0) return next;
  const [head, ...rest] = path;
  if ("op" in root) {
    if (root.op === "not") {
      if (head !== 0) return root;
      return { op: "not", child: replaceAt(root.child, rest, next) };
    }
    return {
      op: root.op,
      children: root.children.map((c, i) => (i === head ? replaceAt(c, rest, next) : c)),
    };
  }
  return root;
}

/** Remove the node at `path`. Removing a group's last child removes the group;
 *  removing a not's child removes the not. Returns null when the whole tree
 *  is removed. */
export function removeAt(root: SegmentNode, path: NodePath): SegmentNode | null {
  if (path.length === 0) return null;
  const [head, ...rest] = path;
  if (!("op" in root)) return root;
  if (root.op === "not") {
    if (head !== 0) return root;
    const child = rest.length === 0 ? null : removeAt(root.child, rest);
    return child === null ? null : { op: "not", child };
  }
  if (rest.length === 0) {
    const children = root.children.filter((_, i) => i !== head);
    if (children.length === 0) return null;
    if (children.length === 1) return children[0];
    return { op: root.op, children };
  }
  const children = root.children
    .map((c, i) => (i === head ? removeAt(c, rest) : c))
    .filter((c): c is SegmentNode => c !== null);
  if (children.length === 0) return null;
  return { op: root.op, children };
}

/** Append a child to the group at `path` (bounded). Non-group targets are
 *  wrapped into an AND group with the new node. */
export function addChildAt(root: SegmentNode, path: NodePath, child: SegmentNode): SegmentNode {
  const target = getAt(root, path);
  if (!target) return root;
  if ("op" in target && (target.op === "and" || target.op === "or")) {
    if (target.children.length >= GROUP_MAX_CHILDREN) return root;
    return replaceAt(root, path, { op: target.op, children: [...target.children, child] });
  }
  return replaceAt(root, path, { op: "and", children: [target, child] });
}

/** Toggle a group's operator between and/or. */
export function setGroupOp(root: SegmentNode, path: NodePath, op: "and" | "or"): SegmentNode {
  const target = getAt(root, path);
  if (!target || !("op" in target) || (target.op !== "and" && target.op !== "or")) return root;
  return replaceAt(root, path, { op, children: target.children });
}

/** Wrap the node at `path` in NOT, or unwrap it if it already is one. */
export function toggleNotAt(root: SegmentNode, path: NodePath): SegmentNode {
  const target = getAt(root, path);
  if (!target) return root;
  if ("op" in target && target.op === "not") return replaceAt(root, path, target.child);
  return replaceAt(root, path, { op: "not", child: target });
}

export function nodeDepth(node: SegmentNode): number {
  const kids = childrenOf(node);
  if (!kids) return 0;
  return 1 + Math.max(...kids.map(nodeDepth));
}

export function nodeCount(node: SegmentNode): number {
  const kids = childrenOf(node);
  if (!kids) return 1;
  return 1 + kids.reduce((n, c) => n + nodeCount(c), 0);
}
