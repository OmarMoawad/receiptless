"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import QRScanner from "@/components/QRScanner";
import ReceiptForm, { ReceiptFormValues } from "@/components/ReceiptForm";
import { extractClaimToken, parseInlinePayload } from "@/lib/parseReceipt";

type Mode = "choose" | "qr" | "photo" | "manual";

export default function NewReceiptPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("choose");
  const [initialValues, setInitialValues] =
    useState<Partial<ReceiptFormValues>>();

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

  function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setInitialValues({
        source: "PHOTO",
        imageUrl: reader.result as string,
      });
      setMode("manual");
    };
    reader.readAsDataURL(file);
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

      {mode === "manual" && <ReceiptForm initialValues={initialValues} />}
    </main>
  );
}
