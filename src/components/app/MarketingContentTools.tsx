import { useState, type RefObject } from "react";
import { Braces, Link2, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { insertMarketingContent } from "@/components/app/marketing-content-insert";

const PERSONALISATION_FIELDS = [
  { token: "{{first_name}}", label: "First name" },
  { token: "{{last_name}}", label: "Last name" },
  { token: "{{display_name}}", label: "Full / display name" },
  { token: "{{company_name}}", label: "Company name" },
] as const;

type TextControl = HTMLInputElement | HTMLTextAreaElement;

function insertAtSelection(
  target: TextControl | null,
  value: string,
  insertion: string,
  onChange: (next: string) => void,
) {
  const start = target?.selectionStart ?? value.length;
  const end = target?.selectionEnd ?? start;
  const next = insertMarketingContent(value, insertion, start, end);
  onChange(next.value);
  requestAnimationFrame(() => {
    target?.focus();
    target?.setSelectionRange(next.caret, next.caret);
  });
}

export function MarketingContentTools({
  targetRef,
  value,
  onChange,
  className,
}: {
  targetRef: RefObject<TextControl | null>;
  value: string;
  onChange: (next: string) => void;
  className?: string;
}) {
  const [addingLink, setAddingLink] = useState(false);
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);

  const addLink = () => {
    const label = linkLabel.trim();
    const url = linkUrl.trim();
    if (!label) {
      setLinkError("Add the words people should click.");
      return;
    }
    if (!/^https:\/\/[^\s]+$/i.test(url)) {
      setLinkError("Use a complete secure link beginning https://");
      return;
    }
    insertAtSelection(targetRef.current, value, `[${label}](${url})`, onChange);
    setLinkLabel("");
    setLinkUrl("");
    setLinkError(null);
    setAddingLink(false);
  };

  return (
    <div className={cn("rounded-lg border border-hairline bg-surface-alt/70 p-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative inline-flex items-center gap-1.5">
          <Braces className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">Insert personalisation</span>
          <select
            aria-label="Insert personalisation"
            className="rounded-md border border-hairline bg-white px-2.5 py-1.5 text-xs font-medium text-foreground outline-none focus:ring-2 focus:ring-ring/30"
            value=""
            onChange={(event) => {
              const token = event.target.value;
              if (token) insertAtSelection(targetRef.current, value, token, onChange);
            }}
          >
            <option value="">Insert a name or field…</option>
            {PERSONALISATION_FIELDS.map((field) => (
              <option key={field.token} value={field.token}>
                {field.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => {
            setAddingLink((open) => !open);
            setLinkError(null);
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-white px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:bg-surface-alt focus:outline-none focus:ring-2 focus:ring-ring/30"
          aria-expanded={addingLink}
        >
          <Link2 className="h-3.5 w-3.5" aria-hidden="true" /> Add a link
        </button>
        <span className="text-[11px] text-muted-foreground">
          The field or link is inserted where your cursor is.
        </span>
      </div>

      {addingLink && (
        <div className="mt-2 grid gap-2 rounded-md border border-hairline bg-white p-2 sm:grid-cols-[1fr_1.5fr_auto]">
          <label className="text-[11px] font-medium text-foreground">
            Link text
            <input
              className="mt-1 w-full rounded-md border border-hairline bg-white px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-ring/30"
              value={linkLabel}
              onChange={(event) => setLinkLabel(event.target.value)}
              placeholder="Book your service"
              autoFocus
            />
          </label>
          <label className="text-[11px] font-medium text-foreground">
            Web address
            <input
              className="mt-1 w-full rounded-md border border-hairline bg-white px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-ring/30"
              value={linkUrl}
              onChange={(event) => setLinkUrl(event.target.value)}
              placeholder="https://drummonds.co/..."
              inputMode="url"
            />
          </label>
          <button
            type="button"
            onClick={addLink}
            className="mt-4 inline-flex h-8 items-center justify-center gap-1 rounded-md bg-foreground px-3 text-xs font-medium text-background hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Insert
          </button>
          {linkError && (
            <div role="alert" className="text-xs text-destructive sm:col-span-3">
              {linkError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
