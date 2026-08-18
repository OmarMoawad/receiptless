import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { MAX_IMAGE_BYTES, sniffImageContentType } from "@/lib/storage";
import { getOcrClient } from "@/lib/ocr-client";
import { ocrAvailability } from "@/lib/deployment";
import { enforceRateLimit } from "@/lib/rate-limit";

/**
 * Session 5 follow-up (2026-08-12): runs OCR against a picked receipt
 * photo *before* the receipt exists — same "nothing to authenticate
 * against yet" moment as before, but now server-side, so this route only
 * requires a valid session (not receipt ownership; there's no receipt id
 * yet). Session-gating still matters here even though no per-user data is
 * touched: it stops unauthenticated internet traffic from burning compute
 * on a real, non-free-to-run OCR service.
 *
 * Content-type is sniffed from the file's own magic bytes, never trusted
 * from the client, same discipline as the photo-upload route
 * (src/app/api/receipts/[id]/photo/route.ts) — both reuse
 * sniffImageContentType/MAX_IMAGE_BYTES from storage.ts rather than
 * duplicating that logic.
 */
export async function POST(request: NextRequest) {
  // Ahead of the session check on purpose: an unauthenticated flood still
  // costs a session lookup per request, and this is the route whose whole
  // reason for being gated is that the work behind it is expensive.
  const limited = await enforceRateLimit(request, ["receipt-ocr"]);
  if (limited) return limited;

  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  // Review findings #9/#10: say the feature is off, before reading an
  // upload the app has already decided it will not process. A 502 after
  // the user has waited for their photo to upload describes a broken
  // service; this describes a deployment that deliberately does not offer
  // the feature, which is a different thing and the true one.
  const availability = ocrAvailability();
  if (!availability.available) {
    return NextResponse.json({ error: availability.reason, unavailable: true }, { status: 503 });
  }

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
    return NextResponse.json({ error: "File must be a JPEG, PNG, or WEBP image" }, { status: 400 });
  }

  try {
    const text = await getOcrClient().recognizeText(bytes, contentType);
    return NextResponse.json({ text }, { status: 200 });
  } catch {
    // The OCR service being unreachable/erroring is real, expected
    // operational behavior (a separate container that can be down), not a
    // bug in this route — 502 (bad gateway), not 500, and the caller
    // (ReceiptForm's flow) already falls back to a blank manual entry
    // rather than blocking receipt capture on it.
    return NextResponse.json({ error: "OCR service is currently unavailable." }, { status: 502 });
  }
}

/**
 * Whether this deployment offers automatic photo reading. Read by
 * `/receipts/new`'s server component so the capture screen can label the
 * option honestly instead of discovering it at upload time.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  return NextResponse.json(ocrAvailability());
}
