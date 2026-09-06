import io
import difflib
import json
import subprocess
from unittest.mock import patch
import os
import shutil
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from tests.helpers import valid_run
from tools.lib.jsonio import load_json, write_json_atomic
from tools.lib.promotion import PromotionChange, PromotionError, _change_diff, _json_bytes, apply_promotion, plan_promotion
from tools.promote import main as promote_main


ROOT = Path(__file__).resolve().parents[1]


class PromotionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.repo = Path(self.temporary.name)
        shutil.copytree(ROOT / "schema", self.repo / "schema")
        self.runs_path = self.repo / "data" / "measurements" / "runs.json"
        write_json_atomic(
            self.runs_path,
            {"schema_version": "1.0.0", "dataset": "runs", "records": []},
        )

    def tearDown(self):
        self.temporary.cleanup()

    @staticmethod
    def bundle(run):
        return {
            "bundle_version": "1.0.0",
            "source_label": "fixture-run",
            "datasets": {"runs": [run]},
        }

    def test_dry_run_then_apply(self):
        original = self.runs_path.read_bytes()
        plan = plan_promotion(self.bundle(valid_run("run-new")), self.repo)
        self.assertEqual(plan.additions, 1)
        self.assertEqual(self.runs_path.read_bytes(), original)

        apply_promotion(plan)
        self.assertEqual(load_json(self.runs_path)["records"][0]["run_id"], "run-new")

    def test_invalid_record_is_not_planned_or_written(self):
        record = valid_run("run-private")
        record["checkpoint_path"] = "/home/example/private-model"
        original = self.runs_path.read_bytes()
        with self.assertRaises(PromotionError):
            plan_promotion(self.bundle(record), self.repo)
        self.assertEqual(self.runs_path.read_bytes(), original)

    def test_cli_is_dry_run_without_apply(self):
        bundle_path = self.repo / "bundle.json"
        write_json_atomic(bundle_path, self.bundle(valid_run("run-cli")))
        original = self.runs_path.read_bytes()
        previous = Path.cwd()
        try:
            os.chdir(self.repo)
            with redirect_stdout(io.StringIO()):
                self.assertEqual(promote_main([str(bundle_path)]), 0)
        finally:
            os.chdir(previous)
        self.assertEqual(self.runs_path.read_bytes(), original)


class PromotionDiffTests(unittest.TestCase):
    def check_patch(self, before, after):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "records.json"
            before_bytes = _json_bytes(before) if before is not None else b""
            path.write_bytes(before_bytes)
            change = PromotionChange("fixture", path, after, before_bytes, before_bytes)
            diff = _change_diff(change, root)
            result = subprocess.run(["patch", "--batch", "--fuzz=0", "-p1"], input=diff.encode(), cwd=root, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr.decode() + result.stdout.decode())
            self.assertEqual(path.read_bytes(), _json_bytes(after))
            return diff

    def test_appending_a_record_does_not_match_the_unchanged_population(self):
        before = {"records": [{"id": f"record-{i:04}", "events": [{"kind": "kernel", "duration": 12}] * 4} for i in range(100)]}
        after = {"records": before["records"] + [{"id": "record-new", "events": [{"kind": "kernel", "duration": 14}]}]}
        original_diff = difflib.SequenceMatcher
        sizes = []
        def bounded_diff(junk, a, b, *args, **kwargs):
            sizes.append((len(a), len(b)))
            return original_diff(junk, a, b, *args, **kwargs)
        with patch("tools.lib.promotion.difflib.SequenceMatcher", side_effect=bounded_diff):
            self.check_patch(before, after)
        self.assertTrue(sizes)
        self.assertLess(max(max(pair) for pair in sizes), 40)

    def test_hunk_offsets_rebuild_changed_and_inserted_middle_records(self):
        before = {"records": [{"id": f"record-{i:03}", "value": i} for i in range(30)]}
        after = json.loads(json.dumps(before))
        after["records"][10]["value"] = 999
        after["records"].insert(20, {"id": "inserted", "value": 7})
        self.check_patch(before, after)
        self.check_patch(after, before)
        self.check_patch(None, {"records": [{"id": "new"}]})
        self.check_patch({"records": [{"id": "removed"}]}, {"records": []})


if __name__ == "__main__":
    unittest.main()
