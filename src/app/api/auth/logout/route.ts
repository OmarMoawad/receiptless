import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth-cookie";
import { logout } from "@/lib/auth-service";
import { SESSION_COOKIE_NAME } from "@/lib/session";

export async function POST(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (token) await logout(token);

  const response = new NextResponse(null, { status: 204 });
  clearSessionCookie(response);
  return response;
}
