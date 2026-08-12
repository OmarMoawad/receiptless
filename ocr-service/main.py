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
import asyncio
import io

from fastapi import FastAPI, File, HTTPException, UploadFile
from PIL import Image
from surya.model.detection.model import load_model as load_det_model
from surya.model.detection.model import load_processor as load_det_processor
from surya.model.recognition.model import load_model as load_rec_model
from surya.model.recognition.processor import load_processor as load_rec_processor
from surya.ocr import run_ocr

from row_grouping import Span, group_into_rows

app = FastAPI()

# Loaded once at startup, not per-request — model loading is the
# expensive part. Detection finds text regions; recognition reads the
# text inside each one — Surya splits these into two models, unlike
# PaddleOCR's single combined pipeline.
_det_model = load_det_model()
_det_processor = load_det_processor()
_rec_model = load_rec_model()
_rec_processor = load_rec_processor()

# Independent validation at this service's own boundary — the Next.js
# route (POST /api/receipts/ocr) already enforces size/content-type
# before forwarding here, but this service is a separate process reachable
# on its own (loopback-only per docker-compose.yml, but still a distinct
# trust boundary, flagged in a 2026-08-12 review) and shouldn't assume its
# only caller is that route.
MAX_REQUEST_BYTES = 8 * 1024 * 1024  # matches src/lib/storage.ts's MAX_IMAGE_BYTES
# A receipt photo doesn't need to be huge — this is deliberately far below
# Pillow's own built-in decompression-bomb ceiling (Image.MAX_IMAGE_PIXELS,
# ~178 million pixels by default), both to fail fast on a hostile/malformed
# upload and to bound how much memory/CPU one request can force this
# CPU-only inference service to spend.
MAX_IMAGE_PIXELS = 20_000_000  # ~20 megapixels, generous for any real photo
ACCEPTED_FORMATS = {"JPEG", "PNG", "WEBP"}  # matches storage.ts's accepted set

# A single global concurrency limit, not a full job queue — inference is
# CPU-bound and already slow (1-3 minutes measured on this dev machine,
# RECEIPTLESS_STATE.md); letting multiple requests run inference
# simultaneously would just make all of them slower and risk OOM under
# real memory pressure, not actually parallelize meaningfully on limited
# CPU cores. Requests queue behind this rather than being rejected. A real
# production deployment needs more than this (an actual async job queue
# with a job id/polling contract, not a synchronous held-open HTTP
# request) — flagged, not built here; see RECEIPTLESS_STATE.md.
_inference_semaphore = asyncio.Semaphore(1)

# surya's run_ocr is a plain blocking call, not an async one — awaiting it
# directly (even inside `async with _inference_semaphore`) would block
# FastAPI's single event loop for the full 1-3 minutes, leaving even
# /health unable to respond and making the semaphore itself pointless
# (nothing else can run to reach it while blocked). Running it in a
# worker thread instead keeps the event loop free.
def _run_ocr_blocking(image):
    return run_ocr([image], [["en"]], _det_model, _det_processor, _rec_model, _rec_processor)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/ocr")
async def recognize(file: UploadFile = File(...)) -> dict:
    raw = await file.read()
    if len(raw) > MAX_REQUEST_BYTES:
        raise HTTPException(status_code=413, detail="Image too large")

    try:
        image = Image.open(io.BytesIO(raw))
        image.verify()  # cheap structural check before the real (heavier) load below
        image = Image.open(io.BytesIO(raw))  # verify() consumes the parser; reopen to actually use it
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Not a readable image") from exc

    if image.format not in ACCEPTED_FORMATS:
        raise HTTPException(status_code=400, detail="Image must be JPEG, PNG, or WEBP")
    if image.width * image.height > MAX_IMAGE_PIXELS:
        raise HTTPException(status_code=400, detail="Image dimensions too large")

    image = image.convert("RGB")

    async with _inference_semaphore:
        loop = asyncio.get_running_loop()
        predictions = await loop.run_in_executor(None, _run_ocr_blocking, image)

    # Row-reconstructed, top-to-bottom text — see row_grouping.py for why
    # Surya's own line ordering isn't usable as-is. This is the same "raw
    # OCR text" contract Tesseract.js's worker.recognize used to return,
    # so receipt-ocr-parser.ts needs zero further changes on the other
    # side of this swap.
    spans = [Span(line.bbox, line.text) for line in predictions[0].text_lines]
    lines = group_into_rows(spans)
    return {"text": "\n".join(lines)}
