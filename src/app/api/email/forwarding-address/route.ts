import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { formatForwardingAddress, getOrCreateInboundEmailAddress } from "@/lib/inbound-email-address";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const baseAddress = process.env.POSTMARK_INBOUND_ADDRESS;
  if (!baseAddress) {
    return NextResponse.json({ error: "Inbound email is not configured." }, { status: 503 });
  }

  try {
    const { mailboxToken } = await getOrCreateInboundEmailAddress(user.userId);
    return NextResponse.json({ address: formatForwardingAddress(baseAddress, mailboxToken) });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("POSTMARK_INBOUND_ADDRESS")) {
      return NextResponse.json({ error: "Inbound email is not configured." }, { status: 503 });
    }
    throw error;
  }
}
