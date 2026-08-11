import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  MAX_IMAGE_BYTES,
  getObjectStorage,
  receiptImageKey,
  sniffImageContentType,
} from "@/lib/storage";

/**
 * Uploads (or replaces) a receipt's photo — Session 4 (RECEIPTLESS_STATE.md).
 * Looking the receipt up scoped by `ownerId` is what makes this
 * tenant-isolated: Alice can never upload onto Bob's receipt even if she
 * guesses his receipt id, because the lookup below simply won't find it
 * under her session. The object key itself is derived entirely from the
 * authenticated `userId` server-side (`receiptImageKey`) — a client can
 * never choose or influence it.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const { id } = await params;
  const receipt = await prisma.receipt.findFirst({ where: { id, ownerId: user.userId } });
  if (!receipt) return NextResponse.json({ error: "Receipt not found" }, { status: 404 });

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "Expected a multipart 'file' field" }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "Image too large" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const contentType = sniffImageContentType(bytes);
  if (!contentType) {
    return NextResponse.json(
      { error: "File must be a JPEG, PNG, or WEBP image" },
      { status: 400 }
    );
  }

  const storage = getObjectStorage();
  const key = receiptImageKey(user.userId, contentType);

  await storage.put(key, bytes, contentType);

  try {
    await prisma.receipt.update({ where: { id: receipt.id }, data: { imageKey: key } });
  } catch (err) {
    // Don't orphan the object we just uploaded if the DB write that was
    // supposed to reference it never lands.
    await storage.delete(key).catch(() => {});
    throw err;
  }

  // Replacing an existing photo — clean up the old object now that the new
  // one is safely referenced, so storage doesn't accumulate orphans.
  if (receipt.imageKey && receipt.imageKey !== key) {
    await storage.delete(receipt.imageKey).catch(() => {});
  }

  return NextResponse.json({ imageKey: key }, { status: 200 });
}

/**
 * Redirects to a short-lived signed URL for the receipt's photo. The
 * bucket itself is never public — every fetch goes through this
 * ownership-scoped lookup first, so a leaked/guessed object key alone is
 * never enough to read another user's receipt image (see
 * src/lib/storage.ts's `getSignedUrl`).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const { id } = await params;
  const receipt = await prisma.receipt.findFirst({ where: { id, ownerId: user.userId } });
  if (!receipt) return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  if (!receipt.imageKey) return NextResponse.json({ error: "No photo on this receipt" }, { status: 404 });

  const url = await getObjectStorage().getSignedUrl(receipt.imageKey);
  return NextResponse.redirect(url, { status: 307 });
}
