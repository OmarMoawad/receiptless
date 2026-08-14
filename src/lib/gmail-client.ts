/**
 * Session 9: the narrow slice of Gmail's API this repo needs, behind an
 * interface so tests never touch the network.
 *
 * Scope is `gmail.readonly` only — receiptless reads mail to find
 * receipts, and must never be able to send, modify, or delete anything.
 */
export type GmailMessage = {
  id: string;
  from: string;
  subject: string | null;
  /** RFC 2822 Date header, verbatim; may be absent or unparseable. */
  date: string | null;
  /** Best available body text, HTML already flattened by the client. */
  bodyText: string;
};

export type GmailApiClient = {
  listReceiptMessageIds: (accessToken: string, options: { after?: Date; max: number }) => Promise<string[]>;
  getMessage: (accessToken: string, id: string) => Promise<GmailMessage>;
  getProfile: (accessToken: string) => Promise<{ emailAddress: string }>;
  exchangeCode: (code: string, codeVerifier: string) => Promise<OAuthTokenResponse>;
  refresh: (refreshToken: string) => Promise<OAuthTokenResponse>;
};

export type OAuthTokenResponse = {
  accessToken: string;
  /** Google omits this on refresh unless it rotates the token. */
  refreshToken?: string;
  expiresInSeconds: number;
};

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

/**
 * Gmail's own search syntax, used to let Google do the first pass of
 * filtering rather than pulling an entire mailbox across the network and
 * discarding most of it locally. Deliberately broad — the format adapters
 * (receipt-adapters/) are the real filter, and a message that reaches them
 * and parses to nothing is cheap; a receipt this query excludes is
 * invisible forever.
 */
export const RECEIPT_QUERY =
  "(receipt OR invoice OR \"order confirmation\" OR \"your order\" OR \"payment received\" OR \"tax invoice\") -in:chats";

function headerValue(headers: Array<{ name?: string; value?: string }>, name: string): string | null {
  return headers.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
}

/**
 * Walks Gmail's nested MIME parts for the best body. Prefers text/plain;
 * falls back to text/html, which the caller flattens. Gmail nests
 * multipart/alternative inside multipart/mixed routinely, so this recurses
 * rather than checking only the top level.
 */
function extractBody(payload: unknown): { text: string; html: string } {
  const out = { text: "", html: "" };
  const visit = (part: unknown): void => {
    if (typeof part !== "object" || part === null) return;
    const node = part as { mimeType?: string; body?: { data?: string }; parts?: unknown[] };
    const data = node.body?.data;
    if (data) {
      const decoded = Buffer.from(data, "base64url").toString("utf8");
      if (node.mimeType === "text/plain" && !out.text) out.text = decoded;
      if (node.mimeType === "text/html" && !out.html) out.html = decoded;
    }
    for (const child of node.parts ?? []) visit(child);
  };
  visit(payload);
  return out;
}

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

async function googleJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  if (!response.ok) {
    // The body can contain the access token on some error shapes, so only
    // the status is surfaced.
    throw new Error(`Google API request failed with status ${response.status}`);
  }
  return response.json();
}

export function createRealGmailApiClient(config: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  htmlToText: (html: string) => string;
}): GmailApiClient {
  const authHeader = (accessToken: string) => ({ authorization: `Bearer ${accessToken}` });

  async function token(body: Record<string, string>): Promise<OAuthTokenResponse> {
    const payload = (await googleJson(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    })) as { access_token?: string; refresh_token?: string; expires_in?: number };

    if (!payload.access_token || typeof payload.expires_in !== "number") {
      throw new Error("Google returned no usable access token.");
    }
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresInSeconds: payload.expires_in,
    };
  }

  return {
    exchangeCode: (code, codeVerifier) =>
      token({
        code,
        code_verifier: codeVerifier,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: "authorization_code",
      }),

    refresh: (refreshToken) =>
      token({
        refresh_token: refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "refresh_token",
      }),

    async getProfile(accessToken) {
      const profile = (await googleJson(`${GMAIL_API}/users/me/profile`, { headers: authHeader(accessToken) })) as {
        emailAddress?: string;
      };
      if (!profile.emailAddress) throw new Error("Gmail profile response had no email address.");
      return { emailAddress: profile.emailAddress };
    },

    async listReceiptMessageIds(accessToken, options) {
      // Gmail's `after:` takes whole seconds since the epoch.
      const query = options.after
        ? `${RECEIPT_QUERY} after:${Math.floor(options.after.getTime() / 1000)}`
        : RECEIPT_QUERY;
      const url = `${GMAIL_API}/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${options.max}`;
      const listed = (await googleJson(url, { headers: authHeader(accessToken) })) as {
        messages?: Array<{ id?: string }>;
      };
      return (listed.messages ?? []).map((message) => message.id).filter((id): id is string => Boolean(id));
    },

    async getMessage(accessToken, id) {
      const message = (await googleJson(`${GMAIL_API}/users/me/messages/${id}?format=full`, {
        headers: authHeader(accessToken),
      })) as { id?: string; payload?: { headers?: Array<{ name?: string; value?: string }> } };

      const headers = message.payload?.headers ?? [];
      const body = extractBody(message.payload);
      return {
        id: message.id ?? id,
        from: headerValue(headers, "From") ?? "",
        subject: headerValue(headers, "Subject"),
        date: headerValue(headers, "Date"),
        bodyText: body.text.trim() ? body.text : config.htmlToText(body.html),
      };
    },
  };
}
