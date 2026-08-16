import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { setSessionCookie } from "@/lib/auth-cookie";
import { InvalidUsernameError, UsernameTakenError, WeakPasswordError, register } from "@/lib/auth-service";
import { enforceRateLimit } from "@/lib/rate-limit";

const registerSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (body === null) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "username and password are required", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // Before `register`, which hashes with argon2 — same reasoning as the
  // login route. Per-IP only: there is no account yet to key on, and a
  // per-username counter here would let anyone reserve a name they do
  // not own by failing against it.
  const limited = await enforceRateLimit(request, ["auth-register"]);
  if (limited) return limited;

  try {
    const session = await register(parsed.data);
    const response = NextResponse.json({ id: session.userId, username: session.username }, { status: 201 });
    setSessionCookie(response, session.sessionToken);
    return response;
  } catch (err) {
    if (err instanceof InvalidUsernameError || err instanceof WeakPasswordError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof UsernameTakenError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
