import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Missing or invalid session." }, { status: 401 });

  return NextResponse.json({ id: user.userId, username: user.username });
}
