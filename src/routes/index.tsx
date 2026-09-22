import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, ArrowRight, Check, MoveUpRight, Plus } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "OpenFolk — A better way to run your business." },
      {
        name: "description",
        content:
          "Your business, working better. OpenFolk connects your people, systems and workflows around measurable results.",
      },
      { property: "og:title", content: "OpenFolk — Your business, working better." },
      {
        property: "og:description",
        content:
          "Business improvement, built around you. Discover, connect, improve and measure with OpenFolk.",
      },
    ],
  }),
  component: OpenFolkHome,
});

const steps = [
  [
    "01",
    "Understand",
    "Start with your ambition.",
    "We learn how your business works, what slows it down and what success should look like.",
  ],
  [
    "02",
    "Connect",
    "See the whole picture.",
    "Bring the right information together from the systems your people already use.",
  ],
  [
    "03",
    "Improve",
    "Make the work work better.",
    "Remove unnecessary steps, clarify ownership and introduce automation where it earns its place.",
  ],
  [
    "04",
    "Measure",
    "Know what changed.",
    "Track results against an agreed baseline. Keep improving the things that make a difference.",
  ],
];

function OpenFolkHome() {
  return (
    <div className="of-site">
      <a href="#main" className="of-skip">
        Skip to content
      </a>
      <header className="of-header of-wrap">
        <Link to="/" className="of-wordmark" aria-label="OpenFolk home">
          <img src="/brand/openfolk-icon.svg" alt="" />
          OpenFolk
          <span className="of-brand-dot" />
        </Link>
        <nav aria-label="Main navigation">
          <a href="#approach">Our approach</a>
          <a href="#outcomes">What changes</a>
          <a className="of-login" href="https://app.openfolk.ai/login?redirect=%2Fclient">
            Client login <ArrowUpRight size={15} />
          </a>
        </nav>
      </header>
      <main id="main">
        <section className="of-hero of-wrap">
          <div className="of-hero-copy">
            <p className="of-eyebrow">
              <span /> BUSINESS IMPROVEMENT. HUMAN FIRST.
            </p>
            <h1>
              Your business.
              <br />
              Working <span>better.</span>
            </h1>
            <p className="of-intro">Less friction. Clearer decisions. More room to grow.</p>
            <p className="of-body">
              We bring your people, systems and workflows together — and build the intelligence to
              help your business improve, every day.
            </p>
            <div className="of-actions">
              <a
                href="mailto:chris@openfolk.ai?subject=Let%E2%80%99s%20talk%20about%20OpenFolk"
                className="of-button"
              >
                Let’s talk about your business <ArrowUpRight size={18} />
              </a>
              <a href="#approach" className="of-text-link">
                Meet OpenFolk <ArrowRight size={16} />
              </a>
            </div>
            <p className="of-hero-foot">Built around your goals. Measured by your results.</p>
          </div>
          <div
            className="of-system-art"
            aria-label="People, systems and goals connected through OpenFolk"
          >
            <div className="of-art-grid" />
            <div className="of-orbit of-orbit-one" />
            <div className="of-orbit of-orbit-two" />
            <div className="of-orbit of-orbit-three" />
            <div className="of-art-label of-art-top">
              <span className="of-tiny-dot" /> THE CONNECTED BUSINESS
            </div>
            <div className="of-system-core">
              <img src="/brand/openfolk-icon.svg" alt="" />
              <strong>OpenFolk</strong>
              <span>Clarity at the centre.</span>
            </div>
            <div className="of-art-node of-node-people">
              <span>01 / PEOPLE</span>
              <strong>
                Everyone knows
                <br />
                what comes next.
              </strong>
              <div className="of-avatar-row">
                <i>P</i>
                <i>S</i>
                <i>G</i>
                <Plus size={14} />
              </div>
            </div>
            <div className="of-art-node of-node-systems">
              <span>02 / SYSTEMS</span>
              <strong>
                Connected.
                <br />
                Considered. Useful.
              </strong>
              <div className="of-node-bars">
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
            </div>
            <div className="of-art-node of-node-goals">
              <span>03 / GOALS</span>
              <strong>Better outcomes.</strong>
              <div className="of-goal-line">
                <MoveUpRight size={22} />
                <span>One shared direction</span>
              </div>
            </div>
            <div className="of-art-bottom">YOUR PEOPLE. YOUR BUSINESS. YOUR NEXT CHAPTER.</div>
          </div>
        </section>
        <div className="of-principles of-wrap">
          <span>Designed around you</span>
          <span>Works with your existing systems</span>
          <span>People stay in control</span>
        </div>
        <section id="outcomes" className="of-section of-wrap">
          <div className="of-section-heading">
            <p className="of-eyebrow">ROOM TO DO BETTER</p>
            <h2>
              Good businesses deserve
              <br />
              better ways of working.
            </h2>
            <p>
              Growing a business creates complexity. OpenFolk helps you turn that complexity into a
              clear, practical programme of improvement.
            </p>
          </div>
          <div className="of-outcome-grid">
            {[
              [
                "01",
                "Get time back.",
                "Reduce repeat admin, chasing and work that falls between systems. Give your people space to do what they do best.",
                "More capacity",
              ],
              [
                "02",
                "Protect your margin.",
                "Understand where delays, missed opportunities and unnecessary work affect profit. Focus effort where it counts.",
                "Better decisions",
              ],
              [
                "03",
                "Move forward together.",
                "Give every priority an owner, every improvement a purpose and every decision the context it needs.",
                "Clearer direction",
              ],
            ].map(([n, title, body, tag]) => (
              <article className="of-outcome" key={n}>
                <span className="of-index">
                  {n} <ArrowUpRight size={20} />
                </span>
                <h3>{title}</h3>
                <p>{body}</p>
                <span className="of-tag">{tag}</span>
              </article>
            ))}
          </div>
        </section>
        <section id="approach" className="of-approach">
          <div className="of-wrap">
            <div className="of-section-heading">
              <p className="of-eyebrow">A PRACTICAL PARTNERSHIP</p>
              <h2>
                Start with the business.
                <br />
                Build towards the result.
              </h2>
              <p>
                A clear plan, delivered in manageable stages. Each one has an outcome, an agreed
                scope and a way to measure progress.
              </p>
            </div>
            <div className="of-step-grid">
              {steps.map(([n, label, title, body]) => (
                <article key={n}>
                  <span className="of-step-number">{n}</span>
                  <p className="of-step-label">{label}</p>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
        <section className="of-os of-wrap">
          <div>
            <p className="of-eyebrow">MEET OPENFOLK OS</p>
            <h2>
              A clearer view.
              <br />A better next move.
            </h2>
            <p className="of-body">
              An operating workspace shaped around your business. Priorities, customers, jobs and
              connected systems — with the right information for the people doing the work.
            </p>
            <ul>
              {[
                "A shared view of priorities and progress",
                "Clear ownership and the next action",
                "Improvement measured against your goals",
              ].map((t) => (
                <li key={t}>
                  <Check size={17} />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="of-workspace-preview">
            <div className="of-preview-bar">
              <span className="of-wordmark">
                OpenFolk
                <span className="of-brand-dot" />
              </span>
              <span>Workspace concept</span>
            </div>
            <div className="of-preview-body">
              <p className="of-eyebrow">YOUR NEXT CHAPTER</p>
              <h3>Clarity. Then action.</h3>
              <p>A shared plan for the things that matter.</p>
              {[
                "Agree the outcome",
                "Connect the right information",
                "Make the next improvement",
              ].map((t, i) => (
                <div className="of-preview-row" key={t}>
                  <span>0{i + 1}</span>
                  <strong>{t}</strong>
                  <ArrowUpRight size={16} />
                </div>
              ))}
              <div className="of-preview-note">
                Built in stages around your needs. Capabilities depend on the scope and connections
                agreed with you.
              </div>
            </div>
          </div>
        </section>
        <section className="of-cta of-wrap">
          <p className="of-eyebrow">LET’S FIND YOUR NEXT STEP</p>
          <h2>
            What could work better
            <br />
            in your business?
          </h2>
          <a
            href="mailto:chris@openfolk.ai?subject=An%20OpenFolk%20conversation"
            className="of-button of-button-light"
          >
            Start a conversation <ArrowUpRight size={18} />
          </a>
          <p>A conversation about your goals, your challenges and where to begin.</p>
        </section>
      </main>
      <footer className="of-footer of-wrap">
        <Link to="/" className="of-wordmark">
          OpenFolk
          <span className="of-brand-dot" />
        </Link>
        <p>Better business. Together.</p>
        <a href="mailto:chris@openfolk.ai">
          chris@openfolk.ai <ArrowUpRight size={14} />
        </a>
        <span>© {new Date().getFullYear()} OpenFolk</span>
      </footer>
    </div>
  );
}
