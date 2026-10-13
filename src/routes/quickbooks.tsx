import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Link2, Unplug } from "lucide-react";
import { OpenFolkWordmark } from "@/components/OpenFolkWordmark";

export const Route = createFileRoute("/quickbooks")({
  validateSearch: (search: Record<string, unknown>): { mode: "connect" | "disconnect" } => ({
    mode: search.mode === "disconnect" ? "disconnect" : "connect",
  }),
  head: () => ({
    meta: [
      { title: "QuickBooks connection guide · OpenFolk ServiceOS" },
      {
        name: "description",
        content: "Connect, reconnect or disconnect QuickBooks Online with OpenFolk ServiceOS.",
      },
    ],
  }),
  component: QuickBooksGuide,
});

const signIn = "/login?redirect=%2Fopenfolk";
const intuitHelp =
  "https://quickbooks.intuit.com/learn-support/en-us/help-article/manage-users/transfer-app-ownership-disconnect-apps/L73ZAy899_US_en_US";

function QuickBooksGuide() {
  const { mode } = Route.useSearch();
  const disconnect = mode === "disconnect";
  return (
    <div className="min-h-screen bg-[#faf9f6] text-[#252334]">
      <a href="#quickbooks-guide" className="sr-only focus:not-sr-only focus:block focus:p-4">
        Skip to connection guide
      </a>
      <header className="border-b border-[#e4dfeb]">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <Link to="/" aria-label="OpenFolk home">
            <OpenFolkWordmark size={30} />
          </Link>
          <a className="text-sm font-medium underline underline-offset-4" href={signIn}>
            Sign in to OpenFolk
          </a>
        </div>
      </header>
      <main id="quickbooks-guide" className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-16">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#78648c]">
          ServiceOS · Connection guide
        </p>
        <h1 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight sm:text-5xl">
          {disconnect
            ? "Manage your QuickBooks disconnection."
            : "Bring your accounts into the picture."}
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-[#625b70]">
          {disconnect
            ? "Stop future access, review the connection and keep control of the records already captured."
            : "Connect the right QuickBooks company so its accounting records can sit alongside your customer and job information."}
        </p>
        <nav aria-label="QuickBooks connection help" className="my-8 flex flex-wrap gap-3">
          <Link
            to="/quickbooks"
            search={{ mode: "connect" }}
            aria-current={!disconnect ? "page" : undefined}
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium ${!disconnect ? "border-[#514268] bg-[#514268] text-white" : "border-[#ded8e7] bg-white"}`}
          >
            <Link2 size={16} aria-hidden="true" /> Connect or reconnect
          </Link>
          <Link
            to="/quickbooks"
            search={{ mode: "disconnect" }}
            aria-current={disconnect ? "page" : undefined}
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium ${disconnect ? "border-[#514268] bg-[#514268] text-white" : "border-[#ded8e7] bg-white"}`}
          >
            <Unplug size={16} aria-hidden="true" /> Disconnect
          </Link>
        </nav>
        <div className="grid gap-6 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <section
            aria-labelledby="connection-steps"
            className="rounded-3xl border border-[#e4dfeb] bg-white p-6 sm:p-8"
          >
            <h2 id="connection-steps" className="text-xl font-semibold">
              {disconnect ? "Choose how to stop access" : "A company connection you control"}
            </h2>
            {disconnect ? (
              <div className="mt-5 space-y-5 text-sm leading-6 text-[#625b70]">
                <div>
                  <h3 className="font-semibold text-[#252334]">Through QuickBooks</h3>
                  <p>
                    Ask the administrator of your QuickBooks company to open its connected
                    integrations, select OpenFolk ServiceOS and complete Intuit’s disconnect steps.
                  </p>
                  <a
                    href={intuitHelp}
                    className="mt-2 inline-block font-medium text-[#514268] underline underline-offset-4"
                  >
                    Read Intuit’s disconnection instructions
                  </a>
                </div>
                <div>
                  <h3 className="font-semibold text-[#252334]">Through OpenFolk</h3>
                  <p>
                    An authorised OpenFolk operator can select your company, open Modules →
                    QuickBooks accounting connection and review its disconnect controls. Check the
                    recorded outcome before treating access as revoked.
                  </p>
                </div>
                <p className="rounded-xl bg-[#f5f1f8] p-4 text-[#514268]">
                  Opening this guide does not disconnect an account or verify an earlier
                  disconnection. Review the signed-in connection status.
                </p>
              </div>
            ) : (
              <ol className="mt-5 list-decimal space-y-4 pl-5 text-sm leading-6 text-[#625b70] marker:font-semibold marker:text-[#514268]">
                <li>
                  <strong className="text-[#252334]">Select the client.</strong> An authorised
                  OpenFolk operator signs in, selects the client workspace and opens Modules →
                  QuickBooks accounting connection.
                </li>
                <li>
                  <strong className="text-[#252334]">Review Intuit’s permission.</strong> Use
                  Connect or Reconnect, sign in to Intuit and check the exact QuickBooks company
                  before granting access. Sandbox and live companies are separate.
                </li>
                <li>
                  <strong className="text-[#252334]">Confirm the company in ServiceOS.</strong>{" "}
                  Review the returned identity before enabling a bounded import. Connection alone
                  does not start an import or establish complete accounting coverage.
                </li>
              </ol>
            )}
            <a
              href={signIn}
              className="mt-7 inline-flex max-w-full items-center justify-center gap-2 rounded-xl bg-[#514268] px-5 py-3 text-sm font-semibold text-white hover:bg-[#403451] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#514268]"
            >
              Open connection controls <ArrowRight size={17} aria-hidden="true" />
            </a>
            <p className="mt-3 text-xs leading-5 text-[#766e81]">
              An existing OpenFolk operator account is required. If you do not manage connections,
              contact your workspace administrator.
            </p>
          </section>
          <aside className="space-y-6">
            <section className="rounded-3xl border border-[#e4dfeb] bg-[#f5f1f8] p-6">
              <h2 className="text-lg font-semibold">What the connection means</h2>
              <div className="mt-4 space-y-4 text-sm leading-6 text-[#625b70]">
                <p>
                  ServiceOS’s connector reads accounting records. Intuit’s Accounting permission
                  also permits writes; ServiceOS does not use it to edit transactions or move money.
                </p>
                <p>
                  Disconnecting stops access through that connection. It does not delete records in
                  QuickBooks or automatically erase history already captured in ServiceOS.
                </p>
                <p>
                  For retained records, exports or deletion requests, contact your workspace
                  administrator. Financial summaries need their dates, currency and coverage checked
                  against the source.
                </p>
              </div>
            </section>
            <section className="rounded-3xl border border-[#e4dfeb] bg-white p-6">
              <h2 className="text-lg font-semibold">Drummonds support</h2>
              <p className="mt-3 text-sm leading-6 text-[#625b70]">
                For Drummonds’ deployment, contact Chris Drummond. Include the issue and approximate
                time; keep passwords, access tokens and financial attachments out of the initial
                message.
              </p>
              <a
                href="mailto:chris@drummondheating.co.uk?subject=ServiceOS%20QuickBooks%20support"
                className="mt-4 inline-block break-all text-sm font-medium text-[#514268] underline underline-offset-4"
              >
                chris@drummondheating.co.uk
              </a>
              <p className="mt-3 text-xs leading-5 text-[#766e81]">
                Other clients should use their own workspace administrator or agreed support
                contact.
              </p>
            </section>
          </aside>
        </div>
        <footer className="mt-10 border-t border-[#e4dfeb] pt-5 text-xs leading-5 text-[#766e81]">
          OpenFolk ServiceOS is independent of Intuit. This guide shows how to manage a connection;
          it contains no account data or live connection status.
        </footer>
      </main>
    </div>
  );
}
