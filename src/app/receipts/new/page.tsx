"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import QRScanner from "@/components/QRScanner";
import ReceiptForm, { ReceiptFormValues } from "@/components/ReceiptForm";
import { extractClaimToken, parseInlinePayload } from "@/lib/parseReceipt";
import { recognizeReceiptText } from "@/lib/ocr";
import { parseReceiptText } from "@/lib/receipt-ocr-parser";

type Mode = "choose" | "qr" | "photo" | "manual";

export default function NewReceiptPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("choose");
  const [initialValues, setInitialValues] =
    useState<Partial<ReceiptFormValues>>();
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [ocrSuggested, setOcrSuggested] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);

  const handleDecode = useCallback(
    (payload: string) => {
      const claimToken = extractClaimToken(payload);
      if (claimToken) {
        // Merchant-issued claim link: the receipt already exists
        // server-side, authoritatively — just resolve and claim it.
        router.push(`/claim/${claimToken}`);
        return;
      }

      // Legacy inline payload (no merchant API integration yet): the QR
      // encodes the receipt data directly, so prefill the form for review.
      const parsed = parseInlinePayload(payload);
      setInitialValues({
        merchant: parsed.merchant,
        amount: String(parsed.amount),
        currency: parsed.currency,
        category: parsed.category,
        purchasedAt: parsed.purchasedAt.slice(0, 10),
        source: "QR",
        rawPayload: payload,
      });
      setMode("manual");
    },
    [router]
  );

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Session 4 (RECEIPTLESS_STATE.md): the raw File is kept as-is and
    // uploaded to real object storage after the receipt is created
    // (ReceiptForm), not base64-encoded into an inline data: URL.
    setPhotoFile(file);
    setOcrError(null);
    setOcrSuggested(false);
    setMode("photo");

    // Session 5: OCR runs client-side, against the picked file, before the
    // receipt exists server-side — its output only ever prefills the form
    // below (never auto-submitted), so a failure here just falls back to a
    // blank manual entry instead of blocking the capture flow.
    try {
      const text = await recognizeReceiptText(file);
      const suggestion = parseReceiptText(text);
      const suggested: Partial<ReceiptFormValues> = { source: "PHOTO" };
      if (suggestion.merchant) suggested.merchant = suggestion.merchant;
      if (suggestion.totalMinor !== null) {
        suggested.amount = (suggestion.totalMinor / 100).toFixed(2);
      }
      if (suggestion.currency) suggested.currency = suggestion.currency;
      setInitialValues(suggested);
      setOcrSuggested(Boolean(suggestion.merchant || suggestion.totalMinor !== null));
    } catch {
      setInitialValues({ source: "PHOTO" });
      setOcrError("Could not read this photo automatically — fill in the details below.");
    } finally {
      setMode("manual");
    }
  }

  return (
    <main className="flex flex-col items-center gap-6 p-6">
      <h1 className="text-xl font-semibold">Add a receipt</h1>

      {mode === "choose" && (
        <div className="flex flex-col gap-3 w-full max-w-sm">
          <button
            className="rounded border px-4 py-3 text-left hover:bg-neutral-50 dark:hover:bg-neutral-900"
            onClick={() => setMode("qr")}
          >
            Scan QR code
          </button>
          <label className="rounded border px-4 py-3 text-left cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-900">
            Upload photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handlePhoto}
            />
          </label>
          <button
            className="rounded border px-4 py-3 text-left hover:bg-neutral-50 dark:hover:bg-neutral-900"
            onClick={() => {
              setInitialValues({ source: "MANUAL" });
              setMode("manual");
            }}
          >
            Enter manually
          </button>
        </div>
      )}

      {mode === "qr" && <QRScanner onDecode={handleDecode} />}

      {mode === "photo" && (
        <p className="text-sm text-neutral-500">Reading receipt…</p>
      )}

      {mode === "manual" && (
        <ReceiptForm
          initialValues={initialValues}
          photoFile={photoFile}
          ocrSuggested={ocrSuggested}
          ocrError={ocrError}
        />
      )}
    </main>
  );
}
