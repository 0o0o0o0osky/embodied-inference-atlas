import tempfile
import unittest
from html.parser import HTMLParser
from pathlib import Path

from tools.lib.site import build_site


ROOT = Path(__file__).resolve().parents[1]


class _AssetReferences(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.references: list[str] = []
        self.module_entries: list[str] = []

    def handle_starttag(
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        attributes = dict(attrs)
        if tag == "script" and attributes.get("src"):
            source = str(attributes["src"])
            self.references.append(source)
            if attributes.get("type") == "module":
                self.module_entries.append(source)
        if tag == "link" and attributes.get("href"):
            self.references.append(str(attributes["href"]))


class BuildTests(unittest.TestCase):
    def test_builder_emits_local_application_entry_without_remote_assets(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "site"
            build_site(ROOT, output)

            parser = _AssetReferences()
            parser.feed((output / "index.html").read_text(encoding="utf-8"))

            self.assertEqual(len(parser.module_entries), 1)
            self.assertFalse(
                any(
                    reference.startswith(("http://", "https://", "//"))
                    for reference in parser.references
                )
            )
            for reference in parser.references:
                self.assertTrue((output / reference).resolve().is_file(), reference)
