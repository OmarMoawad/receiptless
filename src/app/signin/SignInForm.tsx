"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

/**
 * Session 10 slice — the sign-in and registration form.
 *
 * Found by the first real human attempt to use the deployed app: the
 * homepage said "Sign in to see your spend", `/receipts` said "Sign in to
 * view your vault", `/api/auth/login` and `/api/auth/register` existed and
 * were covered by tests — and **nothing in the application rendered a
 * form**. There was no way for a person to obtain a session at all.
 *
 * All 219 tests exercise the API directly, which is exactly why none of
 * them noticed. A suite that calls endpoints cannot tell you the endpoints
 * are unreachable from the UI.
 *
 * Deliberately one component for both actions. Registration and sign-in
 * differ here only in which endpoint the same two fields post to, and
 * splitting them across two pages would mean two chances to leave one of
 * them unrendered — which is the failure being fixed.
 */

/** Mirrors auth-service.ts, so the rules are visible before submitting rather than after. */
const USERNAME_RULE = "3–32 characters, starting with a lowercase letter; lowercase letters, digits and underscores only.";
const PASSWORD_RULE = "At least 8 characters.";

type Mode = "signin" | "register";

export function SignInForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(mode === "register" ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        // The API returns a usable message for every case it rejects —
        // taken username, weak password, bad credentials — so show that
        // rather than a generic failure the user cannot act on.
        const body = await response.json().catch(() => null);
        setError(body?.error ?? `Something went wrong (HTTP ${response.status}).`);
        return;
      }

      // The session cookie is set by the response; a refresh is what makes
      // the server components re-render as the signed-in user.
      router.push("/receipts");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 w-full max-w-sm">
      <div className="flex gap-2" role="tablist" aria-label="Sign in or create an account">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "signin"}
          onClick={() => { setMode("signin"); setError(null); }}
          className={`flex-1 rounded px-3 py-2 text-sm ${mode === "signin" ? "bg-emerald-600 text-white" : "bg-neutral-100 text-neutral-700"}`}
        >
          Sign in
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "register"}
          onClick={() => { setMode("register"); setError(null); }}
          className={`flex-1 rounded px-3 py-2 text-sm ${mode === "register" ? "bg-emerald-600 text-white" : "bg-neutral-100 text-neutral-700"}`}
        >
          Create account
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="username" className="text-sm font-medium">Username</label>
        <input
          id="username"
          name="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          required
          className="rounded border border-neutral-300 px-3 py-2"
        />
        {mode === "register" && <p className="text-xs text-neutral-500">{USERNAME_RULE}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-sm font-medium">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          // Tells a password manager to offer a new password on register
          // and the saved one on sign-in, rather than guessing from markup.
          autoComplete={mode === "register" ? "new-password" : "current-password"}
          required
          className="rounded border border-neutral-300 px-3 py-2"
        />
        {mode === "register" && <p className="text-xs text-neutral-500">{PASSWORD_RULE}</p>}
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || !username || !password}
        className="rounded bg-emerald-600 text-white px-4 py-2 text-sm disabled:opacity-50"
      >
        {busy ? "Working…" : mode === "register" ? "Create account" : "Sign in"}
      </button>
    </form>
  );
}
