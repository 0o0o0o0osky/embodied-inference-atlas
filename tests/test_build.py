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
