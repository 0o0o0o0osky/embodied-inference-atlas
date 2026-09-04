import json
import tempfile
import unittest
from pathlib import Path

from tools.lib.site import build_site


ROOT = Path(__file__).resolve().parents[1]


class BuildTests(unittest.TestCase):
    def test_build_writes_file_openable_index_without_remote_scripts(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "site"
            result = build_site(ROOT, output)
            html = (output / "index.html").read_text(encoding="utf-8")
            self.assertTrue(result.pages)
            self.assertIn('id="page-data"', html)
            self.assertNotIn('<script src="http', html)
            self.assertTrue((output / "assets" / "vendor" / "echarts.min.js").is_file())

    def test_build_emits_foundation_pages_and_safe_comparisons(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "site"
            build_site(ROOT, output)
            expected = [
                "index.html", "performance.html", "operators.html", "rooflines.html",
                "models/pi0.html",
            ]
            self.assertTrue(all((output / path).is_file() for path in expected))
            index = (output / "index.html").read_text(encoding="utf-8")
            pi0 = (output / "models" / "pi0.html").read_text(encoding="utf-8")
            pi05 = (output / "models" / "pi05.html").read_text(encoding="utf-8")
            performance = (output / "performance.html").read_text(encoding="utf-8")
            self.assertIn("model-cards", index)
            self.assertLess(index.index('id="model-cards"'), index.index('id="coverage"'))
            self.assertIn("pi0-logical-v1", pi0)
            self.assertIn("workspace.js", pi0)
            self.assertIn("attention-core", pi0)
            self.assertIn("euler-update", pi0)
            self.assertIn("Structure-only review", pi0)
            self.assertIn("model.js", pi05)
            self.assertNotIn("workspace.js", pi05)
            self.assertIn("measured_local", performance)
            self.assertIn("analytical", performance)
            self.assertIn("reported_external", performance)
            page_data = json.loads(
                performance.split('<script id="page-data" type="application/json">', 1)[1]
                .split("</script>", 1)[0]
            )
            self.assertFalse(any(
                row.get("ratio_kind") == "validated_speedup"
                and row.get("correctness") == "failed"
                for row in page_data["comparisons"]
            ))
