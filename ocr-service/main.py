# Session 5 follow-up (2026-08-12, RECEIPTLESS_STATE.md): a small,
# self-hosted OCR service wrapping Surya — chosen over PaddleOCR (tried
# first, same day) after PaddlePaddle's official pip binaries crashed on
# this dev machine under both native arm64 (segfault) and emulated amd64
# (illegal instruction) — a real PaddlePaddle/ARM64 compatibility gap, not
# a config issue. Surya is PyTorch-based, and PyTorch has much more mature
# official ARM64 Linux wheels, sidestepping that class of problem.
# Deliberately minimal: one endpoint, one job (recognize text from an
# image), no receipt-specific logic here — that stays in
# receipt-ocr-parser.ts on the Next.js side, unchanged by this swap.
# src/lib/ocr-client.ts is the one caller; nothing else should depend on
# this service's shape directly.
import io

from fastapi import FastAPI, File, HTTPException, UploadFile
from PIL import Image
from surya.model.detection.model import load_model as load_det_model
from surya.model.detection.model import load_processor as load_det_processor
from surya.model.recognition.model import load_model as load_rec_model
from surya.model.recognition.processor import load_processor as load_rec_processor
from surya.ocr import run_ocr

app = FastAPI()

# Loaded once at startup, not per-request — model loading is the
# expensive part. Detection finds text regions; recognition reads the
# text inside each one — Surya splits these into two models, unlike
# PaddleOCR's single combined pipeline.
_det_model = load_det_model()
_det_processor = load_det_processor()
_rec_model = load_rec_model()
_rec_processor = load_rec_processor()


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


def group_into_rows(text_lines, y_overlap_ratio=0.5):
    """
    Surya's own `text_lines` are individually-detected text spans, not
    receipt rows — on a real receipt (item name and its right-aligned
    price separated by a wide gap), Surya returns the name and the price
    as two *separate* lines, sometimes even out of left-to-right order.
    Confirmed 2026-08-12 against a synthetic test receipt: the flat
    newline-joined text broke receipt-ocr-parser.ts entirely (totalMinor
    null, items empty) because its whole heuristic model assumes "item
    name ... price" lives on one line, the way Tesseract.js's raster-order
    text extraction happened to preserve.

    Fixed here, not in the parser: each TextLine's own `.bbox` ([x1, y1,
    x2, y2]) gives real position data Tesseract.js never exposed. Spans
    are greedily clustered into rows by vertical (Y) overlap, then each
    row's spans are sorted left-to-right and joined with generous spacing
    — reconstructing the same "name    price" layout the parser expects,
    from data Surya already computed rather than guessing at layout from
    plain text.
    """
    spans = sorted(text_lines, key=lambda tl: tl.bbox[1])  # top Y, ascending

    rows = []  # each: {"y1": float, "y2": float, "spans": [(x1, text)]}
    for span in spans:
        x1, y1, x2, y2 = span.bbox
        placed_row = None
        for row in rows:
            overlap = min(y2, row["y2"]) - max(y1, row["y1"])
            min_height = min(y2 - y1, row["y2"] - row["y1"])
            if min_height > 0 and overlap / min_height > y_overlap_ratio:
                placed_row = row
                break
        if placed_row is None:
            rows.append({"y1": y1, "y2": y2, "spans": [(x1, span.text)]})
        else:
            placed_row["spans"].append((x1, span.text))
            placed_row["y1"] = min(placed_row["y1"], y1)
            placed_row["y2"] = max(placed_row["y2"], y2)

    rows.sort(key=lambda row: row["y1"])
    lines = []
    for row in rows:
        row["spans"].sort(key=lambda s: s[0])  # left X, ascending
        lines.append("    ".join(text for _, text in row["spans"]))
    return lines


@app.post("/ocr")
async def recognize(file: UploadFile = File(...)) -> dict:
    raw = await file.read()
    try:
        image = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Not a readable image") from exc

    predictions = run_ocr([image], [["en"]], _det_model, _det_processor, _rec_model, _rec_processor)

    # Row-reconstructed, top-to-bottom text — see group_into_rows for why
    # Surya's own line ordering isn't usable as-is. This is the same "raw
    # OCR text" contract Tesseract.js's worker.recognize used to return,
    # so receipt-ocr-parser.ts needs zero further changes on the other
    # side of this swap.
    lines = group_into_rows(predictions[0].text_lines)
    return {"text": "\n".join(lines)}
