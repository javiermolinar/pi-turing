import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from backend_test import bridge


class ApprovalTests(unittest.TestCase):
    def setUp(self):
        self.old = Path.cwd()
        self.tmp = tempfile.TemporaryDirectory()
        os.chdir(self.tmp.name)
        bridge.dispatch("init", {})

    def tearDown(self):
        os.chdir(self.old)
        self.tmp.cleanup()

    def test_unapproved_resolvers_are_not_called_and_missing_credentials_are_visible(self):
        from hyperresearch.core import oa
        with patch.dict(os.environ, {}, clear=True):
            coverage = bridge.resolver_coverage(["unpaywall", "core", "europepmc"])
            self.assertEqual([item["available"] for item in coverage], [False, False, True])
        original_cli = bridge.cli
        def inspect(args):
            if args[0] == "fetch":
                self.assertEqual(list(oa.iter_oa_candidates(None, "10.1234/paper", 1, email="ambient@example.org")), [])
                return {"note_id": "fixture"}
            return original_cli(args)
        with patch.object(oa, "_unpaywall_candidates", side_effect=AssertionError("unapproved")), \
             patch.object(oa, "_resolve_europepmc", side_effect=AssertionError("unapproved")), \
             patch.object(oa, "_core_candidates", side_effect=AssertionError("unapproved")), \
             patch.object(bridge, "cli", side_effect=inspect):
            result = bridge.dispatch("fetch_source", {"url": "https://example.org/paper", "tag": "test-run"})
            self.assertEqual(result["resolverCoverage"], [])

    def test_only_approved_resolver_is_called_and_contact_is_not_saved(self):
        from hyperresearch.core import oa
        original_cli = bridge.cli
        def inspect(args):
            if args[0] == "fetch":
                list(oa.iter_oa_candidates(None, "10.1234/paper", 1, email="wrong@example.org"))
                return {"note_id": "fixture"}
            return original_cli(args)
        with patch.dict(os.environ, {"HYPERRESEARCH_CONTACT_EMAIL": "approved@example.org"}, clear=True), \
             patch.object(oa, "_unpaywall_candidates", return_value=[]) as unpaywall, \
             patch.object(oa, "_resolve_europepmc", side_effect=AssertionError("unapproved")), \
             patch.object(oa, "_core_candidates", side_effect=AssertionError("unapproved")), \
             patch.object(bridge, "cli", side_effect=inspect):
            result = bridge.dispatch("fetch_source", {"url": "https://example.org/paper", "tag": "test-run", "resolvers": ["unpaywall"]})
            self.assertEqual(unpaywall.call_args.args[3], "approved@example.org")
            self.assertNotIn("approved@example.org", str(result))
            self.assertTrue(result["resolverCoverage"][0]["available"])

    def test_retraction_metadata_cannot_fall_back_to_semantic_scholar(self):
        from hyperresearch.core import scholar
        with self.assertRaisesRegex(ValueError, "approved OpenAlex"):
            bridge.dispatch("retractions", {"tag": "test-run", "providers": []})
        def inspect(args):
            self.assertIsNone(scholar._fetch_json(None, "https://api.semanticscholar.org/graph/v1/paper/DOI:x", 1))
            self.assertEqual(scholar._fetch_json(None, "https://api.openalex.org/works/doi:x", 1), {"ok": True})
            return {"checked": 0}
        with patch.object(scholar, "_fetch_json", return_value={"ok": True}) as request, patch.object(bridge, "cli", side_effect=inspect):
            bridge.dispatch("retractions", {"tag": "test-run", "providers": ["openalex"]})
            self.assertEqual(request.call_count, 1)
