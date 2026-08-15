"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

/**
 * Session 10 slice — the Gmail connection UI.
 *
 * The second instance of the same bug as the sign-in form, found the same
 * way: by a person trying to use the deployed application. Session 9 built
 * the whole Gmail OAuth path — PKCE, encrypted token storage, refresh with
 * a buffer, per-message failure isolation, disconnect that deletes token
 * material — and covered it with tests. **Nothing rendered any of it.**
 * There was not one occurrence of the string "gmail" in any component.
 *
 * The callback even redirects to `/receipts?gmail=connected|failed|
 * unconfigured`, and no code read that parameter, so the outcome of the
 * consent flow was invisible whichever way it went.
 *
 * Same root cause as before: every test calls the API directly, so the
 * suite is structurally incapable of noticing that no user can reach it.
 */

type Connection = {
  id: string;
  provider: string;
  status: string;
  providerAccountEmail: string | null;
  lastScannedAt: string | null;
  createdAt: string;
};

type ScanResult = {
  status: string;
  messagesSeen?: number;
  receiptsCreated?: number;
  duplicates?: number;
  unparseable?: number;
  failures?: number;
};

/** The callback's own redirect vocabulary — see the gmail/callback route. */
const CALLBACK_MESSAGES: Record<string, { tone: "ok" | "error"; text: string }> = {
  connected: { tone: "ok", text: "Gmail connected. Scan to import receipts." },
  // Distinguished so each says something the user can act on. They were
  // one message ("the link may have expired") that guessed at the cause,
  // which is unhelpful when the real cause was a server-side token
  // exchange failure the app had already discarded.
  expired: { tone: "error", text: "That connection link had already been used or expired. Click Connect Gmail to start again." },
  denied: { tone: "error", text: "Google did not grant access. If you declined, try again and approve the read-only permission." },
  failed: { tone: "error", text: "Gmail connection failed on our side. The error has been reported — check Sentry for the cause." },
  unconfigured: { tone: "error", text: "Gmail scanning is not configured on this deployment." },
};

export function GmailConnections() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);

  const callbackResult = searchParams.get("gmail");
  const callbackMessage = callbackResult ? CALLBACK_MESSAGES[callbackResult] : null;

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/email/connections");
      if (!response.ok) return;
      const body = await response.json();
      setConnections(body.connections ?? []);
    } catch {
      // A listing failure is not worth an alarm on its own; the actions
      // below report their own errors when they fail.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function connect() {
    setBusy("connect");
    setError(null);
    try {
      // POST, not a link: starting an OAuth flow should not be something a
      // cross-site GET can trigger.
      const response = await fetch("/api/email/connections/gmail/start", { method: "POST" });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.error ?? `Could not start the connection (HTTP ${response.status}).`);
        return;
      }
      // Hand the browser to Google.
      window.location.href = body.authorizationUrl;
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  async function runScan(id: string) {
    setBusy(id);
    setError(null);
    setScan(null);
    try {
      const response = await fetch(`/api/email/connections/${id}/scan`, { method: "POST" });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.error ?? `Scan failed (HTTP ${response.status}).`);
        return;
      }
      setScan(body);
      await load();
      // New receipts are rendered by a server component, so the page has to
      // re-fetch to show them.
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(id: string) {
    setBusy(id);
    setError(null);
    try {
      const response = await fetch(`/api/email/connections/${id}/disconnect`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error ?? `Could not disconnect (HTTP ${response.status}).`);
        return;
      }
      await load();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  const gmail = connections?.filter((connection) => connection.provider === "gmail") ?? [];

  return (
    <section className="rounded border border-neutral-200 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-medium">Gmail</h2>
          <p className="text-sm text-neutral-500">
            Read-only access, used to find receipts. receiptless never sends mail.
          </p>
          {/*
            Google expires refresh tokens after 7 days while an app's
            consent screen is in "Testing". Stated here because the failure
            is otherwise silent and a week later — the connection simply
            stops working with no user-visible cause.
          */}
          <p className="text-xs text-neutral-500">
            This app is unverified with Google, so connections expire after 7 days and need reconnecting.
          </p>
        </div>
        <button
          onClick={connect}
          disabled={busy === "connect"}
          className="rounded bg-emerald-600 text-white px-4 py-2 text-sm disabled:opacity-50"
        >
          {busy === "connect" ? "Starting…" : gmail.length > 0 ? "Connect another account" : "Connect Gmail"}
        </button>
      </div>

      {callbackMessage && (
        <p
          role="status"
          className={`text-sm rounded px-3 py-2 border ${
            callbackMessage.tone === "ok"
              ? "text-emerald-800 bg-emerald-50 border-emerald-200"
              : "text-red-700 bg-red-50 border-red-200"
          }`}
        >
          {callbackMessage.text}
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      {gmail.length > 0 && (
        <ul className="flex flex-col gap-2">
          {gmail.map((connection) => (
            <li key={connection.id} className="flex items-center justify-between gap-3 flex-wrap border-t pt-2">
              <div className="text-sm">
                <div className="font-medium">{connection.providerAccountEmail ?? "Gmail account"}</div>
                <div className="text-neutral-500">
                  {connection.status}
                  {connection.lastScannedAt
                    ? ` · last scanned ${new Date(connection.lastScannedAt).toLocaleString()}`
                    : " · never scanned"}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => runScan(connection.id)}
                  disabled={busy === connection.id}
                  className="rounded bg-neutral-800 text-white px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  {busy === connection.id ? "Scanning…" : "Scan now"}
                </button>
                <button
                  onClick={() => disconnect(connection.id)}
                  disabled={busy === connection.id}
                  className="rounded border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  Disconnect
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {scan && (
        // Reports duplicates and failures, not just successes — a scan that
        // silently skipped half a mailbox should not read as a clean run.
        <p role="status" className="text-sm text-neutral-700 bg-neutral-50 border border-neutral-200 rounded px-3 py-2">
          Scanned {scan.messagesSeen ?? 0} message(s): {scan.receiptsCreated ?? 0} receipt(s) imported,{" "}
          {scan.duplicates ?? 0} already known, {scan.unparseable ?? 0} not recognised as receipts,{" "}
          {scan.failures ?? 0} failed.
        </p>
      )}
    </section>
  );
}
