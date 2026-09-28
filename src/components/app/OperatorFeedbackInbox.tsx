import { useState, type FormEvent } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Send } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";

type FeedbackNote = { id: string; author_id: string; body: string; created_at: string };
const pageSize = 30;
const noteDate = (value: string) =>
  new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Existing append-only client conversation. Replies use the signed-in actor, never impersonation. */
export function OperatorFeedbackInbox({ tenantId }: { tenantId: string }) {
  const { user } = useAuth();
  const db = getSupabaseClient();
  const qc = useQueryClient();
  const [reply, setReply] = useState("");
  const [replyTo, setReplyTo] = useState<FeedbackNote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const authority = useQuery({
    queryKey: ["client-programme-editor", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const result = await db.rpc("current_user_is_openfolk_operator", {
        required_permission: "platform.controlplane.admin",
      });
      return !result.error && result.data === true;
    },
  });
  const notes = useInfiniteQuery({
    queryKey: ["operator-feedback-notes", user?.id, tenantId],
    enabled: !!user,
    initialPageParam: null as { created_at: string; id: string } | null,
    queryFn: async ({ pageParam }) => {
      let query = db
        .from("client_programme_notes")
        .select("id,author_id,body,created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(pageSize);
      if (pageParam)
        query = query.or(
          `created_at.lt.${pageParam.created_at},and(created_at.eq.${pageParam.created_at},id.lt.${pageParam.id})`,
        );
      const result = await query;
      if (result.error) throw Error("Client feedback could not be loaded.");
      return (result.data ?? []) as FeedbackNote[];
    },
    getNextPageParam: (last) => (last.length === pageSize ? last.at(-1)! : undefined),
    refetchInterval: 60_000,
  });
  async function send(event: FormEvent) {
    event.preventDefault();
    if (busy || authority.data !== true || !reply.trim()) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const body = replyTo
        ? `In response to your note from ${noteDate(replyTo.created_at)}:\n\n${reply.trim()}`
        : reply.trim();
      const result = await db.from("client_programme_notes").insert({ tenant_id: tenantId, body });
      if (result.error)
        throw Error(
          "We could not confirm the reply was saved. Check the conversation before trying again.",
        );
      setReply("");
      setReplyTo(null);
      setSaved(true);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["operator-feedback-notes", user?.id, tenantId] }),
        qc.invalidateQueries({ queryKey: ["client-programme-notes"] }),
      ]);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The reply could not be confirmed. Your draft is still here.",
      );
    } finally {
      setBusy(false);
    }
  }
  const rows = notes.data?.pages.flat() ?? [];
  return (
    <section className="op-card op-feedback-inbox" aria-label="Client feedback">
      <div className="op-row-heading">
        <div>
          <p className="op-eyebrow">SHARED CLIENT CONVERSATION</p>
          <h2>
            <MessageSquare size={21} /> Client feedback
          </h2>
          <p>
            Questions and ideas from Review & feedback. Reply here; they see it in their workspace.
          </p>
        </div>
      </div>
      {notes.isPending ? (
        <p role="status">Loading client feedback…</p>
      ) : notes.isError ? (
        <p className="op-error" role="alert">
          {notes.error.message} <button onClick={() => void notes.refetch()}>Try again</button>
        </p>
      ) : rows.length === 0 ? (
        <p>No workspace feedback yet.</p>
      ) : (
        <div className="op-feedback-list">
          {rows.map((item) => (
            <article className="op-feedback-note" key={item.id}>
              <div className="op-row-heading">
                <strong>{item.author_id === user?.id ? "You" : "Workspace member"}</strong>
                <time dateTime={item.created_at}>{noteDate(item.created_at)}</time>
              </div>
              <p>{item.body}</p>
              {authority.data === true && item.author_id !== user?.id && (
                <button
                  className="op-button"
                  onClick={() => {
                    setReplyTo(item);
                    setSaved(false);
                  }}
                >
                  Reply to this note
                </button>
              )}
            </article>
          ))}
          {notes.hasNextPage && (
            <button
              className="op-button"
              disabled={notes.isFetchingNextPage}
              onClick={() => void notes.fetchNextPage()}
            >
              {notes.isFetchingNextPage ? "Loading…" : "Load earlier feedback"}
            </button>
          )}
        </div>
      )}
      {authority.data === true && (
        <form className="op-form" onSubmit={send}>
          <label>
            {replyTo
              ? `Reply to the note from ${noteDate(replyTo.created_at)}`
              : "Send a reply to the client"}
            <textarea
              value={reply}
              onChange={(event) => {
                setReply(event.target.value);
                setSaved(false);
              }}
              maxLength={9500}
              rows={4}
              placeholder="A clear answer or next step…"
              required
            />
          </label>
          <div className="op-form-actions">
            {replyTo && (
              <button type="button" onClick={() => setReplyTo(null)}>
                Cancel reply selection
              </button>
            )}
            <button className="op-button" disabled={busy || !reply.trim()}>
              <Send size={16} /> {busy ? "Saving…" : "Save reply to workspace"}
            </button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="op-error">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="op-shared-note">
          Reply saved. The client can read it in Review & feedback.
        </p>
      )}
      <p className="op-note">
        This is the saved conversation, not an unread or resolved count. Emma call reports stay in
        the receptionist review desk.
      </p>
    </section>
  );
}
