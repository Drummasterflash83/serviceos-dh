import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";

// Public signup is OFF unless explicitly enabled. Access is invite-only.
const SIGNUP_ENABLED = import.meta.env.VITE_ENABLE_SIGNUP === "true";

/** Only allow internal, non-protocol-relative redirect targets (no open redirect). */
function safeRedirect(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (!value.startsWith("/") || value.startsWith("//")) return undefined;
  return value;
}

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: safeRedirect(search.redirect),
  }),
  head: () => ({
    meta: [{ title: "Sign in · OpenFolk" }],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { redirect } = Route.useSearch();
  const navigate = useNavigate();
  const { session, loading, configured, signInWithPassword, signUpWithPassword } = useAuth();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const dest = redirect ?? "/app";

  // Already signed in → leave the login page.
  useEffect(() => {
    if (!loading && session) navigate({ to: dest, replace: true });
  }, [loading, session, dest, navigate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setPending(true);
    const run = mode === "signup" ? signUpWithPassword : signInWithPassword;
    const { error: authError } = await run(email.trim(), password);
    setPending(false);
    if (authError) {
      setError(authError);
      return;
    }
    if (mode === "signup") {
      setNotice("Account created. Check your email to confirm, then sign in.");
      setMode("signin");
    }
    // On sign-in success the auth listener updates the session and the effect
    // above redirects to `dest`.
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src="/brand/openfolk-icon.svg" alt="OpenFolk" className="h-10 w-10 rounded-md" />
          <h1 className="text-display mt-4 text-xl font-semibold tracking-tight text-foreground">
            Sign in to OpenFolk
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Access is invite-only.</p>
        </div>

        <div className="rounded-2xl border border-hairline bg-white p-6 shadow-[var(--shadow-soft)]">
          {!configured && (
            <div className="mb-4 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              Authentication is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
            </div>
          )}

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                disabled={pending || !configured}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                disabled={pending || !configured}
              />
            </div>

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}
            {notice && (
              <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
                {notice}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={pending || !configured}>
              {pending ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
            </Button>
          </form>

          {SIGNUP_ENABLED && (
            <div className="mt-4 text-center text-xs text-muted-foreground">
              {mode === "signin" ? (
                <button
                  type="button"
                  className="underline-offset-4 hover:underline"
                  onClick={() => {
                    setMode("signup");
                    setError(null);
                    setNotice(null);
                  }}
                >
                  Need an account? Create one
                </button>
              ) : (
                <button
                  type="button"
                  className="underline-offset-4 hover:underline"
                  onClick={() => {
                    setMode("signin");
                    setError(null);
                    setNotice(null);
                  }}
                >
                  Already have an account? Sign in
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
