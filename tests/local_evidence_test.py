import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path
from backend_test import bridge


class LocalEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.old = Path.cwd()
        self.tmp = tempfile.TemporaryDirectory()
        os.chdir(self.tmp.name)
        bridge.dispatch("init", {})
        bridge.dispatch("create_run", {"tag": "test-run", "query": "Local evidence fixture"})

    def tearDown(self):
        os.chdir(self.old)
        self.tmp.cleanup()

    def test_local_quote_views_exist_only_during_verification(self):
        note_id = "local-" + "a" * 32
        body = "Private controls require two reviewers before production deployment."
        run = Path("research/runs/test-run")
        (run / "prompt-decomposition.json").write_text(json.dumps({"pipeline_tier": "light", "response_format": "short", "required_section_headings": ["## Findings"]}))
        (run / "polish-log.json").write_text("{}")
        report = Path("research/notes/final_report_test-run.md")
        report.write_text("# Report\n\n## Findings\n\n" + (f"Evidence supports the conclusion. [[{note_id}]]\n\n" * 130) + f'"{body}" [[{note_id}]]\n')
        result = bridge.dispatch("finish", {"tag": "test-run", "localEvidence": [{"id": note_id, "title": "Local design", "body": body}]})
        self.assertTrue(result["passed"], result)
        self.assertFalse(Path("research/notes", note_id + ".md").exists())
        self.assertFalse(Path(".pi-local-views.json").exists())
        from hyperresearch.core.vault import Vault
        with Vault(Path.cwd()) as vault:
            self.assertIsNone(vault.db.execute("SELECT id FROM notes WHERE id = ?", (note_id,)).fetchone())

    def test_interrupted_views_are_removed_before_search_and_changed_views_are_preserved(self):
        from hyperresearch.core.vault import Vault
        from hyperresearch.core.note import write_note
        note_id = "local-" + "b" * 32
        body = "<!-- pi-local-evidence-view: not public corroboration -->\n\nConfidential material"
        with Vault(Path.cwd()) as vault:
            write_note(vault.notes_dir, "Private title", body=body, note_id=note_id)
            vault.auto_sync()
        Path(".pi-local-views.json").write_text(json.dumps([{"id": note_id, "hash": hashlib.sha256(body.encode()).hexdigest()}]))
        result = bridge.dispatch("vault_search", {"query": "Confidential"})
        self.assertNotIn(note_id, json.dumps(result))
        self.assertFalse(Path("research/notes", note_id + ".md").exists())
        with Vault(Path.cwd()) as vault:
            write_note(vault.notes_dir, "User changed title", body="Changed body", note_id=note_id)
        Path(".pi-local-views.json").write_text(json.dumps([{"id": note_id, "hash": hashlib.sha256(body.encode()).hexdigest()}]))
        with self.assertRaisesRegex(ValueError, "changed"):
            bridge.dispatch("vault_search", {"query": "Private"})
        self.assertTrue(Path("research/notes", note_id + ".md").exists())
