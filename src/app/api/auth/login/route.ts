import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { setSessionCookie } from "@/lib/auth-cookie";
import { InvalidCredentialsError, login } from "@/lib/auth-service";
import { enforceRateLimit } from "@/lib/rate-limit";

const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (body === null) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "username and password are required" }, { status: 400 });
  }

  /**
   * Before `login`, never after: argon2 verification is the expensive
   * part, and it runs even for a username that does not exist (so the
   * response time cannot be used to enumerate accounts). Rate limiting
   * after it would still let an attacker spend our CPU at will.
   *
   * Two counters — per-IP and per-username. See rate-limit/policy.ts for
   * why the second one is the one that matters, and what it costs.
   */
  const limited = await enforceRateLimit(request, ["auth-login-ip", "auth-login-username"], {
    username: parsed.data.username,
  });
  if (limited) return limited;

  try {
    const session = await login(parsed.data);
    const response = NextResponse.json({ id: session.userId, username: session.username }, { status: 200 });
    setSessionCookie(response, session.sessionToken);
    return response;
  } catch (err) {
    if (err instanceof InvalidCredentialsError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
