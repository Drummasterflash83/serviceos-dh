/**
 * Auth foundation (Auth-0) — Supabase email/password.
 *
 * `AuthProvider` tracks the Supabase session client-side and exposes it via
 * `useAuth`. `RequireAuth` guards a subtree, redirecting unauthenticated users
 * to `/login`. All Supabase interaction happens in effects / handlers, so
 * nothing touches browser storage during SSR (initial render is `loading`).
 *
 * Access control is invite-only: this module provides sign-in / sign-out only.
 * Sign-up is gated behind `VITE_ENABLE_SIGNUP` and handled on the login page.
 */

import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";

import { getSupabaseClient, isSupabaseConfigured } from "./supabase";
import type { Profile } from "./types";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  /** The signed-in user's profile row (role/tenant), when available. */
  profile: Profile | null;
  /** True until the initial session check resolves. */
  loading: boolean;
  /** Access-token expiry (ms epoch), or null — for diagnostics / near-expiry UI. */
  sessionExpiresAt: number | null;
  /** False when VITE_SUPABASE_* are not set. */
  configured: boolean;
  signInWithPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  signUpWithPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const configured = isSupabaseConfigured();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  // Track the session (client only — effects never run during SSR).
  //
  // Root-cause fix for "keeps logging out": the listener must NEVER drop a known-good
  // session because of a transient null. Supabase fires onAuthStateChange for TOKEN_REFRESHED
  // / USER_UPDATED / INITIAL_SESSION (all carry a valid session) and SIGNED_OUT (genuine
  // logout). Only SIGNED_OUT clears the session; a null arriving on any other event is a
  // refresh/hydration race and is ignored (previous session kept). All callbacks are guarded
  // by `mounted` so a late event after unmount can't flip auth state.
  useEffect(() => {
    if (!configured) {
      setLoading(false);
      return;
    }
    const supabase = getSupabaseClient();
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return;
      if (import.meta.env.DEV) {
        // Temporary diagnostics — surfaces the real event sequence behind auth issues.
        console.debug("[auth]", event, nextSession ? "session" : "no-session");
      }
      setSession((prev) => (event === "SIGNED_OUT" ? null : (nextSession ?? prev)));
      setLoading(false);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [configured]);

  // Load the profile row (role/tenant) for the signed-in user, best-effort.
  const userId = session?.user?.id ?? null;
  useEffect(() => {
    if (!configured || !userId) {
      setProfile(null);
      return;
    }
    const supabase = getSupabaseClient();
    let mounted = true;
    supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (mounted) setProfile((data as Profile) ?? null);
      });
    return () => {
      mounted = false;
    };
  }, [configured, userId]);

  const signInWithPassword = useCallback(
    async (email: string, password: string): Promise<{ error: string | null }> => {
      if (!configured) return { error: "Supabase is not configured" };
      const supabase = getSupabaseClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error?.message ?? null };
    },
    [configured],
  );

  const signUpWithPassword = useCallback(
    async (email: string, password: string): Promise<{ error: string | null }> => {
      if (!configured) return { error: "Supabase is not configured" };
      const supabase = getSupabaseClient();
      const { error } = await supabase.auth.signUp({ email, password });
      return { error: error?.message ?? null };
    },
    [configured],
  );

  const signOut = useCallback(async () => {
    if (!configured) return;
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
  }, [configured]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      sessionExpiresAt: session?.expires_at ? session.expires_at * 1000 : null,
      configured,
      signInWithPassword,
      signUpWithPassword,
      signOut,
    }),
    [session, profile, loading, configured, signInWithPassword, signUpWithPassword, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an <AuthProvider>");
  return ctx;
}

function AuthLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="h-2 w-2 animate-pulse rounded-full bg-foreground" />
        Loading…
      </div>
    </div>
  );
}

/**
 * Guard a subtree: while the session resolves, render a neutral loading state;
 * if unauthenticated, redirect to `/login` (preserving where the user was
 * headed). Renders children only for an authenticated session.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (!loading && !session) {
      navigate({ to: "/login", search: { redirect: pathname }, replace: true });
    }
  }, [loading, session, navigate, pathname]);

  if (loading || !session) return <AuthLoading />;
  return <>{children}</>;
}
