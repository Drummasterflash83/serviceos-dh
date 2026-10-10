import {
  resolveOperatorInput,
  validateInputRequest,
  type OperatorInputClient,
  type OperatorInputRequest,
} from "./learn-operator-inputs.ts";
import {
  inputOutboxKey,
  connectionOutboxKey,
  captureOutboxKey,
  type InputScope,
  type InputLock,
  type RequestStore as Store,
} from "./learn-operator-request-scope.ts";
export { inputOutboxKey };
export type { InputScope, InputLock };
export type SavedInputRequest = { version: 1; backend: string; request: OperatorInputRequest };
function checked(s: InputScope, value: SavedInputRequest): SavedInputRequest {
  inputOutboxKey(s);
  if (
    !value ||
    value.version !== 1 ||
    value.backend !== s.backend ||
    value.request?.actorId !== s.actorId ||
    value.request?.tenantId !== s.tenantId
  )
    throw Error("The saved request belongs to another session or cannot be verified.");
  validateInputRequest(value.request);
  const { tenantId, actorId, requestId, definition } = value.request;
  return {
    version: 1,
    backend: s.backend,
    request: { tenantId, actorId, requestId, definition: structuredClone(definition) },
  };
}
export function readSavedInput(store: Store, s: InputScope): SavedInputRequest | null {
  const raw = store.getItem(inputOutboxKey(s));
  if (raw === null) return null;
  if (raw.length > 15000) throw Error("The saved operator request needs review.");
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw Error("The saved operator request could not be read. It has been retained.");
  }
  return checked(s, value);
}
/** Save before any network request; coordinate tabs and resolve the server receipt
 * first. No timeout/age-based deletion or automatic retry after uncertain writes. */
export async function resolveSavedInput(
  db: OperatorInputClient,
  store: Store,
  lock: InputLock,
  s: InputScope,
  input: SavedInputRequest,
  mode: "apply" | "check" | "cancel",
  allowed: () => boolean,
) {
  const value = checked(s, input),
    key = inputOutboxKey(s),
    encoded = JSON.stringify(value);
  return lock(key, async () => {
    if (!allowed()) throw Error("Operator context changed. Reopen this company before continuing.");
    if (mode === "apply" && store.getItem(captureOutboxKey(s)) !== null)
      throw Error("Resolve the saved capture request before changing modules or approving an import.");
    if (store.getItem(connectionOutboxKey(s)) !== null)
      throw Error(
        "Resolve the saved connection request before changing modules or approving an import.",
      );
    const saved = readSavedInput(store, s);
    if (saved && JSON.stringify(saved) !== encoded)
      throw Error("Another request is saved. Resolve it before making a new change.");
    if (!saved && mode !== "apply")
      throw Error("The saved request changed. Refresh before continuing.");
    store.setItem(key, encoded);
    if (store.getItem(key) !== encoded)
      throw Error("The request could not be saved locally. Nothing was sent.");
    if (!allowed()) throw Error("Operator context changed; request retained.");
    let receipt = await resolveOperatorInput(db, value.request, "check");
    if (receipt.state === "pending" && mode !== "check") {
      if (!allowed()) throw Error("Operator context changed; request retained.");
      receipt = await resolveOperatorInput(db, value.request, mode);
    }
    if (receipt.state !== "pending") {
      if (!allowed() || store.getItem(key) !== encoded)
        throw Error(
          "The result was recorded, but the saved context changed. Check its receipt again.",
        );
      store.removeItem(key);
      if (store.getItem(key) !== null)
        throw Error("The result was recorded, but local recovery storage could not be cleared.");
    }
    return receipt;
  });
}
