import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import { money } from "@/lib/client-portal";

export function ClientInvestment({
  tenant,
  userId,
  view = "invoices",
}: {
  tenant: string;
  userId: string;
  view?: "invoices" | "delivery";
}) {
  const db = getSupabaseClient();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const invoices = useQuery({
    queryKey: ["client-invoices", userId, tenant],
    enabled: view === "invoices",
    queryFn: async () => {
      const r = await db
        .from("client_invoices")
        .select(
          "id,reference,issued_on,amount_pence,status,description,outcome_note,payment_basis,storage_path,correction_note",
        )
        .eq("tenant_id", tenant)
        .order("reference");
      if (r.error) throw new Error("Invoices unavailable");
      return r.data;
    },
  });
  const delivery = useQuery({
    queryKey: ["client-delivery", userId, tenant],
    enabled: view === "delivery",
    queryFn: async () => {
      const r = await db
        .from("client_delivery_updates")
        .select("content,verified_at")
        .eq("tenant_id", tenant)
        .maybeSingle();
      if (r.error) throw new Error("Delivery unavailable");
      return r.data;
    },
  });
  async function download(path: string, reference: string) {
    setError("");
    setBusy(reference);
    try {
      const r = await db.storage.from("client-invoices").download(path);
      if (r.error) throw r.error;
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${reference}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch {
      setError("Unable to download this invoice. Please retry or contact OpenFolk.");
    } finally {
      setBusy("");
    }
  }
  const rows = invoices.data ?? [];
  const total = (status?: string) =>
    rows
      .filter((r) => !status || r.status === status)
      .reduce((n, r) => n + Number(r.amount_pence), 0) / 100;
  return (
    <section className="cp-invoices-page">
      {view === "invoices" && (
        <>
          {invoices.isPending ? (
            <p role="status">Loading invoices…</p>
          ) : invoices.isError ? (
            <p role="alert">
              Invoices unavailable—not zero.{" "}
              <button onClick={() => void invoices.refetch()}>Retry</button>
            </p>
          ) : (
            <>
              <div className="cp-metrics">
                <div>
                  <span>Paid to date</span>
                  <strong>{money(total("paid"))}</strong>
                  <small>Recorded invoice payments</small>
                </div>
                <div>
                  <span>Outstanding</span>
                  <strong>{money(total("outstanding"))}</strong>
                  <small>Issued and not yet paid</small>
                </div>
                <div>
                  <span>Total invoiced</span>
                  <strong>{money(total())}</strong>
                  <small>Future proposals excluded</small>
                </div>
              </div>
              <p className="cp-investment-note">
                Private to your programme. Proposed packages are not included in these totals.
              </p>
              {rows.length === 0 && <p>No invoices published yet.</p>}
              <div className="cp-invoice-list">
                {rows.map((r) => (
                  <article className="cp-invoice" key={r.id}>
                    <div className="cp-invoice-top">
                      <div>
                        <span
                          className={`cp-status ${r.status === "paid" ? "cp-status-good" : ""}`}
                        >
                          {r.status === "paid" ? "Paid" : "Outstanding"}
                        </span>
                        <h3>{r.reference}</h3>
                        <p>
                          {new Date(`${r.issued_on}T12:00:00`).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "long",
                            year: "numeric",
                          })}
                        </p>
                      </div>
                      <strong>{money(Number(r.amount_pence) / 100)}</strong>
                    </div>
                    <h4>{r.description}</h4>
                    <p>{r.outcome_note}</p>
                    <small>{r.payment_basis}</small>
                    {r.correction_note && <p className="cp-investment-note">{r.correction_note}</p>}
                    <button
                      className="cp-small-button"
                      disabled={!!busy}
                      onClick={() => void download(r.storage_path, r.reference)}
                    >
                      <Download size={15} />
                      {busy === r.reference ? "Downloading…" : "Download invoice"}
                    </button>
                  </article>
                ))}
              </div>
            </>
          )}
          {error && (
            <p role="alert" className="cp-error">
              {error}
            </p>
          )}
        </>
      )}
      {view === "delivery" && (
        <div className="cp-delivery-summary">
          <p className="of-eyebrow">BUILD PROGRESS</p>
          <h2>Where we are today</h2>
          {delivery.isPending ? (
            <p>Loading delivery update…</p>
          ) : delivery.isError ? (
            <p role="alert">
              Delivery update unavailable.{" "}
              <button onClick={() => void delivery.refetch()}>Retry</button>
            </p>
          ) : !delivery.data ? (
            <p>Your next delivery update is being prepared.</p>
          ) : (
            <>
              <p>{delivery.data.content.summary}</p>
              <div className="cp-invoice-list">
                {(
                  delivery.data.content.areas as { title: string; status: string; detail: string }[]
                ).map((a) => (
                  <article className="cp-invoice" key={a.title}>
                    <span className="cp-status">{a.status}</span>
                    <h3>{a.title}</h3>
                    <p>{a.detail}</p>
                  </article>
                ))}
              </div>
              <p className="cp-investment-note">{delivery.data.content.readinessNote}</p>
              <p>
                <strong>Next:</strong> {delivery.data.content.next}
              </p>
              <small>
                Recorded {new Date(delivery.data.verified_at).toLocaleDateString("en-GB")}. Build
                checkpoints are not live monitoring.
              </small>
            </>
          )}
        </div>
      )}
    </section>
  );
}
