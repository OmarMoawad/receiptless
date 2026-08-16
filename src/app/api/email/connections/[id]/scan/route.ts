import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createConfiguredGmailApiClient } from "@/lib/gmail-api-client";
import { scanGmailConnection } from "@/lib/gmail-scan";
import { enforceRateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const limited = await enforceRateLimit(request, ["provider-sync"]);
  if (limited) return limited;

  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const apiClient = createConfiguredGmailApiClient();
  if (!apiClient) return NextResponse.json({ error: "Gmail scanning is not configured." }, { status: 503 });

  const { id } = await context.params;
  // Ownership is enforced inside the scan (it looks the connection up by
  // id *and* userId), so another user's connection reads as not-connected
  // rather than being distinguishable from one that exists.
  const result = await scanGmailConnection(id, user.userId, apiClient);
  if (result.status === "not-connected") {
    return NextResponse.json({ error: "Connection is not available for scanning." }, { status: 409 });
  }
  return NextResponse.json(result);
}
