import { useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import {
  reviewStagedBatchUpload, type StagedBatchUpload,
} from "@/lib/new-dawn-staged-batch-upload";

type Reviewed = { manifest: StagedBatchUpload; fileHash: string;
  customers: number; sites: number; jobs: number };
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes))
  .map((byte) => byte.toString(16).padStart(2, "0")).join("");
const uuid = (x: unknown): x is string => typeof x === "string" &&
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(x);

/** Private OpenFolk operator release control. File contents stay in memory
 * inside the short-lived operator review; only an authenticated RPC sees IDs.
 * This registers a batch for review. It never enables or invokes apply.
 */
export function OperatorStagedIdentityBatch({ tenantId, reason, active }: {
  tenantId: string; reason: string; active: () => boolean;
}) {
  const [manifestFile, setManifestFile] = useState<File | null>(null);
  const [mapFile, setMapFile] = useState<File | null>(null);
  const [reviewed, setReviewed] = useState<Reviewed | null>(null);
  const [expectedHash, setExpectedHash] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [receipt, setReceipt] = useState<{ state: string; itemCount: number } | null>(null);
  function reset() {
    setReviewed(null); setExpectedHash(""); setConfirmed(false);
    setMessage(""); setReceipt(null);
  }
  async function inspect() {
    reset();
    if (!manifestFile || !mapFile || manifestFile.size > 2_000_000 ||
      mapFile.size > 32_000 || manifestFile.size < 100 || mapFile.size < 30) {
      setMessage("Select the reviewed private manifest and category map files.");
      return;
    }
    setBusy(true);
    try {
      const bytes = await manifestFile.arrayBuffer();
      const mapText = await mapFile.text();
      const fileHash = hex(await crypto.subtle.digest("SHA-256", bytes));
      const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
      const map = JSON.parse(mapText) as unknown;
      const summary = reviewStagedBatchUpload(value, map, tenantId);
      if (!active() || !summary) throw Error("review_invalid");
      setReviewed({ ...summary, fileHash });
    } catch {
      setMessage("The files do not form an exact reviewed batch for this company.");
    } finally { setBusy(false); }
  }
  async function register() {
    if (!active() || !reviewed || !confirmed ||
      expectedHash.toLowerCase().trim() !== reviewed.fileHash ||
      !uuid(reviewed.manifest.batch_id)) return;
    setBusy(true); setMessage("");
    try {
      const m = reviewed.manifest;
      const { data, error } = await getSupabaseClient().rpc(
        "new_dawn_m2_identity_batch_register", {
          p_batch: m.batch_id, p_tenant: tenantId, p_connection: m.connection_id,
          p_items: m.items, p_kind_map: m.kind_map,
          p_kind_evidence_sha256: m.kind_evidence_sha256,
          p_reason: `${reason.trim().slice(0, 200)} — ${m.reason.trim().slice(0, 200)}`,
        },
      ).abortSignal(AbortSignal.timeout(90_000));
      if (error || !data || typeof data !== "object" ||
        !["prepared", "already_prepared"].includes(String(data.state)) ||
        data.batch_id !== m.batch_id || data.item_count !== m.items.length)
        throw Error("registration_unconfirmed");
      setReceipt({ state: String(data.state), itemCount: m.items.length });
      setReviewed(null); setManifestFile(null); setMapFile(null);
      setExpectedHash(""); setConfirmed(false);
    } catch {
      setMessage("Registration was not confirmed. Check the operator audit before retrying the same batch.");
    } finally { setBusy(false); }
  }
  return <section className="space-y-3 rounded-xl border border-hairline p-4"
    aria-label="Register reviewed Commusoft identity batch">
    <h3 className="text-base font-semibold">Register a reviewed identity batch</h3>
    <p className="text-sm">OpenFolk operator action only. Select the exact private files;
      job and customer IDs are never shown here. Registration records the reviewed
      batch and audit trail. It does not create links or turn on the apply flag.</p>
    <label className="block text-sm">Reviewed manifest JSON
      <input type="file" accept=".json,application/json" disabled={busy}
        onChange={(event) => { reset(); setManifestFile(event.target.files?.[0] ?? null); }} />
    </label>
    <label className="block text-sm">Reviewed category-map JSON
      <input type="file" accept=".json,application/json" disabled={busy}
        onChange={(event) => { reset(); setMapFile(event.target.files?.[0] ?? null); }} />
    </label>
    <button className="cp-secondary" type="button" disabled={busy || !manifestFile || !mapFile}
      onClick={() => void inspect()}>Review local batch summary</button>
    {reviewed && <div className="space-y-2 text-sm" role="status">
      <p>{reviewed.customers} customers · {reviewed.sites} sites · {reviewed.jobs} jobs
        ({reviewed.manifest.items.length} reviewed items).</p>
      <p className="break-all">Manifest file SHA-256: <code>{reviewed.fileHash}</code></p>
      <label className="block">Paste the approved file SHA-256 to confirm this exact batch
        <input className="cp-input w-full" value={expectedHash} maxLength={64}
          autoComplete="off" spellCheck={false}
          onChange={(event) => setExpectedHash(event.target.value)} />
      </label>
      <label className="flex gap-2"><input type="checkbox" checked={confirmed}
        onChange={(event) => setConfirmed(event.target.checked)} />
        I reviewed this company, the aggregate counts and the exact registration action.
      </label>
      <button className="cp-secondary" type="button" disabled={busy || !confirmed ||
        expectedHash.toLowerCase().trim() !== reviewed.fileHash}
        onClick={() => void register()}>Register reviewed batch (no apply)</button>
    </div>}
    {message && <p role="alert" className="text-sm">{message}</p>}
    {receipt && <p role="status" className="text-sm">Batch {receipt.state.replaceAll("_", " ")};
      {` ${receipt.itemCount}`} items recorded. No links were applied.</p>}
  </section>;
}
