import copy
import io
import os
import shutil
import subprocess
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from tests.helpers import valid_run
from tools.lib.jsonio import load_json, write_json_atomic
from tools.lib.promotion import PromotionError, apply_promotion, plan_promotion
from tools.promote import main as promote_main
from tools.validate import main as validate_main


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
    def bundle(*runs):
        return {
            "bundle_version": "1.0.0",
            "source_label": "fixture-run",
            "datasets": {"runs": list(runs)},
        }

    def test_dry_run_reports_addition_without_writing_until_apply(self):
        original = self.runs_path.read_bytes()

        plan = plan_promotion(self.bundle(valid_run("run-new")), self.repo)

        self.assertEqual(plan.additions, 1)
        self.assertIn('+      "run_id": "run-new",', plan.diff)
        self.assertEqual(self.runs_path.read_bytes(), original)

        apply_promotion(plan)
        self.assertEqual(load_json(self.runs_path)["records"][0]["run_id"], "run-new")

    def test_duplicate_incoming_primary_keys_are_rejected(self):
        run = valid_run("run-duplicate")
        with self.assertRaisesRegex(PromotionError, "duplicate incoming key"):
            plan_promotion(self.bundle(run, copy.deepcopy(run)), self.repo)

    def test_unknown_dataset_is_rejected_without_writing(self):
        bundle = self.bundle(valid_run("run-new"))
        bundle["datasets"]["private-results"] = []
        original = self.runs_path.read_bytes()

        with self.assertRaisesRegex(PromotionError, "unknown dataset"):
            plan_promotion(bundle, self.repo)

        self.assertEqual(self.runs_path.read_bytes(), original)

    def test_contract_or_privacy_failure_produces_no_plan_or_write(self):
        private = valid_run("run-private")
        private["checkpoint_path"] = "/home/alice/private/model"
        original = self.runs_path.read_bytes()

        with self.assertRaises(PromotionError):
            plan_promotion(self.bundle(private), self.repo)

        self.assertEqual(self.runs_path.read_bytes(), original)

    def test_malformed_canonical_document_is_rejected_without_writing(self):
        write_json_atomic(self.runs_path, {"schema_version": "1.0.0", "dataset": "runs"})
        original = self.runs_path.read_bytes()

        with self.assertRaisesRegex(PromotionError, "records are invalid"):
            plan_promotion(self.bundle(valid_run("run-new")), self.repo)

        self.assertEqual(self.runs_path.read_bytes(), original)

    def test_symlinked_canonical_document_is_rejected_without_reading_or_writing_target(self):
        outside = self.repo / "outside.json"
        shutil.copyfile(self.runs_path, outside)
        self.runs_path.unlink()
        self.runs_path.symlink_to(outside)
        original = outside.read_bytes()

        with self.assertRaisesRegex(PromotionError, "symlink"):
            plan_promotion(self.bundle(valid_run("run-new")), self.repo)

        self.assertEqual(outside.read_bytes(), original)

    def test_bundle_requires_controlled_source_label(self):
        bundle = self.bundle(valid_run("run-new"))
        bundle["source_label"] = "../../private"
        with self.assertRaisesRegex(PromotionError, "source_label"):
            plan_promotion(bundle, self.repo)

    def test_glob_dataset_key_cannot_escape_its_canonical_directory(self):
        architecture = {
            "architecture_id": "../../escaped",
            "model_id": "model-test",
            "nodes": [{
                "node_id": "node-test", "label": "Node", "kind": "input",
                "multiplicity": 1,
            }],
            "edges": [],
            "shape_symbols": [],
            "source_ids": ["source-test"],
        }
        bundle = {
            "bundle_version": "1.0.0",
            "source_label": "fixture-architecture",
            "datasets": {"architectures": [architecture]},
        }

        with self.assertRaisesRegex(PromotionError, "filesystem-safe"):
            plan_promotion(bundle, self.repo)

        self.assertFalse((self.repo / "data" / "escaped.json").exists())

    def test_promotion_cli_is_dry_run_unless_apply_is_present(self):
        bundle_path = self.repo / "bundle.json"
        write_json_atomic(bundle_path, self.bundle(valid_run("run-cli")))
        original = self.runs_path.read_bytes()

        previous = Path.cwd()
        try:
            os.chdir(self.repo)
            with redirect_stdout(io.StringIO()):
                self.assertEqual(promote_main([str(bundle_path)]), 0)
            self.assertEqual(self.runs_path.read_bytes(), original)
            with redirect_stdout(io.StringIO()):
                self.assertEqual(promote_main([str(bundle_path), "--apply"]), 0)
        finally:
            os.chdir(previous)

        self.assertEqual(load_json(self.runs_path)["records"][0]["run_id"], "run-cli")

    def test_staged_validation_rejects_force_added_local_content(self):
        repository = self.repo / "staged-repository"
        repository.mkdir()
        subprocess.run(["git", "init", "-q"], cwd=repository, check=True)
        local = repository / ".local" / "staging"
        local.mkdir(parents=True)
        staged = local / "private.json"
        staged.write_text("{}\n", encoding="utf-8")
        subprocess.run(["git", "add", "-f", ".local/staging/private.json"], cwd=repository, check=True)

        previous = Path.cwd()
        errors = io.StringIO()
        try:
            os.chdir(repository)
            with redirect_stderr(errors):
                self.assertEqual(validate_main(["--staged"]), 1)
        finally:
            os.chdir(previous)

        self.assertIn("forbidden_path", errors.getvalue())


if __name__ == "__main__":
    unittest.main()
