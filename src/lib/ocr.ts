// Browser-only: runs Tesseract.js against a captured/uploaded receipt photo
// before the receipt exists server-side, so recognizeReceiptText's output
// can prefill ReceiptForm (Session 5, RECEIPTLESS_STATE.md) — nothing to
// upload or authenticate against yet at this point in the flow. Not unit
// tested, same convention as QRScanner.tsx's jsQR usage: a real WASM OCR
// engine isn't something vitest should run, and the actual text-parsing
// logic this feeds (src/lib/receipt-ocr-parser.ts) already is.
import { createWorker } from "tesseract.js";

export async function recognizeReceiptText(file: File): Promise<string> {
  const worker = await createWorker("eng");
  try {
    const {
      data: { text },
    } = await worker.recognize(file);
    return text;
  } finally {
    await worker.terminate();
  }
}
