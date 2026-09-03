import copy
import unittest
from pathlib import Path

from tests.helpers import valid_model_document
from tools.lib.contracts import validate_document


ROOT = Path(__file__).resolve().parents[1]


class ContractTests(unittest.TestCase):
    def test_valid_model_document_passes(self):
        self.assertEqual(validate_document("models", valid_model_document(), ROOT), [])

    def test_unknown_field_is_rejected(self):
        document = copy.deepcopy(valid_model_document())
        document["records"][0]["checkpoint_path"] = "/private/model"
        issues = validate_document("models", document, ROOT)
        self.assertEqual([issue.code for issue in issues], ["unknown_field"])

    def test_missing_required_field_is_rejected(self):
        document = copy.deepcopy(valid_model_document())
        del document["records"][0]["model_type"]
        issues = validate_document("models", document, ROOT)
        self.assertEqual([issue.code for issue in issues], ["required"])
