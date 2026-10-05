// The AI recommends; the operator approves. Publishing never generates fresh instructions.
export function releaseConfiguration(source: Record<string, unknown>) {
  // latestVersion is Vapi's generated version-history label, not assistant behaviour.
  const {
    id: _id,
    orgId: _org,
    createdAt: _created,
    updatedAt: _updated,
    latestVersion: _version,
    ...config
  } = source;
  return config;
}
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + stableJson(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export async function releaseHash(source: Record<string, unknown>) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(stableJson(releaseConfiguration(source))),
  );
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// Report field names and comparisons only: provider configurations can contain secrets.
export async function releaseDiagnosis(
  current: Record<string, unknown>,
  before: Record<string, unknown>,
  candidate: Record<string, unknown>,
  instruction: string,
) {
  const model = current.model as Record<string, unknown> | undefined;
  const messages = Array.isArray(model?.messages) ? model.messages : [];
  const target = releaseConfiguration(candidate),
    actual = releaseConfiguration(current);
  const changed = Object.keys({ ...target, ...actual }).filter(
    (k) => stableJson(target[k]) !== stableJson(actual[k]),
  );
  const fields = changed.map((k) =>
    /^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(k) ? k : "other configuration",
  );
  return {
    unchanged: (await releaseHash(current)) === (await releaseHash(before)),
    instructionPresent: messages.some(
      (m) =>
        m?.role === "system" && typeof m.content === "string" && m.content.includes(instruction),
    ),
    differingFields: fields,
  };
}
export function releaseCandidate(source: Record<string, unknown>, proposal: string, issue: string) {
  const model = source.model as Record<string, unknown> | undefined;
  if (
    !model ||
    model.provider !== "openai" ||
    !Array.isArray(model.messages) ||
    !model.messages.some((m) => m?.role === "system" && typeof m.content === "string") ||
    proposal.trim().length < 5 ||
    proposal.length > 20000
  )
    throw Error("unsupported_configuration");
  const instruction = `OPENFOLK APPROVED UPDATE (${issue}):\n${proposal.trim()}\nApply this approved change to the specific behaviour described above. All other instructions, consent requirements and safety rules remain in force.`;
  if (stableJson(model.messages).length + instruction.length > 140000)
    throw Error("configuration_too_large");
  return {
    candidate: {
      ...source,
      model: { ...model, messages: [...model.messages, { role: "system", content: instruction }] },
    },
    instruction,
  };
}
export type ReleaseTransport = {
  get: () => Promise<Record<string, unknown>>;
  patch: (body: { model: unknown }) => Promise<void>;
};
// Re-read immediately before PATCH; never retry a mutation after a network failure.
// Vapi does not document an atomic compare-and-swap, so an external concurrent edit
// remains a provider limitation. Local releases are serialised in the database.
export async function applyExactRelease(
  transport: ReleaseTransport,
  expectedHash: string,
  target: Record<string, unknown>,
) {
  const before = await transport.get();
  if ((await releaseHash(before)) !== expectedHash) return { state: "conflict" as const };
  const targetHash = await releaseHash(target);
  try {
    await transport.patch({ model: target.model });
  } catch {
    /* reconcile by GET, never blind retry */
  }
  try {
    const after = await transport.get();
    if ((await releaseHash(after)) === targetHash)
      return {
        state: "applied" as const,
        providerVersion: String(after.updatedAt ?? ""),
        hash: targetHash,
      };
    return { state: "uncertain" as const };
  } catch {
    return { state: "uncertain" as const };
  }
}
