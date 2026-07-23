import { Link } from "@tanstack/react-router";

export function Nav() {
  return (
    <header className="fixed top-0 z-50 w-full">
      <div className="mx-auto mt-4 flex w-[min(1200px,calc(100%-2rem))] items-center justify-between rounded-full border border-hairline bg-white/70 px-5 py-2.5 backdrop-blur-xl shadow-[var(--shadow-soft)]">
        <Link to="/" className="flex items-center gap-2 text-display text-[15px] font-bold tracking-tight">
          <img src="/brand/openfolk-icon.svg" alt="OpenFolk" className="h-6 w-6 rounded-md" />
          OpenFolk
        </Link>
        <nav className="hidden gap-7 text-[13px] text-muted-foreground md:flex">
          <a href="/#problem" className="hover:text-foreground transition">Problem</a>
          <a href="/#architecture" className="hover:text-foreground transition">Architecture</a>
          <a href="/#command" className="hover:text-foreground transition">Command Centre</a>
          <a href="/#roadmap" className="hover:text-foreground transition">Roadmap</a>
        </nav>
        <Link
          to="/app"
          className="rounded-full bg-foreground px-4 py-2 text-[12px] font-medium text-background transition hover:bg-foreground/85"
        >
          Open OpenFolk →
        </Link>
      </div>
    </header>
  );
}
