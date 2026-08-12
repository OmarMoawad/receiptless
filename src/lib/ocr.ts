// Browser-side: sends a captured/uploaded receipt photo to the server's
// OCR route before the receipt exists (Session 5, RECEIPTLESS_STATE.md) —
// nothing to authenticate against yet at this point in the flow beyond
// the user's own session, which the route itself checks.
//
// Session 5 follow-up (2026-08-12): this used to run Tesseract.js
// entirely client-side via WASM. Switched to a server call because the
// strongest fully open-source OCR engines available (per a benchmark
// check that day) are Python projects with no browser/WASM runtime the
// way tesseract.js has. That's a real architecture change, not a drop-in
// library swap: OCR now runs in a separate, self-hosted service
// (ocr-service/, docker-compose.yml's `ocr` service, running Surya —
// PaddleOCR was tried first, same day, dropped after its official
// binaries crashed on this dev machine; see ocr-service/main.py's header)
// that this function calls over HTTP via the new POST /api/receipts/ocr
// route — see src/lib/ocr-client.ts for the server-side seam that route
// calls through.
export async function recognizeReceiptText(file: File): Promise<string> {
  const formData = new FormData();
  formData.set("file", file);

  const response = await fetch("/api/receipts/ocr", { method: "POST", body: formData });
  const body = (await response.json().catch(() => null)) as { text?: string; error?: string } | null;
  if (!response.ok || typeof body?.text !== "string") {
    throw new Error(body?.error ?? "Could not read text from this photo.");
  }
  return body.text;
}
