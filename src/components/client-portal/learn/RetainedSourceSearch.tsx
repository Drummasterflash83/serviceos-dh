/** Explicit server-side search; editing the text does not silently change the current page. */
export function RetainedSourceSearch({
  value,
  applied,
  hint,
  onChange,
  onSearch,
}: {
  value: string;
  applied: string;
  hint: string;
  onChange: (value: string) => void;
  onSearch: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="block">
        Search retained records
        <input
          className="cp-input w-full"
          type="search"
          value={value}
          maxLength={150}
          placeholder={hint}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSearch(value.trim());
            }
          }}
        />
      </label>
      <p className="text-sm">
        {hint}. Searches the records already imported; it does not fetch more from Commusoft.
      </p>
      <div className="flex gap-2">
        <button type="button" className="cp-secondary" onClick={() => onSearch(value.trim())}>
          Search records
        </button>
        <button
          type="button"
          className="cp-secondary"
          disabled={!value && !applied}
          onClick={() => onSearch("")}
        >
          Show all records
        </button>
      </div>
      {applied && <p role="status">Showing retained matches for “{applied}”.</p>}
    </div>
  );
}
