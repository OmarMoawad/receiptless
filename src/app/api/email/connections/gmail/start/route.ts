import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readGmailOAuthConfig, startGmailConnection } from "@/lib/gmail-connection";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const config = readGmailOAuthConfig();
  if (!config) return NextResponse.json({ error: "Gmail scanning is not configured." }, { status: 503 });

  return NextResponse.json(await startGmailConnection(user.userId, config));
}
