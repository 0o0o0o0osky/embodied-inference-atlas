import copy
import io
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

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

    def two_dataset_bundle(self):
        run = valid_run("run-bundle")
        measurement = {
            "measurement_id": "e2e-bundle",
            "run_id": "run-bundle",
            "source_id": "source-test",
            "evidence": "measured_local",
            "measurement_method": "wall_clock",
            "metric": "latency",
            "statistics": [{"statistic": "mean", "value": 4.2, "unit": "ms"}],
            "sample_count": 10,
            "percentile_method": None,
            "work_unit": "action_chunk",
            "timing_boundary_id": "predict_cached_graph_sync",
            "missing_reason": None,
        }
        return {
            "bundle_version": "1.0.0",
            "source_label": "fixture-bundle",
            "datasets": {"runs": [run], "end_to_end": [measurement]},
        }

    def initialize_end_to_end(self):
        path = self.repo / "data" / "measurements" / "end_to_end.json"
        write_json_atomic(
            path,
            {"schema_version": "1.0.0", "dataset": "end_to_end", "records": []},
        )
        return path

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

    def test_unsafe_current_document_is_rejected_before_diff_construction(self):
        secret = "saved,/tmp/private/atlas-secret"
        current = valid_run("run-existing")
        current["configuration_id"] = secret
        write_json_atomic(
            self.runs_path,
            {"schema_version": "1.0.0", "dataset": "runs", "records": [current]},
        )
        sanitized = copy.deepcopy(current)
        sanitized["configuration_id"] = "cfg-run-existing"

        with self.assertRaises(PromotionError) as caught:
            plan_promotion(self.bundle(sanitized), self.repo)

        self.assertNotIn(secret, str(caught.exception))
        self.assertNotIn("/tmp/private", str(caught.exception))

    def test_cli_never_prints_unsafe_current_values(self):
        secret = "saved,/tmp/private/atlas-secret"
        current = valid_run("run-existing")
        current["configuration_id"] = secret
        write_json_atomic(
            self.runs_path,
            {"schema_version": "1.0.0", "dataset": "runs", "records": [current]},
        )
        sanitized = copy.deepcopy(current)
        sanitized["configuration_id"] = "cfg-run-existing"
        bundle_path = self.repo / "bundle.json"
        write_json_atomic(bundle_path, self.bundle(sanitized))

        previous = Path.cwd()
        output = io.StringIO()
        errors = io.StringIO()
        try:
            os.chdir(self.repo)
            with redirect_stdout(output), redirect_stderr(errors):
                result = promote_main([str(bundle_path)])
        finally:
            os.chdir(previous)

        self.assertEqual(result, 1)
        self.assertNotIn(secret, output.getvalue() + errors.getvalue())
        self.assertNotIn("/tmp/private", output.getvalue() + errors.getvalue())

    def test_diff_never_uses_unvalidated_shadowed_original_values(self):
        secret = "saved,/tmp/private/shadowed-secret"
        current = valid_run("run-shadowed")
        document = {
            "schema_version": "1.0.0",
            "dataset": "runs",
            "records": [current],
        }
        payload = json.dumps(document, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        safe_field = '"configuration_id": "cfg-run-shadowed",'
        shadowed_fields = (
            f'"configuration_id": "{secret}",\n'
            f'      "configuration_id": "cfg-run-shadowed",'
        )
        self.runs_path.write_text(
            payload.replace(safe_field, shadowed_fields), encoding="utf-8"
        )
        updated = copy.deepcopy(current)
        updated["correctness"]["status"] = "passed"

        plan = plan_promotion(self.bundle(updated), self.repo)

        self.assertNotIn(secret, plan.diff)
        self.assertNotIn("/tmp/private", plan.diff)

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

    def test_multi_document_apply_rolls_back_after_second_write_failure(self):
        end_to_end_path = self.initialize_end_to_end()
        originals = {
            self.runs_path: self.runs_path.read_bytes(),
            end_to_end_path: end_to_end_path.read_bytes(),
        }
        plan = plan_promotion(self.two_dataset_bundle(), self.repo)
        real_write = write_json_atomic
        calls = 0

        def fail_second_write(path, value):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("injected write failure")
            real_write(path, value)

        with patch("tools.lib.promotion.write_json_atomic", side_effect=fail_second_write):
            with self.assertRaisesRegex(PromotionError, "apply failed"):
                apply_promotion(plan)

        for path, original in originals.items():
            self.assertEqual(path.read_bytes(), original)

    def test_cli_contains_apply_io_failure_without_traceback_or_error_detail(self):
        end_to_end_path = self.initialize_end_to_end()
        originals = {
            self.runs_path: self.runs_path.read_bytes(),
            end_to_end_path: end_to_end_path.read_bytes(),
        }
        bundle_path = self.repo / "bundle.json"
        write_json_atomic(bundle_path, self.two_dataset_bundle())
        real_write = write_json_atomic
        calls = 0

        def fail_second_write(path, value):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("failed at /tmp/private/io-secret")
            real_write(path, value)

        previous = Path.cwd()
        output = io.StringIO()
        errors = io.StringIO()
        try:
            os.chdir(self.repo)
            with patch("tools.lib.promotion.write_json_atomic", side_effect=fail_second_write):
                with redirect_stdout(output), redirect_stderr(errors):
                    result = promote_main([str(bundle_path), "--apply"])
        finally:
            os.chdir(previous)

        self.assertEqual(result, 1)
        self.assertNotIn("Traceback", errors.getvalue())
        self.assertNotIn("/tmp/private", errors.getvalue())
        for path, original in originals.items():
            self.assertEqual(path.read_bytes(), original)

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

    def test_staged_validation_allows_deleting_a_prohibited_file(self):
        repository = self.repo / "cleanup-repository"
        repository.mkdir()
        subprocess.run(["git", "init", "-q"], cwd=repository, check=True)
        blocked = repository / "obsolete.log"
        blocked.write_text("old raw log\n", encoding="utf-8")
        subprocess.run(["git", "add", "-f", "obsolete.log"], cwd=repository, check=True)
        subprocess.run(
            [
                "git", "-c", "user.name=Atlas Test", "-c",
                "user.email=atlas@example.com", "commit", "-qm", "seed",
            ],
            cwd=repository,
            check=True,
        )
        blocked.unlink()
        subprocess.run(["git", "add", "-u"], cwd=repository, check=True)

        previous = Path.cwd()
        errors = io.StringIO()
        try:
            os.chdir(repository)
            with redirect_stderr(errors):
                result = validate_main(["--staged"])
        finally:
            os.chdir(previous)

        self.assertEqual(result, 0, errors.getvalue())

    def test_all_validation_rejects_broken_site_symlink(self):
        (self.repo / "site").symlink_to(self.repo / "missing-site", target_is_directory=True)
        previous = Path.cwd()
        errors = io.StringIO()
        try:
            os.chdir(self.repo)
            with redirect_stderr(errors):
                result = validate_main(["--all"])
        finally:
            os.chdir(previous)

        self.assertEqual(result, 1)
        self.assertIn("symlink", errors.getvalue())


if __name__ == "__main__":
    unittest.main()
