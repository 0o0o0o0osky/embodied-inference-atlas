import io
import os
import shutil
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from tests.helpers import valid_run
from tools.lib.jsonio import load_json, write_json_atomic
from tools.lib.promotion import PromotionError, apply_promotion, plan_promotion
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


if __name__ == "__main__":
    unittest.main()
