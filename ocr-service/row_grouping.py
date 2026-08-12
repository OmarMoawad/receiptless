# Session 5 follow-up (2026-08-12, RECEIPTLESS_STATE.md): pure row-
# reconstruction logic, deliberately split out of main.py so it's
# unit-testable without loading Surya's models (a real gap flagged in a
# 2026-08-12 review — this file has zero ML dependencies, importable and
# testable in milliseconds).
#
# Surya's own detected text spans are individually-positioned, not
# receipt rows — on a real receipt (item name and its right-aligned price
# separated by a wide gap), Surya returns the name and the price as two
# *separate* spans, sometimes even out of left-to-right order. Confirmed
# against a synthetic test receipt: the flat newline-joined text broke
# receipt-ocr-parser.ts entirely (totalMinor null, items empty) because
# its whole heuristic model assumes "item name ... price" lives on one
# line, the way Tesseract.js's raster-order text extraction happened to
# preserve.
#
# group_into_rows reconstructs that layout from real position data
# (something Tesseract.js never exposed) instead of guessing at it from
# plain text: spans are greedily clustered into rows by vertical (Y)
# overlap, then each row's spans are sorted left-to-right and joined with
# generous spacing.
from dataclasses import dataclass


@dataclass
class Span:
    """A minimal, ML-library-agnostic stand-in for Surya's TextLine —
    only the two fields this module actually needs."""

    bbox: tuple[float, float, float, float]  # (x1, y1, x2, y2)
    text: str


def group_into_rows(spans: list[Span], y_overlap_ratio: float = 0.5) -> list[str]:
    if not spans:
        return []

    sorted_spans = sorted(spans, key=lambda s: s.bbox[1])  # top Y, ascending

    rows: list[dict] = []  # each: {"y1", "y2", "items": [(x1, text)]}
    for span in sorted_spans:
        x1, y1, x2, y2 = span.bbox
        placed_row = None
        for row in rows:
            overlap = min(y2, row["y2"]) - max(y1, row["y1"])
            # Overlap over the *union* of the two Y-ranges (an IoU-style
            # ratio), not the smaller one — an earlier version divided by
            # min height alone, which let an unusually tall span (a
            # rotated barcode fragment, a multi-line detection glitch)
            # trivially "overlap enough" with any short row it touched at
            # all, gluing itself onto that row and then dragging the
            # row's own Y-range wide enough to spuriously absorb later,
            # genuinely unrelated rows too. A tall span that doesn't
            # clearly belong to one row now correctly becomes its own row
            # instead of corrupting a real one.
            union = max(y2, row["y2"]) - min(y1, row["y1"])
            if union > 0 and overlap / union > y_overlap_ratio:
                placed_row = row
                break
        if placed_row is None:
            rows.append({"y1": y1, "y2": y2, "items": [(x1, span.text)]})
        else:
            placed_row["items"].append((x1, span.text))
            placed_row["y1"] = min(placed_row["y1"], y1)
            placed_row["y2"] = max(placed_row["y2"], y2)

    rows.sort(key=lambda row: row["y1"])
    lines = []
    for row in rows:
        row["items"].sort(key=lambda item: item[0])  # left X, ascending
        lines.append("    ".join(text for _, text in row["items"]))
    return lines
