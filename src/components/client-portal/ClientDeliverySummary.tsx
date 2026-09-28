import { useQuery } from "@tanstack/react-query";
import { getSupabaseClient } from "@/lib/supabase";

/** The published delivery record is shared by client and operator, never inferred from a quote. */
export function ClientDeliverySummary({ tenant, userId }: { tenant: string; userId: string }) {
  const delivery = useQuery({
    queryKey: ["client-delivery", userId, tenant],
    queryFn: async () => {
      const result = await getSupabaseClient()
        .from("client_delivery_updates")
        .select("content,verified_at")
        .eq("tenant_id", tenant)
        .maybeSingle();
      if (result.error) throw new Error("Module progress could not be loaded.");
      return result.data;
    },
  });
  return (
    <section className="cp-card cp-delivery-summary" aria-label="Published module progress">
      <p className="of-eyebrow">YOUR PROGRESS</p>
      <h2>What’s ready. What’s next.</h2>
      {delivery.isPending ? (
        <p role="status">Loading module progress…</p>
      ) : delivery.isError ? (
        <p role="alert">
          Module progress could not be loaded.{" "}
          <button className="cp-text-button" onClick={() => void delivery.refetch()}>
            Try again
          </button>
        </p>
      ) : !delivery.data ? (
        <p>OpenFolk is preparing your next progress update.</p>
      ) : (
        <>
          <p>{delivery.data.content.summary}</p>
          <div className="cp-invoice-list">
            {(
              delivery.data.content.areas as { title: string; status: string; detail: string }[]
            ).map((area) => (
              <article className="cp-invoice" key={area.title}>
                <span className="cp-status">{area.status}</span>
                <h3>{area.title}</h3>
                <p>{area.detail}</p>
              </article>
            ))}
          </div>
          <p className="cp-investment-note">{delivery.data.content.readinessNote}</p>
          <p>
            <strong>Next:</strong> {delivery.data.content.next}
          </p>
          <small>
            Published {new Date(delivery.data.verified_at).toLocaleDateString("en-GB")}. This is a
            delivery checkpoint, not a live health check.
          </small>
        </>
      )}
    </section>
  );
}
