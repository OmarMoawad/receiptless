// The default pdfkit entry reads built-in font metrics from js/data at
// runtime. Next/Turbopack rewrites that path to /ROOT in a server bundle,
// producing a 500 only in the real app. The standalone distribution embeds
// those metrics and is therefore the server-route-safe entry point.
import PDFDocument from "pdfkit/js/pdfkit.standalone";
import { prisma } from "./db";
import { formatMinorUnits } from "./money";

const CSV_COLUMNS = [
  "receipt_id",
  "purchased_at",
  "merchant",
  "currency",
  "total_minor",
  "subtotal_minor",
  "tax_minor",
  "discount_minor",
  "fee_minor",
  "category",
  "source",
  "verification",
  "notes",
  "item_name",
  "item_quantity",
  "item_unit_price_minor",
  "item_total_minor",
  "warranty_months",
  "return_window_days",
] as const;

export const EXPORT_BATCH_SIZE = 100;

/**
 * How many bytes may sit in a response queue before the producer is
 * asked to stop. Byte-counted rather than chunk-counted, so the limit
 * means the same thing for a one-line CSV row and a rendered PDF page.
 */
export const EXPORT_HIGH_WATER_MARK = 64 * 1024;

type ExportReceipt = Awaited<ReturnType<typeof fetchOwnedReceiptBatch>>[number];

async function fetchOwnedReceiptBatch(ownerId: string, afterId?: string) {
  return prisma.receipt.findMany({
    where: { ownerId },
    include: { merchant: true, items: { orderBy: { id: "asc" } } },
    orderBy: { id: "asc" },
    take: EXPORT_BATCH_SIZE,
    ...(afterId ? { cursor: { id: afterId }, skip: 1 } : {}),
  });
}

export async function* ownedReceiptBatches(ownerId: string) {
  let afterId: string | undefined;
  while (true) {
    const batch = await fetchOwnedReceiptBatch(ownerId, afterId);
    if (batch.length === 0) return;
    yield batch;
    if (batch.length < EXPORT_BATCH_SIZE) return;
    afterId = batch.at(-1)?.id;
  }
}

function spreadsheetSafe(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function csvCell(value: string | number | null | undefined): string {
  const text = spreadsheetSafe(value === null || value === undefined ? "" : String(value));
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function receiptRows(receipt: ExportReceipt): string[] {
  const items = receipt.items.length > 0 ? receipt.items : [null];
  return items.map((item) =>
    [
      receipt.id,
      receipt.purchasedAt.toISOString(),
      receipt.merchant.name,
      receipt.currency,
      receipt.totalMinor,
      receipt.subtotalMinor,
      receipt.taxMinor,
      receipt.discountMinor,
      receipt.feeMinor,
      receipt.category,
      receipt.source,
      receipt.verification,
      receipt.notes,
      item?.name,
      item?.quantity,
      item?.unitPriceMinor,
      item?.totalPriceMinor,
      item?.warrantyMonths,
      item?.returnWindowDays,
    ]
      .map(csvCell)
      .join(","),
  );
}

/**
 * The row source as a plain async generator, kept separate from the
 * stream so that cancelling a download can `return()` it. That runs the
 * generator's own cleanup and, more importantly, stops the batch loop
 * from issuing another query for an export nobody is reading any more.
 */
export async function* csvExportLines(ownerId: string): AsyncGenerator<string, void, undefined> {
  yield `\uFEFF${CSV_COLUMNS.join(",")}\r\n`;
  for await (const batch of ownedReceiptBatches(ownerId)) {
    for (const receipt of batch) {
      for (const row of receiptRows(receipt)) {
        yield `${row}\r\n`;
      }
    }
  }
}

/**
 * `pull`, not `start`. Running the whole export inside `start` walks the
 * vault to completion whether or not anything is reading it, so a slow
 * client turns a streamed export back into a buffered one — just held in
 * the stream's queue instead of an array. `pull` is called only when the
 * queue has room, and a byte-counting strategy makes "room" mean a real
 * 64 KB rather than a single row.
 */
export function csvExportStream(ownerId: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const lines = csvExportLines(ownerId);
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        while ((controller.desiredSize ?? 0) > 0) {
          const next = await lines.next();
          if (next.done) {
            controller.close();
            return;
          }
          controller.enqueue(encoder.encode(next.value));
        }
      },
      async cancel() {
        await lines.return(undefined);
      },
    },
    new ByteLengthQueuingStrategy({ highWaterMark: EXPORT_HIGH_WATER_MARK }),
  );
}

