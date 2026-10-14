import { Link } from "@tanstack/react-router";
import { Fragment } from "react";
import { OpenFolkWordmark } from "@/components/OpenFolkWordmark";

type Section = { kind: string; text?: string; items?: string[] };
export type PolicyDocument = { title: string; sections: Section[] };

// Only the two approved, bundled documents reach this renderer. React escapes
// text; this limited inline formatter never injects HTML or external content.
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\(https:\/\/[^)]+\))/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**"))
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        const link = part.match(/^\[([^\]]+)\]\((https:\/\/[^)]+)\)$/);
        if (link)
          return (
            <a key={i} href={link[2]} className="underline underline-offset-4">
              {link[1]}
            </a>
          );
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}

export function DrummondsPolicy({ document }: { document: PolicyDocument }) {
  return (
    <div className="min-h-screen bg-[#faf9f6] text-[#252334]">
      <a href="#policy-content" className="sr-only focus:not-sr-only focus:block focus:p-4">
        Skip to policy
      </a>
      <header className="border-b border-[#e4dfeb] bg-white">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-5 px-5 py-6 sm:px-8">
          <Link to="/" aria-label="OpenFolk home">
            <OpenFolkWordmark size={30} />
          </Link>
          <nav
            aria-label="Drummonds policies"
            className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium"
          >
            <a href="/privacy/drummonds" className="underline underline-offset-4">
              Privacy notice
            </a>
            <a href="/terms/drummonds" className="underline underline-offset-4">
              User terms
            </a>
            <a href="/quickbooks?mode=connect" className="underline underline-offset-4">
              QuickBooks guide
            </a>
          </nav>
        </div>
      </header>
      <main id="policy-content" className="mx-auto max-w-4xl px-5 py-10 sm:px-8 sm:py-14">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#78648c]">
          Drummonds · ServiceOS
        </p>
        <h1 className="mt-4 max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          {document.title}
        </h1>
        <article className="mt-7 max-w-3xl break-words text-base leading-8 text-[#514b5e]">
          {document.sections.map((section, i) =>
            section.kind === "heading" ? (
              <h2 key={i} className="mb-4 mt-10 text-xl font-semibold leading-7 text-[#252334]">
                {section.text}
              </h2>
            ) : section.kind === "list" ? (
              <ul key={i} className="mb-5 list-disc space-y-2 pl-6">
                {section.items?.map((item, j) => (
                  <li key={j}>
                    <Inline text={item} />
                  </li>
                ))}
              </ul>
            ) : (
              <p key={i} className="mb-5">
                <Inline text={section.text ?? ""} />
              </p>
            ),
          )}
        </article>
      </main>
      <footer className="border-t border-[#e4dfeb] px-5 py-7 text-sm leading-6 text-[#625b70]">
        <div className="mx-auto max-w-4xl">
          Drummonds ServiceOS enquiries:{" "}
          <a
            className="break-words underline underline-offset-4"
            href="mailto:chris@drummondheating.co.uk"
          >
            chris@drummondheating.co.uk
          </a>
        </div>
      </footer>
    </div>
  );
}
