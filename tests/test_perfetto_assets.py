import shutil
import tempfile
import unittest
from pathlib import Path

from tools.lib.privacy import scan_site_tree

ROOT = Path(__file__).resolve().parents[1]


class PerfettoAssetsTests(unittest.TestCase):
    def test_only_exact_pinned_vendor_files_are_exempt_from_data_privacy_scan(self):
        with tempfile.TemporaryDirectory() as temporary:
            site = Path(temporary)
            shutil.copytree(ROOT / 'public/perfetto', site / 'perfetto')
            self.assertEqual(scan_site_tree(site), [])
            (site / 'application.js').write_text('const source = "/home/secret/capture";')
            self.assertTrue(any(x.code == 'local_path' and 'application.js' in x.path for x in scan_site_tree(site)))
            (site / 'perfetto/index.html').write_text('<script src="https://example.com/changed.js"></script>')
            (site / 'perfetto/unlisted.js').write_text('fetch("https://example.com/extra")')
            issues = scan_site_tree(site)
            self.assertTrue(any(x.code == 'vendor_asset_mismatch' and 'index.html' in x.path for x in issues))
            self.assertTrue(any(x.code == 'unrecognized_vendor_asset' and 'unlisted.js' in x.path for x in issues))