function addArchiveHeader(doc: PDFKit.PDFDocument, title: string, subtitle?: string) {
  doc.fillColor("#047857").font("Helvetica-Bold").fontSize(22).text(title);
  if (subtitle) {
    doc.moveDown(0.25).fillColor("#525252").font("Helvetica").fontSize(9).text(subtitle);
  }
  doc.moveDown(0.75).strokeColor("#a7f3d0").lineWidth(1).moveTo(54, doc.y).lineTo(558, doc.y).stroke();
  doc.moveDown(0.75);
}

function addLabelValue(doc: PDFKit.PDFDocument, label: string, value: string) {
  doc.fillColor("#525252").font("Helvetica-Bold").fontSize(9).text(label.toUpperCase());
  doc.fillColor("#171717").font("Helvetica").fontSize(11).text(value || "-");
  doc.moveDown(0.35);
}

function ensureVerticalSpace(doc: PDFKit.PDFDocument, points: number) {
  if (doc.y + points <= doc.page.height - 54) return;
  doc.addPage();
  addArchiveHeader(doc, "Receiptless archive", "Continued");
}

function addReceiptPage(doc: PDFKit.PDFDocument, receipt: ExportReceipt, receiptNumber: number) {
  doc.addPage();
  addArchiveHeader(
    doc,
    receipt.merchant.name,
    `Receipt ${receiptNumber} - ${receipt.purchasedAt.toISOString().slice(0, 10)}`,
  );

  addLabelValue(doc, "Total", formatMinorUnits(receipt.totalMinor, receipt.currency));
  addLabelValue(doc, "Category", receipt.category);
  addLabelValue(doc, "Source", receipt.source);
  addLabelValue(doc, "Verification", receipt.verification.replaceAll("_", " "));

  if (receipt.subtotalMinor !== null) {
    addLabelValue(doc, "Subtotal", formatMinorUnits(receipt.subtotalMinor, receipt.currency));
  }
  if (receipt.taxMinor !== null) {
    addLabelValue(doc, "Tax", formatMinorUnits(receipt.taxMinor, receipt.currency));
  }
  if (receipt.discountMinor !== null) {
    addLabelValue(doc, "Discount", formatMinorUnits(receipt.discountMinor, receipt.currency));
  }
  if (receipt.feeMinor !== null) {
    addLabelValue(doc, "Fees", formatMinorUnits(receipt.feeMinor, receipt.currency));
  }

  ensureVerticalSpace(doc, 90);
  doc.fillColor("#171717").font("Helvetica-Bold").fontSize(14).text("Items");
  doc.moveDown(0.4);
  if (receipt.items.length === 0) {
    doc.fillColor("#737373").font("Helvetica-Oblique").fontSize(10).text("No line items recorded.");
  } else {
    for (const item of receipt.items) {
      ensureVerticalSpace(doc, 58);
      doc.fillColor("#171717").font("Helvetica-Bold").fontSize(11).text(item.name);
      doc
        .fillColor("#525252")
        .font("Helvetica")
        .fontSize(9)
        .text(
          `${item.quantity} x ${formatMinorUnits(item.unitPriceMinor, receipt.currency)} = ${formatMinorUnits(item.totalPriceMinor, receipt.currency)}`,
        );
      const coverage = [
        item.warrantyMonths === null ? null : `Warranty: ${item.warrantyMonths} months`,
        item.returnWindowDays === null ? null : `Return window: ${item.returnWindowDays} days`,
      ].filter(Boolean);
      if (coverage.length > 0) {
        doc.fillColor("#047857").text(coverage.join(" - "));
      }
      doc.moveDown(0.55);
    }
  }

  if (receipt.notes) {
    ensureVerticalSpace(doc, 72);
    doc.moveDown(0.5).fillColor("#171717").font("Helvetica-Bold").fontSize(14).text("Notes");
    doc.moveDown(0.3).fillColor("#404040").font("Helvetica").fontSize(10).text(receipt.notes);
  }

  /**
   * The footer sits below the bottom margin on purpose, and pdfkit
   * treats anything past `page.maxY()` as an overflow — it opens a fresh
   * page and prints the line there, so every receipt was ending with a
   * blank page carrying nothing but its id. Dropping the bottom margin
   * for the one call is pdfkit's own idiom for a footer; restoring it
   * immediately keeps `ensureVerticalSpace` honest for the next receipt.
   */
  const bottomMargin = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc
    .fillColor("#737373")
    .font("Helvetica")
    .fontSize(8)
    .text(`Receipt ID: ${receipt.id}`, 54, doc.page.height - 38, { align: "right", width: 504 });
  doc.page.margins.bottom = bottomMargin;
}

