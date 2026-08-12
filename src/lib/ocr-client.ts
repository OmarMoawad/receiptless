// The seam api/receipts/ocr/route.ts calls through to reach the real OCR
// engine — mirrors storage.ts's ObjectStorage interface exactly: a real
// implementation (SuryaOcrClient, calling the self-hosted Surya OCR
// service over HTTP) plus an injectable seam so tests get a fake instead
// of needing that service reachable in CI. Surya is a Python project with
// no browser/WASM runtime the way tesseract.js has — this is why OCR
// moved from client-side (Session 5's original Tesseract.js version) to a
// server route calling a self-hosted service (Session 5 follow-up,
// 2026-08-12), not a drop-in library swap. PaddleOCR was tried first,
// same day — dropped after its official binaries crashed on this dev
// machine (see ocr-service/main.py's header for the full story).
export interface OcrClient {
  recognizeText(bytes: Buffer, contentType: string): Promise<string>;
}

export class OcrServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OcrServiceError";
  }
}

const OCR_SERVICE_URL = process.env.OCR_SERVICE_URL ?? "http://localhost:8868";

// Real requests measured 83s-2.6min on this machine's CPU-only inference
// (RECEIPTLESS_STATE.md's Session 5 follow-up) — generous headroom above
// that, but a hard ceiling all the same: without one, a genuinely hung
// service (not just slow) would hold this connection open indefinitely,
// which the calling POST /api/receipts/ocr route has no timeout of its
// own to bound either.
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

export class SuryaOcrClient implements OcrClient {
  async recognizeText(bytes: Buffer, contentType: string): Promise<string> {
    const formData = new FormData();
    formData.set("file", new Blob([Uint8Array.from(bytes)], { type: contentType }), "receipt");

    let response: Response;
    try {
      response = await fetch(`${OCR_SERVICE_URL}/ocr`, {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new OcrServiceError("The OCR service took too long to respond.");
      }
      throw new OcrServiceError("Could not reach the OCR service.");
    }

    const body = (await response.json().catch(() => null)) as { text?: string } | null;
    if (!response.ok || typeof body?.text !== "string") {
      throw new OcrServiceError("The OCR service did not return usable text.");
    }
    return body.text;
  }
}

export const suryaOcrClient: OcrClient = new SuryaOcrClient();

// Test-only injection seam (same convention as storage.ts's
// getObjectStorage/setObjectStorage): production code always calls
// getOcrClient() rather than importing suryaOcrClient directly, so tests
// can install an in-memory fake instead of requiring the real Surya
// service reachable in CI.
let currentClient: OcrClient = suryaOcrClient;

export function getOcrClient(): OcrClient {
  return currentClient;
}

export function setOcrClient(client: OcrClient): void {
  currentClient = client;
}
