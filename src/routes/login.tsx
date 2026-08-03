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
  validateSearch: (search: Record<string, unknown>): { redirect?: string; reset?: boolean } => ({
    redirect: safeRedirect(search.redirect),
    reset: search.reset === true || search.reset === "1",
  }),
  head: () => ({
    meta: [{ title: "Sign in · OpenFolk" }],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { redirect, reset } = Route.useSearch();
  const navigate = useNavigate();
  const {
    session,
    loading,
    configured,
    signInWithPassword,
    signUpWithPassword,
    requestPasswordReset,
    updatePassword,
    signOut,
  } = useAuth();

  const [mode, setMode] = useState<"signin" | "signup" | "forgot" | "reset">(
    reset ? "reset" : "signin",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const dest = redirect ?? "/app";

  // A recovery link creates a session specifically so the password can be
  // changed here; do not auto-redirect that session away from the form.
  useEffect(() => {
    if (!loading && session && mode !== "reset") navigate({ to: dest, replace: true });
  }, [loading, session, mode, dest, navigate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setPending(true);

    if (mode === "forgot") {
      await requestPasswordReset(email.trim(), `${window.location.origin}/login?reset=1`);
      setPending(false);
      // Keep the response identical whether or not the address exists.
      setNotice("If that address has access, a secure reset link is on its way.");
      return;
    }

    if (mode === "reset") {
      if (!session) {
        setPending(false);
        setError("This reset link is invalid or has expired. Request a new one.");
        return;
      }
      if (password.length < 12) {
        setPending(false);
        setError("Use at least 12 characters for your new password.");
        return;
      }
      if (password !== passwordConfirm) {
        setPending(false);
        setError("The passwords do not match.");
        return;
      }
      const { error: updateError } = await updatePassword(password);
      if (updateError) {
        setPending(false);
        setError(updateError);
        return;
      }
      await signOut();
      setPending(false);
      setPassword("");
      setPasswordConfirm("");
      setMode("signin");
      setNotice("Password updated. Sign in with your new password.");
      await navigate({ to: "/login", search: {}, replace: true });
      return;
    }

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
            {mode === "forgot"
              ? "Reset your password"
              : mode === "reset"
                ? "Choose a new password"
                : "Sign in to OpenFolk"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "forgot"
              ? "We’ll email a secure link to your account address."
              : mode === "reset"
                ? "Use a unique password with at least 12 characters."
                : "Access is invite-only."}
          </p>
        </div>

        <div className="rounded-2xl border border-hairline bg-white p-6 shadow-[var(--shadow-soft)]">
          {!configured && (
            <div className="mb-4 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              Authentication is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
            </div>
          )}

          <form onSubmit={onSubmit} className="space-y-4">
            {mode !== "reset" && (
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
            )}
            {mode !== "forgot" && (
              <div className="space-y-2">
                <Label htmlFor="password">{mode === "reset" ? "New password" : "Password"}</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  minLength={mode === "reset" ? 12 : undefined}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  disabled={pending || !configured}
                />
              </div>
            )}
            {mode === "reset" && (
              <div className="space-y-2">
                <Label htmlFor="password-confirm">Confirm new password</Label>
                <Input
                  id="password-confirm"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  required
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  placeholder="••••••••••••"
                  disabled={pending || !configured}
                />
              </div>
            )}

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
              {pending
                ? "Please wait…"
                : mode === "signup"
                  ? "Create account"
                  : mode === "forgot"
                    ? "Send reset link"
                    : mode === "reset"
                      ? "Update password"
                      : "Sign in"}
            </Button>
          </form>

          {mode === "signin" && (
            <div className="mt-4 text-center text-xs text-muted-foreground">
              <button
                type="button"
                className="underline-offset-4 hover:underline"
                onClick={() => {
                  setMode("forgot");
                  setError(null);
                  setNotice(null);
                }}
              >
                Forgot your password?
              </button>
            </div>
          )}

          {(mode === "forgot" || (mode === "reset" && !session && !loading)) && (
            <div className="mt-4 text-center text-xs text-muted-foreground">
              <button
                type="button"
                className="underline-offset-4 hover:underline"
                onClick={() => {
                  setMode("signin");
                  setError(null);
                  setNotice(null);
                  void navigate({ to: "/login", search: {}, replace: true });
                }}
              >
                Back to sign in
              </button>
            </div>
          )}

          {SIGNUP_ENABLED && (mode === "signin" || mode === "signup") && (
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
