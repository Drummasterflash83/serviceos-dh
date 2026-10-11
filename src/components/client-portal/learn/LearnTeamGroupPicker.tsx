import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import {
  CARD_SEARCH_MAX_LENGTH,
  readLearnCards,
  searchLearnCards,
  type LearnCardPage,
} from "@/lib/learn-cards";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Mounted only while the chooser is open, inside the identity-scoped workspace. */
export function LearnTeamGroupPicker({
  tenantId,
  selectedId,
  onSelect,
}: {
  tenantId: string;
  selectedId: string;
  onSelect: (group: { id: string; name: string }) => void;
}) {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify([tenantId, query, page, revision]);
  const [result, setResult] = useState<{ key: string; data: LearnCardPage | null } | null>(null);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const db = getSupabaseClient();
        const data = query
          ? await searchLearnCards(db, tenantId, "team", query, page)
          : await readLearnCards(db, tenantId, "team", page);
        if (active) setResult({ key, data });
      } catch {
        if (active) setResult({ key, data: null });
      }
    })();
    return () => {
      active = false;
    };
  }, [tenantId, query, page, key]);
  const settled = result?.key === key;
  const current = settled ? result.data : null;
  return (
    <>
      <DialogHeader>
        <DialogTitle>Choose a team group</DialogTitle>
        <DialogDescription>
          Find a company team to filter its cards and review its scoring rules.
        </DialogDescription>
      </DialogHeader>
      <form
        className="lc-search"
        role="search"
        aria-label="Find a team group"
        onSubmit={(e) => {
          e.preventDefault();
          const term = draft.trim();
          if (term.length > CARD_SEARCH_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(term)) {
            setInvalid(true);
            return;
          }
          setInvalid(false);
          setQuery(term);
          setPage(0);
          setRevision((r) => r + 1);
        }}
      >
        <label>
          Team group name
          <input
            type="search"
            value={draft}
            maxLength={CARD_SEARCH_MAX_LENGTH}
            onChange={(e) => {
              setDraft(e.target.value);
              setInvalid(false);
            }}
          />
        </label>
        <button type="submit" className="cp-secondary">
          Find groups
        </button>
        {(query || draft) && (
          <button
            type="button"
            className="cp-secondary"
            onClick={() => {
              setDraft("");
              setQuery("");
              setPage(0);
              setInvalid(false);
            }}
          >
            Clear group search
          </button>
        )}
        {invalid && <p role="alert">Use up to 120 characters on one line.</p>}
      </form>
      {query && <p className="lc-search-summary">Groups matching “{query}”.</p>}
      {!settled && <p role="status">Reading team groups…</p>}
      {settled && !current && (
        <div role="status">
          <p>Team groups are temporarily unavailable. Your selected group has not changed.</p>
          <button type="button" className="cp-secondary" onClick={() => setRevision((r) => r + 1)}>
            Retry team groups
          </button>
        </div>
      )}
      {current && current.cards.length === 0 && (
        <p role="status">
          {query
            ? "No team groups match this search."
            : page
              ? "No more team groups on this page."
              : "No accessible team groups are stored yet."}
        </p>
      )}
      <ul className="lc-group-options" aria-label="Available team groups">
        {current?.cards.map((group) => (
          <li key={group.id}>
            <button
              type="button"
              className="cp-secondary"
              aria-pressed={group.id === selectedId}
              onClick={() => onSelect({ id: group.id, name: group.title })}
            >
              <span>
                {group.title}
                {group.subtitle && <small>{group.subtitle}</small>}
              </span>
              {group.id === selectedId && <span>Selected</span>}
            </button>
          </li>
        ))}
      </ul>
      <div className="lc-pagination">
        <span>Group page {page + 1} · ordered by last update</span>
        <button
          type="button"
          className="cp-secondary"
          disabled={page === 0}
          onClick={() => setPage((p) => p - 1)}
        >
          Previous groups
        </button>
        <button
          type="button"
          className="cp-secondary"
          disabled={!current?.hasMore || page >= 10000}
          onClick={() => setPage((p) => p + 1)}
        >
          Next groups
        </button>
      </div>
    </>
  );
}