export function pdfExportStream(ownerId: string): ReadableStream<Uint8Array> {
  let doc: PDFKit.PDFDocument;
  let cancelled = false;
  let releaseBackpressure: (() => void) | null = null;

  /** Resolved by `pull` once the consumer has taken enough to want more. */
  const drained = () =>
    new Promise<void>((resolve) => {
      releaseBackpressure = resolve;
    });

  const wake = () => {
    releaseBackpressure?.();
    releaseBackpressure = null;
  };

  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        doc = new PDFDocument({ autoFirstPage: false, margin: 54, size: "A4" });
        doc.info.Title = "Receiptless receipt archive";
        doc.info.Author = "Receiptless";

        doc.on("data", (chunk: Buffer) => {
          // After a cancel the controller will not accept a chunk, and
          // the throw would land in an event handler with nothing to
          // catch it. pdfkit can emit once more before it stops.
          if (cancelled) return;
          controller.enqueue(new Uint8Array(chunk));
          if ((controller.desiredSize ?? 0) <= 0) doc.pause();
        });
        doc.on("end", () => {
          if (!cancelled) controller.close();
        });
        doc.on("error", (error) => {
          if (!cancelled) controller.error(error);
        });

        void (async () => {
          try {
            let receiptNumber = 0;
            for await (const batch of ownedReceiptBatches(ownerId)) {
              for (const receipt of batch) {
                if (cancelled) return;
                receiptNumber += 1;
                addReceiptPage(doc, receipt, receiptNumber);
                // Pausing the output alone would only move the rest of
                // the archive into pdfkit's own buffer, so the render
                // loop waits with it.
                if (doc.isPaused()) await drained();
              }
            }

            if (cancelled) return;
            if (receiptNumber === 0) {
              doc.addPage();
              addArchiveHeader(doc, "Receiptless archive", `Generated ${new Date().toISOString()}`);
              doc.fillColor("#525252").font("Helvetica").fontSize(11).text("No receipts in this vault.");
            }
            doc.end();
          } catch (error) {
            doc.destroy(error instanceof Error ? error : new Error("PDF export failed"));
          }
        })();
      },
      pull() {
        doc.resume();
        wake();
      },
      cancel() {
        // Order matters: the flag is what the render loop and the event
        // handlers check, so it has to be set before anything is woken.
        cancelled = true;
        wake();
        doc.destroy();
      },
    },
    new ByteLengthQueuingStrategy({ highWaterMark: EXPORT_HIGH_WATER_MARK }),
  );
}
