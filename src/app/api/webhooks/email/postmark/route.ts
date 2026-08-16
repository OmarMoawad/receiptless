import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ingestInboundEmail } from "@/lib/inbound-email-ingestion";
import { normalizePostmarkInbound } from "@/lib/postmark-inbound";
import { enforceRateLimit } from "@/lib/rate-limit";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function hasValidBasicAuth(request: NextRequest, username: string, password: string): boolean {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return false;
  let supplied: string;
  try {
    supplied = Buffer.from(header.slice(6), "base64").toString("utf8");
  } catch {
    return false;
  }
  return timingSafeEqual(digest(supplied), digest(`${username}:${password}`));
}

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, ["inbound-email"]);
  if (limited) return limited;

  const username = process.env.POSTMARK_WEBHOOK_USERNAME;
  const password = process.env.POSTMARK_WEBHOOK_PASSWORD;
  if (!username || !password) {
    return NextResponse.json({ error: "Inbound email is not configured." }, { status: 503 });
  }
  if (!hasValidBasicAuth(request, username, password)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (body === null) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  let email: ReturnType<typeof normalizePostmarkInbound>;
  try {
    email = normalizePostmarkInbound(body);
  } catch {
    return NextResponse.json({ error: "Invalid inbound email payload" }, { status: 400 });
  }

  try {
    const result = await ingestInboundEmail(email);
    if (result.status === "created") return NextResponse.json(result, { status: 201 });
    if (result.status === "duplicate") return NextResponse.json({ status: "duplicate" });
    return NextResponse.json({ status: "ignored" });
  } catch {
    // A transient failure (e.g. the database) — 500 so Postmark retries the
    // delivery, distinct from a permanently malformed payload (400 above).
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
