import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { disconnectGmail } from "@/lib/gmail-connection";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const { id } = await context.params;
  const disconnected = await disconnectGmail(id, user.userId);
  if (!disconnected) return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  return NextResponse.json({ status: "disconnected" });
}
