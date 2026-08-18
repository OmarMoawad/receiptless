/**
 * Shared guard for the operational scripts that take a DATABASE_URL.
 *
 * These scripts are pointed at production by a human pasting a
 * connection string into a shell, which is a step with a small number of
 * failure modes that all produced the same unreadable Node stack trace:
 * `TypeError: Invalid URL` from deep inside pg-connection-string, with
 * the offending value redacted, and nothing said about what to do.
 *
 * The commonest cause is a password containing `/` or `+`. Those are
 * structural characters in a URL, and `openssl rand -base64` produces
 * them roughly half the time — so the natural way to generate a password
 * yields one that silently cannot be used in a connection string.
 *
 * This reports the shape of the problem without ever printing the value:
 * a connection string is a credential, and a diagnostic that echoes it
 * moves the secret into a terminal scrollback, a screenshot, or a pasted
 * bug report.
 */
export function requireDatabaseUrl(env = process.env) {
  const raw = env.DATABASE_URL;

  if (!raw || !raw.trim()) {
    console.error("DATABASE_URL is required.");
    console.error("If you exported it in another terminal tab, it is not set in this one.");
    process.exit(1);
  }

  const value = raw.trim();

  try {
    const parsed = new URL(value);
    if (!parsed.protocol.startsWith("postgres")) {
      console.error(`DATABASE_URL has scheme "${parsed.protocol}" — expected postgres:// or postgresql://.`);
      process.exit(1);
    }
    return value;
  } catch {
    // Everything below describes the string without revealing it.
    console.error("DATABASE_URL is not a valid connection string. Nothing was sent anywhere.\n");
    console.error(`  length:            ${value.length} characters`);
    console.error(`  starts with:       ${JSON.stringify(value.slice(0, 13))}`);
    console.error(`  contains '@':      ${value.includes("@")}`);
    console.error(`  contains spaces:   ${/\s/.test(value)}`);
    console.error(`  wrapped in quotes: ${/^["']|["']$/.test(value)}`);

    const afterScheme = value.slice(value.indexOf("//") + 2);
    const credentials = afterScheme.slice(0, afterScheme.lastIndexOf("@"));
    if (/[/+]/.test(credentials)) {
      console.error("\n  >> The username or password contains '/' or '+'.");
      console.error("     Those are structural characters in a URL, so the string cannot parse.");
      console.error("     This is what `openssl rand -base64` produces about half the time.");
      console.error("     Use a hex password instead — `openssl rand -hex 24` — or percent-encode it");
      console.error("     ('/' becomes %2F, '+' becomes %2B).");
    }

    console.error("\nExpected shape:");
    console.error("  postgresql://ROLE:PASSWORD@HOST/DATABASE?sslmode=require");
    process.exit(1);
  }
}
