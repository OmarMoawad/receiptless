import type { OcrClient } from "@/lib/ocr-client";

/**
 * In-memory OcrClient double for tests — mirrors FakeObjectStorage's role
 * for MinIO: route tests exercise the real request/response and real
 * Postgres, but swap the one genuinely external dependency (the
 * self-hosted Surya OCR service) for a fake, so CI doesn't need that
 * service reachable. Real Surya is exercised manually against the
 * running docker-compose service instead.
 */
export class FakeOcrClient implements OcrClient {
  nextText: string | Error = "";
  recognizeTextCalls: { bytes: Buffer; contentType: string }[] = [];

  async recognizeText(bytes: Buffer, contentType: string): Promise<string> {
    this.recognizeTextCalls.push({ bytes, contentType });
    if (this.nextText instanceof Error) throw this.nextText;
    return this.nextText;
  }
}
