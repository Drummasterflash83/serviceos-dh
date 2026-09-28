// Deliberately a same-file, line-based heuristic, not a SQL parser. Unqualified
// relations are treated as public (the migrations' default relation namespace).
// Explicit non-public schemas remain distinct; no search_path inference is made.
const IDENT = "[a-z_][a-z0-9_]*";
const RELATION = `${IDENT}(?:\\s*\\.\\s*${IDENT})?`;
const RELATION_END = "(?![a-z0-9_]|\\s*\\.)";
const relationKey = (name) => {
  const parts = name.toLowerCase().split(/\s*\.\s*/);
  return parts.length === 1 ? `public.${parts[0]}` : parts.join(".");
};

export function migrationForwardReferences(source) {
  const lines = source.split("\n");
  const created = new Map();
  lines.forEach((line, index) => {
    for (const match of line.matchAll(
      new RegExp(
        `create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(${RELATION})${RELATION_END}`,
        "gi",
      ),
    )) {
      const name = relationKey(match[1]);
      if (!created.has(name)) created.set(name, index + 1);
    }
  });

  const refs = [];
  let inArray = false;
  lines.forEach((sourceLine, index) => {
    const line = index + 1;
    const push = (re, kind) => {
      for (const match of sourceLine.matchAll(re))
        refs.push({ name: relationKey(match[1]), line, kind });
    };
    push(new RegExp(`references\\s+(${RELATION})\\s*\\(`, "gi"), "fk");
    push(new RegExp(`insert\\s+into\\s+(${RELATION})${RELATION_END}`, "gi"), "insert");
    push(
      new RegExp(`alter\\s+table\\s+(?:if\\s+exists\\s+)?(${RELATION})${RELATION_END}`, "gi"),
      "alter",
    );
    push(new RegExp(`\\bon\\s+(${RELATION})${RELATION_END}`, "gi"), "on");

    // Preserve the existing dynamic DDL-array heuristic. Ordinary seed literals
    // outside an array are not treated as relation references.
    if (/array\s*\[/i.test(sourceLine)) inArray = true;
    if (inArray) push(new RegExp(`'(${RELATION})'`, "gi"), "array");
    if (inArray && /\]/.test(sourceLine)) inArray = false;
  });

  return refs.flatMap((reference) => {
    const createdLine = created.get(reference.name);
    return createdLine !== undefined && createdLine > reference.line
      ? [{ ...reference, createdLine }]
      : [];
  });
}
