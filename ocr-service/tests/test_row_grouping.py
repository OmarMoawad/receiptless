import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from row_grouping import Span, group_into_rows


def test_empty_input_returns_empty_list():
    assert group_into_rows([]) == []


def test_single_span_is_its_own_row():
    assert group_into_rows([Span((0, 0, 50, 20), "Merchant")]) == ["Merchant"]


def test_shuffled_left_right_spans_sort_left_to_right_within_a_row():
    spans = [
        Span((300, 0, 350, 20), "9.99"),
        Span((0, 0, 50, 20), "Widget"),
        Span((150, 2, 180, 18), "x2"),
    ]
    assert group_into_rows(spans) == ["Widget    x2    9.99"]


def test_top_to_bottom_row_order_is_preserved_regardless_of_input_order():
    spans = [
        Span((0, 100, 50, 120), "Total"),
        Span((0, 0, 50, 20), "Merchant"),
        Span((0, 50, 50, 70), "Item"),
    ]
    assert group_into_rows(spans) == ["Merchant", "Item", "Total"]


def test_slight_vertical_misalignment_still_merges_into_one_row():
    # Same logical row, baselines off by a couple pixels — realistic OCR
    # detection noise, not a real second row.
    spans = [
        Span((0, 10, 50, 30), "Item"),
        Span((100, 12, 150, 32), "4.50"),
    ]
    assert group_into_rows(spans) == ["Item    4.50"]


def test_adjacent_rows_with_a_small_gap_stay_separate():
    spans = [
        Span((0, 0, 50, 20), "Item A"),
        Span((0, 22, 50, 42), "Item B"),
    ]
    assert group_into_rows(spans) == ["Item A", "Item B"]


def test_adjacent_rows_with_a_thin_real_overlap_still_stay_separate():
    # A couple pixels of genuine overlap between two otherwise-distinct,
    # similarly-sized rows shouldn't be enough to merge them.
    spans = [
        Span((0, 0, 50, 22), "Item A"),
        Span((0, 20, 50, 40), "Item B"),
    ]
    assert group_into_rows(spans) == ["Item A", "Item B"]


def test_a_tall_span_does_not_bridge_two_unrelated_short_rows():
    # Regression test (2026-08-12, found while writing these tests after a
    # review flagged the lack of coverage here): the original
    # overlap/min-height ratio let a much-taller span (e.g. a rotated
    # barcode fragment, or a multi-line detection glitch) "overlap enough"
    # with a short row just by touching it, then absorb that row's Y-range
    # widely enough to spuriously merge in a second, genuinely unrelated
    # row too. A tall span spanning most of the page shouldn't silently
    # merge two real, distinct rows together.
    header = Span((0, 0, 50, 20), "Header")
    tall_span = Span((200, 5, 210, 100), "|")  # spans almost the whole page
    footer = Span((0, 90, 50, 110), "Footer")

    rows = group_into_rows([header, tall_span, footer])

    assert "Header" in rows
    assert "Footer" in rows
    # The critical assertion: Header and Footer must never end up on the
    # same reconstructed row, however the tall span itself gets grouped.
    assert not any("Header" in row and "Footer" in row for row in rows)


def test_many_rows_at_realistic_receipt_line_heights_stay_distinct():
    # A denser, more realistic stress case: five item rows at typical
    # receipt line spacing, all correctly kept apart.
    spans = []
    for i in range(5):
        y = i * 25
        spans.append(Span((0, y, 60, y + 20), f"Item {i}"))
        spans.append(Span((200, y + 1, 240, y + 19), f"{i}.99"))

    rows = group_into_rows(spans)
    assert len(rows) == 5
    for i, row in enumerate(rows):
        assert f"Item {i}" in row
        assert f"{i}.99" in row
