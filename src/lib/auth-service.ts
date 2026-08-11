import { hashPassword, verifyPassword } from "./password";
import { SESSION_TTL_MS, generateSessionToken, hashSessionToken } from "./session";
import {
  UsernameTakenError,
  createUser,
  findActiveSessionByTokenHash,
  findUserByUsername,
  insertSession,
  revokeSessionByTokenHash,
} from "./auth-store";

export { UsernameTakenError };

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Invalid username or password.");
    this.name = "InvalidCredentialsError";
  }
}

export class InvalidUsernameError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "InvalidUsernameError";
  }
}

export class WeakPasswordError extends Error {
  constructor() {
    super("Password must be at least 8 characters.");
    this.name = "WeakPasswordError";
  }
}

const USERNAME_PATTERN = /^[a-z][a-z0-9_]{2,31}$/;

export function assertValidUsername(username: string): void {
  if (!USERNAME_PATTERN.test(username)) {
    throw new InvalidUsernameError(
      "Username must be 3-32 characters, start with a lowercase letter, and contain only lowercase letters, digits, and underscores.",
    );
  }
}

function assertValidPassword(password: string): void {
  if (password.length < 8) throw new WeakPasswordError();
}

// Verified against on a username that doesn't exist, so "no such user" and
// "wrong password" cost the same wall-clock time and can't be told apart by
// an attacker probing for valid usernames. Computed once, lazily, not at
// module load, so importing this module never pays a scrypt hash for free.
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  if (!dummyHash) dummyHash = hashPassword("timing-safety-placeholder-never-a-real-password");
  return dummyHash;
}

export type Session = {
  userId: string;
  username: string;
  sessionToken: string;
  expiresAt: Date;
};

export async function issueSession(userId: string, username: string): Promise<Session> {
  const sessionToken = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await insertSession({ userId, tokenHash: hashSessionToken(sessionToken), expiresAt });
  return { userId, username, sessionToken, expiresAt };
}

export async function register(input: { username: string; password: string }): Promise<Session> {
  assertValidUsername(input.username);
  assertValidPassword(input.password);

  const passwordHash = await hashPassword(input.password);
  const { id } = await createUser({ username: input.username, passwordHash });
  return issueSession(id, input.username);
}

export async function login(input: { username: string; password: string }): Promise<Session> {
  const record = await findUserByUsername(input.username);
  const passwordHash = record?.passwordHash ?? (await getDummyHash());
  const valid = await verifyPassword(input.password, passwordHash);

  if (!record || !valid) throw new InvalidCredentialsError();
  return issueSession(record.id, record.username);
}

export type AuthenticatedUser = {
  sessionId: string;
  userId: string;
  username: string;
};

export async function validateSession(sessionToken: string): Promise<AuthenticatedUser | null> {
  return findActiveSessionByTokenHash(hashSessionToken(sessionToken));
}

export async function logout(sessionToken: string): Promise<void> {
  await revokeSessionByTokenHash(hashSessionToken(sessionToken));
}
