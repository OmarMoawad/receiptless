import { prisma } from "@/lib/db";

export class UsernameTakenError extends Error {
  constructor(username: string) {
    super(`Username "${username}" is already taken.`);
    this.name = "UsernameTakenError";
  }
}

function isUniqueConstraintViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";
}

export type NewUser = { username: string; passwordHash: string };

export async function createUser(input: NewUser): Promise<{ id: string; username: string }> {
  try {
    const user = await prisma.user.create({ data: input });
    return { id: user.id, username: user.username };
  } catch (err) {
    if (isUniqueConstraintViolation(err)) throw new UsernameTakenError(input.username);
    throw err;
  }
}

export type UserByUsername = { id: string; username: string; passwordHash: string };

export async function findUserByUsername(username: string): Promise<UserByUsername | null> {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) return null;
  return { id: user.id, username: user.username, passwordHash: user.passwordHash };
}

export async function insertSession(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void> {
  await prisma.session.create({ data: input });
}

export type ActiveSession = { sessionId: string; userId: string; username: string };

export async function findActiveSessionByTokenHash(tokenHash: string): Promise<ActiveSession | null> {
  const session = await prisma.session.findFirst({
    where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
    include: { user: true },
  });
  if (!session) return null;
  return { sessionId: session.id, userId: session.userId, username: session.user.username };
}

export async function revokeSessionByTokenHash(tokenHash: string): Promise<void> {
  await prisma.session.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
