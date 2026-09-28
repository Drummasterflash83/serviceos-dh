import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { money } from "@/lib/client-portal";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

type Delivery = {
  summary: string;
  readinessNote: string;
  next: string;
  areas: { title: string; status: string; detail: string }[];
};
type Edit =
  | { kind: "invoice"; id: string; reference: string; version: number; note: string }
  | { kind: "delivery"; version: number; content: Delivery };

export function OperatorDelivery({
  tenantId,
  mode,
}: {
  tenantId: string;
  mode: "invoices" | "outcomes";
}) {
  const { user } = useAuth();
  const db = getSupabaseClient();
  const qc = useQueryClient();
  const [edit, setEdit] = useState<Edit | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const admin = useQuery({
    queryKey: ["client-programme-editor", user?.id],
    queryFn: async () => {
      const r = await db.rpc("current_user_is_openfolk_operator", {
        required_permission: "platform.controlplane.admin",
      });
      return !r.error && r.data === true;
    },
  });
  const invoices = useQuery({
    queryKey: ["operator-invoices", user?.id, tenantId],
    enabled: mode === "invoices",
    queryFn: async () => {
      const result = await db
        .from("client_invoices")
        .select("id,reference,amount_pence,status,outcome_note,version")
        .eq("tenant_id", tenantId)
        .order("issued_on", { ascending: false })
        .order("id");
      if (result.error) throw Error("Invoice editing could not be loaded.");
      return result.data;
    },
  });
  const delivery = useQuery({
    queryKey: ["operator-delivery", user?.id, tenantId],
    enabled: mode === "outcomes",
    queryFn: async () => {
      const result = await db
        .from("client_delivery_updates")
        .select("content,version")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (result.error) throw Error("Delivery editing could not be loaded.");
      return result.data as { content: Delivery; version: number } | null;
    },
  });
  function begin(value: Edit) {
    setEdit(value);
    setReason("");
    setError("");
    setSaved(false);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!edit || busy) return;
    setBusy(true);
    setError("");
    try {
      const result =
        edit.kind === "invoice"
          ? await db.rpc("operator_update_invoice_notes", {
              p_tenant: tenantId,
              p_invoice: edit.id,
              p_version: edit.version,
              p_outcome_note: edit.note,
              p_reason: reason,
            })
          : await db.rpc("operator_update_delivery", {
              p_tenant: tenantId,
              p_version: edit.version,
              p_content: edit.content,
              p_reason: reason,
            });
      if (result.error)
        throw Error(
          result.error.code === "40001"
            ? "Someone has updated this record. Close, reload and review their changes before saving."
            : "The update was not saved. Check your permissions and try again.",
        );
      setEdit(null);
      setSaved(true);
      await Promise.all(
        ["operator-invoices", "operator-delivery", "client-invoices", "client-delivery"].map(
          (key) => qc.invalidateQueries({ queryKey: [key] }),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }
  const query = mode === "invoices" ? invoices : delivery;
  return (
    <section className="op-card">
      <div className="op-row-heading">
        <div>
          <h2>{mode === "invoices" ? "Invoice delivery notes" : "Published module progress"}</h2>
          <p>
            {mode === "invoices"
              ? "Explain what each invoice delivered. Issued PDFs, amounts and payment records stay protected."
              : "Tell the client what is built, what is ready and what comes next."}
          </p>
        </div>
        {mode === "outcomes" && admin.data && delivery.isSuccess && (
          <button
            className="op-button"
            onClick={() =>
              begin({
                kind: "delivery",
                version: delivery.data?.version ?? 0,
                content: structuredClone(
                  delivery.data?.content ?? { summary: "", readinessNote: "", next: "", areas: [] },
                ),
              })
            }
          >
            <Pencil size={16} /> Edit update
          </button>
        )}
      </div>
      {saved && (
        <p role="status" className="op-shared-note">
          Saved. The client sees this update in their workspace.
        </p>
      )}
      {query.isPending && <p role="status">Loading shared records…</p>}
      {query.isError && (
        <div className="op-error" role="alert">
          {query.error.message} <button onClick={() => void query.refetch()}>Retry</button>
        </div>
      )}
      {mode === "invoices" && (
        <div className="op-list">
          {invoices.data?.map((invoice) => (
            <div className="op-delivery-area" key={invoice.id}>
              <div className="op-row-heading">
                <h3>
                  {invoice.reference} · {money(Number(invoice.amount_pence) / 100)}
                </h3>
                {admin.data && (
                  <button
                    className="op-button"
                    onClick={() =>
                      begin({
                        kind: "invoice",
                        id: invoice.id,
                        reference: invoice.reference,
                        version: invoice.version,
                        note: invoice.outcome_note,
                      })
                    }
                  >
                    <Pencil size={15} /> Edit delivery note
                  </button>
                )}
              </div>
              <p>{invoice.outcome_note}</p>
            </div>
          ))}
          {invoices.isSuccess && !invoices.data.length && <p>No invoices have been published.</p>}
        </div>
      )}
      {mode === "outcomes" && delivery.data && (
        <>
          <p>{delivery.data.content.summary}</p>
          <div className="op-list">
            {delivery.data.content.areas.map((area, index) => (
              <div className="op-delivery-area" key={index}>
                <h3>
                  {area.title} · {area.status}
                </h3>
                <p>{area.detail}</p>
              </div>
            ))}
          </div>
          <p className="op-note">{delivery.data.content.readinessNote}</p>
          <p>Next: {delivery.data.content.next}</p>
        </>
      )}
      {mode === "outcomes" && delivery.isSuccess && !delivery.data && (
        <p>No module progress update published yet.</p>
      )}
      <Dialog
        open={!!edit}
        onOpenChange={(open) => {
          if (!open && !busy) setEdit(null);
        }}
      >
        <DialogContent className="cp-dialog">
          <DialogHeader>
            <DialogTitle>
              {edit?.kind === "invoice"
                ? `Delivery note · ${edit.reference}`
                : "Edit module progress"}
            </DialogTitle>
            <DialogDescription>
              Saving publishes this change to the client. The change and your reason are recorded.
            </DialogDescription>
          </DialogHeader>
          {edit && (
            <form className="op-form" onSubmit={save}>
              {edit.kind === "invoice" ? (
                <label>
                  What this invoice delivered
                  <textarea
                    value={edit.note}
                    onChange={(e) => setEdit({ ...edit, note: e.target.value })}
                    maxLength={10000}
                    required
                  />
                </label>
              ) : (
                <>
                  {(["summary", "readinessNote", "next"] as const).map((key) => (
                    <label key={key}>
                      {
                        {
                          summary: "Summary",
                          readinessNote: "Readiness and limitations",
                          next: "Next step",
                        }[key]
                      }
                      <textarea
                        value={edit.content[key]}
                        required={key !== "readinessNote"}
                        maxLength={10000}
                        onChange={(e) =>
                          setEdit({ ...edit, content: { ...edit.content, [key]: e.target.value } })
                        }
                      />
                    </label>
                  ))}
                  {edit.content.areas.map((area, index) => (
                    <div className="op-delivery-area" key={index}>
                      {(["title", "status", "detail"] as const).map((key) => (
                        <label key={key}>
                          {key}
                          <textarea
                            value={area[key]}
                            required
                            maxLength={key === "title" ? 200 : key === "status" ? 100 : 10000}
                            onChange={(e) =>
                              setEdit({
                                ...edit,
                                content: {
                                  ...edit.content,
                                  areas: edit.content.areas.map((item, i) =>
                                    i === index ? { ...item, [key]: e.target.value } : item,
                                  ),
                                },
                              })
                            }
                          />
                        </label>
                      ))}
                      <button
                        type="button"
                        onClick={() =>
                          setEdit({
                            ...edit,
                            content: {
                              ...edit.content,
                              areas: edit.content.areas.filter((_, i) => i !== index),
                            },
                          })
                        }
                      >
                        Remove area from update
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="op-button"
                    disabled={edit.content.areas.length >= 50}
                    onClick={() =>
                      setEdit({
                        ...edit,
                        content: {
                          ...edit.content,
                          areas: [...edit.content.areas, { title: "", status: "", detail: "" }],
                        },
                      })
                    }
                  >
                    <Plus size={16} /> Add area
                  </button>
                </>
              )}
              <label>
                Reason for this change
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                  maxLength={2000}
                />
              </label>
              {error && (
                <p role="alert" className="op-error">
                  {error}
                </p>
              )}
              <div className="op-form-actions">
                <button type="button" disabled={busy} onClick={() => setEdit(null)}>
                  Cancel
                </button>
                <button className="op-button" disabled={busy}>
                  {busy ? "Saving…" : "Publish to client"}
                </button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
