import tempfile
import unittest
from pathlib import Path
import pymupdf
from backend_test import bridge


class ExtractionTests(unittest.TestCase):
    def fixture(self, root, kind):
        doc = pymupdf.open()
        page = doc.new_page()
        text = "Representative born-digital evidence from the preserved document. " * 20
        if kind == "columns":
            page.insert_textbox(pymupdf.Rect(40, 40, 250, 750), text)
            page.insert_textbox(pymupdf.Rect(310, 40, 550, 750), text)
        elif kind == "tables":
            page.insert_text((40, 60), "Year     Mean     Uncertainty\n2020     4.1      0.2\n2021     5.2      0.3\nTable layout matters for the evidence.")
            page.draw_line((40, 80), (300, 80))
        elif kind == "equations":
            page.insert_text((40, 60), "Conservation model: E = m c^2. Superscripts and symbols require visual review.")
        elif kind != "scan":
            page.insert_textbox(pymupdf.Rect(40, 40, 550, 750), text)
        if kind in ("scan", "missing"):
            # Drawn content with no extractable text simulates image-only pages.
            blank = page if kind == "scan" else doc.new_page()
            blank.draw_rect(pymupdf.Rect(40, 40, 500, 700), fill=(0.8, 0.8, 0.8))
        body = "\n\n---\n\n".join(page.get_text("text") for page in doc if page.get_text("text").strip()).strip()
        path = root / "research" / "raw" / "fixture.pdf"
        path.parent.mkdir(parents=True)
        doc.save(path)
        doc.close()
        return {"source": "https://example.org/fixture.pdf", "raw_file": "raw/fixture.pdf", "oa": {"url": "https://repo.example/accepted.pdf", "version": "acceptedVersion"}}, body

    def test_text_pages_have_pinned_assets_and_real_page_numbers(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            meta, body = self.fixture(root, "text")
            result, spans = bridge.extraction_diagnostics(root, meta, body, 0, len(body))
            self.assertEqual(result["status"], "text-extracted")
            self.assertEqual(result["pages"], 1)
            self.assertEqual(result["version"], "accepted")
            self.assertEqual(result["actualUrl"], "https://repo.example/accepted.pdf")
            self.assertEqual(len(result["rawHash"]), 64)
            self.assertEqual(spans[0]["page"], 1)
            self.assertTrue(body[spans[0]["start"]:spans[0]["end"]])

    def test_scans_and_missing_pages_never_pass_as_complete(self):
        for kind in ("scan", "missing"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                meta, body = self.fixture(root, kind)
                result, spans = bridge.extraction_diagnostics(root, meta, body, 0, len(body))
                self.assertEqual(result["status"], "incomplete")
                self.assertEqual(result["missingPages"], [1] if kind == "scan" else [2])
                self.assertTrue(any("OCR" in warning for warning in result["warnings"]))

    def test_columns_tables_and_equations_do_not_imply_visual_comprehension(self):
        for kind, warning in (("columns", "layout"), ("tables", "tables"), ("equations", "equations")):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                meta, body = self.fixture(root, kind)
                result, _ = bridge.extraction_diagnostics(root, meta, body, 0, len(body))
                self.assertEqual(result["status"], "text-extracted")
                self.assertIn(warning + "-unverified", result["warnings"])

    def test_missing_corrupt_or_escaped_assets_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            meta, body = self.fixture(root, "text")
            with self.assertRaisesRegex(ValueError, "Unsafe"):
                bridge.extraction_diagnostics(root, {**meta, "raw_file": "../private.pdf"}, body, 0, len(body))
            path = root / "research" / "raw" / "fixture.pdf"
            path.write_bytes(b"%PDF-invalid")
            self.assertEqual(bridge.extraction_diagnostics(root, meta, body, 0, len(body))[0]["status"], "unavailable")
            path.unlink()
            self.assertEqual(bridge.extraction_diagnostics(root, meta, body, 0, len(body))[0]["status"], "unknown")
